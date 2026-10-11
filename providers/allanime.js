// Imported provider: allanime; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  function trace(stage, details) {
    try {
      if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
        globalThis.vueoTrace(stage, details);
      }
    } catch (_) {}
  }
  function normalize(raw) {
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (_) { return null; }
    }
    if (!raw || typeof raw !== "object" || raw.error) return null;
    var tmdb = raw.tmdb;
    if (!tmdb || typeof tmdb !== "object") {
      if (!raw.title || (raw.mediaType !== "movie" && raw.mediaType !== "tv")) return null;
      var alternatives = Array.isArray(raw.aliases) ? raw.aliases.map(function(alias) {
        return { title: String(alias), iso_3166_1: "" };
      }) : [];
      tmdb = {
        id: raw.tmdbId,
        title: raw.mediaType === "movie" ? raw.title : undefined,
        name: raw.mediaType === "tv" ? raw.title : undefined,
        original_title: raw.mediaType === "movie" ? (raw.originalTitle || raw.title) : undefined,
        original_name: raw.mediaType === "tv" ? (raw.originalTitle || raw.title) : undefined,
        release_date: raw.mediaType === "movie" && raw.year ? String(raw.year) + "-01-01" : "",
        first_air_date: raw.mediaType === "tv" && raw.year ? String(raw.year) + "-01-01" : "",
        external_ids: { imdb_id: raw.imdbId || "" },
        alternative_titles: { titles: alternatives, results: alternatives }
      };
    }
    if (!tmdb.title && !tmdb.name) return null;
    trace("METADATA", { shared: true, title: raw.title || tmdb.title || tmdb.name || "",
      year: raw.year || "", imdbId: raw.imdbId || "",
      aliases: Array.isArray(raw.aliases) ? raw.aliases.length : 0 });
    return tmdb;
  }
  function local() {
    trace("METADATA_FALLBACK", { shared: false });
    return Promise.resolve().then(fallback);
  }
  try {
    if (typeof globalThis !== "undefined") {
      var direct = normalize(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (direct) return Promise.resolve(direct);
      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve().then(function() {
          return globalThis.vueoDiscoveryContext(url);
        }).then(function(raw) {
          var shared = normalize(raw);
          return shared || local();
        }, local);
      }
    }
  } catch (_) {}
  return local();
}


/* VUEO_TITLE_PROFILE_V1 */
function buildTitleProfile(tmdb) {
  var primary = String(tmdb.title || tmdb.name || "").trim();
  var aliases = [];
  function add(value) {
    value = String(value || "").trim();
    if (value && aliases.indexOf(value) === -1) aliases.push(value);
  }
  add(primary);
  add(tmdb.original_title || tmdb.original_name);
  var alternate = tmdb.alternative_titles || {};
  (alternate.titles || alternate.results || []).forEach(function(item) { add(item.title); });
  return { title: primary, aliases: aliases };
}


/* CLOUDBANK_NUVIO_ADAPTER_V1 */
function cloudbankWrapProvider(provider, providerId, supportedTypes) {
  var upstream = provider.getStreams;
  var adapted = {};
  Object.keys(provider).forEach(function(key) { adapted[key] = provider[key]; });
  adapted.getStreams = function(tmdbId, mediaType, season, episode) {
    var args = Array.prototype.slice.call(arguments);
    var type = mediaType === "series" ? "tv" : mediaType;
    if (supportedTypes.indexOf(type) === -1 || !String(tmdbId || "").trim()) return Promise.resolve([]);
    if (type === "tv" && (!Number.isInteger(Number(season)) || Number(season) < 0 ||
        !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    args[0] = String(tmdbId);
    args[1] = type;
    if (type === "tv") { args[2] = Number(season); args[3] = Number(episode); }
    return new Promise(function(resolve) {
      var finished = false;
      var timer = setTimeout(function() { finish([]); }, 19000);
      function finish(value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        var seen = Object.create(null);
        var streams = Array.isArray(value) ? value.filter(function(stream) {
          if (!stream || typeof stream.url !== "string" || !/^(https?:\/\/|magnet:)/i.test(stream.url)) return false;
          // Preserve separate audio/server entries sharing the same media URL.
          var key = JSON.stringify([stream.url, stream.name, stream.headers, stream.subtitles]);
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }) : [];
        resolve(streams);
      }
      Promise.resolve().then(function() { return upstream.apply(provider, args); }).then(finish, function() { finish([]); });
    });
  };
  return adapted;
}

function cloudbankMetadataFetch(nativeFetch) {
  return function(url, options) {
    var text = typeof url === "string" ? url : url && url.url;
    var match = typeof text === "string" && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(text);
    var method = options && options.method ? String(options.method).toUpperCase() : "GET";
    if (!match || method !== "GET") return nativeFetch(url, options);
    // Shared metadata covers details only; search/find/season/episode requests stay upstream.
    var response;
    return vueoSharedTmdb(text, function() {
      return nativeFetch(url, options).then(function(value) {
        response = value;
        if (!value.ok) throw new Error("TMDB HTTP " + value.status);
        return value.json();
      });
    }).then(function(tmdb) {
      var profile = buildTitleProfile(tmdb);
      if (!profile.title) throw new Error("TMDB title unavailable");
      var body = JSON.stringify(tmdb);
      return {
        ok: true, status: 200, statusText: "OK", url: text,
        headers: response ? response.headers : { get: function(name) {
          return String(name).toLowerCase() === "content-type" ? "application/json" : null;
        } },
        json: function() { return Promise.resolve(JSON.parse(body)); },
        text: function() { return Promise.resolve(body); }
      };
    });
  };
}

(function() {
  var originalModule = { exports: {} };
  var originalRequire = typeof require === "function" ? require : null;
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported embedded module: " + name);
    if (!originalRequire) throw new Error("Runtime module unavailable: " + name);
    return originalRequire(name);
  }
  (function(module, exports, require, fetch, self) {
/* CLOUDBANK_UPSTREAM_SOURCE_START */
const _0x4c27ee=_0x50b4;(function(_0x2b6eaa,_0x2471d9){const _0x4d23e9=_0x50b4,_0x16a792=_0x2b6eaa();while(!![]){try{const _0xb64360=-parseInt(_0x4d23e9(0x17f))/0x1*(-parseInt(_0x4d23e9(0x1ba))/0x2)+parseInt(_0x4d23e9(0x1a3))/0x3*(parseInt(_0x4d23e9(0x187))/0x4)+-parseInt(_0x4d23e9(0x15d))/0x5*(parseInt(_0x4d23e9(0x1b6))/0x6)+parseInt(_0x4d23e9(0x143))/0x7*(parseInt(_0x4d23e9(0x17e))/0x8)+-parseInt(_0x4d23e9(0x191))/0x9+-parseInt(_0x4d23e9(0x19c))/0xa*(-parseInt(_0x4d23e9(0x17a))/0xb)+-parseInt(_0x4d23e9(0x163))/0xc*(parseInt(_0x4d23e9(0x1b4))/0xd);if(_0xb64360===_0x2471d9)break;else _0x16a792['push'](_0x16a792['shift']());}catch(_0xb8b72c){_0x16a792['push'](_0x16a792['shift']());}}}(_0x210b,0xdc996));var __async=(_0x4d6e64,_0x1479a4,_0x43d1ab)=>{return new Promise((_0x4f420e,_0x28dd29)=>{const _0x4c6612=_0x50b4;var _0x109112=_0x17a146=>{const _0x265b34=_0x50b4;try{_0x19023b(_0x43d1ab[_0x265b34(0x19d)](_0x17a146));}catch(_0x398f04){_0x28dd29(_0x398f04);}},_0x5acb95=_0x5d9149=>{const _0x569b1a=_0x50b4;try{_0x19023b(_0x43d1ab[_0x569b1a(0x183)](_0x5d9149));}catch(_0xf1b57b){_0x28dd29(_0xf1b57b);}},_0x19023b=_0x5c2acd=>_0x5c2acd[_0x4c6612(0x177)]?_0x4f420e(_0x5c2acd['value']):Promise[_0x4c6612(0x1ad)](_0x5c2acd[_0x4c6612(0x185)])[_0x4c6612(0x1b2)](_0x109112,_0x5acb95);_0x19023b((_0x43d1ab=_0x43d1ab[_0x4c6612(0x19e)](_0x4d6e64,_0x1479a4))[_0x4c6612(0x19d)]());});},CryptoJS=require(_0x4c27ee(0x18d)),AGENT=_0x4c27ee(0x196),ALLANIME_BASE=_0x4c27ee(0x158),ALLANIME_API=_0x4c27ee(0x18f);function getSimilarity(_0x25c78b,_0x56bb90){const _0x5bace0=_0x4c27ee;if(!_0x25c78b||!_0x56bb90)return 0x0;const _0x3f2a3f=_0x25c78b[_0x5bace0(0x1b0)]()[_0x5bace0(0x176)](/[^a-z0-9]/g,''),_0x5800a5=_0x56bb90[_0x5bace0(0x1b0)]()[_0x5bace0(0x176)](/[^a-z0-9]/g,'');if(_0x3f2a3f===_0x5800a5)return 0x1;if(_0x3f2a3f[_0x5bace0(0x1c2)]<0x2||_0x5800a5[_0x5bace0(0x1c2)]<0x2)return 0x0;const _0x49297b=_0x512424=>{const _0x2a93ba=_0x5bace0,_0x15de49=new Set();for(let _0x4ec5da=0x0;_0x4ec5da<_0x512424[_0x2a93ba(0x1c2)]-0x1;_0x4ec5da++){_0x15de49[_0x2a93ba(0x16a)](_0x512424[_0x2a93ba(0x179)](_0x4ec5da,_0x4ec5da+0x2));}return _0x15de49;},_0x58bbf6=_0x49297b(_0x3f2a3f),_0x193fef=_0x49297b(_0x5800a5);let _0x339919=0x0;for(const _0x3fa688 of _0x58bbf6){if(_0x193fef[_0x5bace0(0x1b9)](_0x3fa688))_0x339919++;}return 0x2*_0x339919/(_0x58bbf6[_0x5bace0(0x198)]+_0x193fef[_0x5bace0(0x198)]);}function decryptProviderId(_0x586506){const _0x15373e=_0x4c27ee,_0x292af9={'79':'A','7a':'B','7b':'C','7c':'D','7d':'E','7e':'F','7f':'G','70':'H','71':'I','72':'J','73':'K','74':'L','75':'M','76':'N','77':'O','68':'P','69':'Q','6a':'R','6b':'S','6c':'T','6d':'U','6e':'V','6f':'W','60':'X','61':'Y','62':'Z','59':'a','5a':'b','5b':'c','5c':'d','5d':'e','5e':'f','5f':'g','50':'h','51':'i','52':'j','53':'k','54':'l','55':'m','56':'n','57':'o','48':'p','49':'q','4a':'r','4b':'s','4c':'t','4d':'u','4e':'v','4f':'w','40':'x','41':'y','42':'z','08':'0','09':'1','0a':'2','0b':'3','0c':'4','0d':'5','0e':'6','0f':'7','00':'8','01':'9','15':'-','16':'.','67':'_','46':'~','02':':','17':'/','07':'?','1b':'#','63':'[','65':']','78':'@','19':'!','1c':'$','1e':'&','10':'(','11':')','12':'*','13':'+','14':',','03':';','05':'=','1d':'%'};let _0x5b9252='';for(let _0x3c69b7=0x0;_0x3c69b7<_0x586506[_0x15373e(0x1c2)];_0x3c69b7+=0x2){const _0x2cfa35=_0x586506['substring'](_0x3c69b7,_0x3c69b7+0x2);_0x5b9252+=_0x292af9[_0x2cfa35]||_0x2cfa35;}return _0x5b9252[_0x15373e(0x176)](/([^:])\/\//g,_0x15373e(0x1a0))[_0x15373e(0x176)]('/clock',_0x15373e(0x19a));}var AES_KEY=CryptoJS[_0x4c27ee(0x16e)](_0x4c27ee(0x1ab));function decryptToBeParsed(_0x313a64){const _0x200e3e=_0x4c27ee,_0x224a88=CryptoJS[_0x200e3e(0x15a)][_0x200e3e(0x1c1)][_0x200e3e(0x14e)](_0x313a64),_0x57156c=_0x224a88['toString'](CryptoJS[_0x200e3e(0x15a)]['Hex']),_0x5f5dd6=_0x57156c[_0x200e3e(0x179)](0x2,0x2+0x18),_0x213493=_0x57156c[_0x200e3e(0x179)](0x2+0x18,_0x57156c[_0x200e3e(0x1c2)]-0x20);if(!_0x213493||_0x213493['length']===0x0)return null;const _0x4f61c0=_0x5f5dd6+'00000002',_0x1986fc=CryptoJS[_0x200e3e(0x15a)][_0x200e3e(0x154)][_0x200e3e(0x14e)](_0x4f61c0),_0x482034=CryptoJS[_0x200e3e(0x15a)][_0x200e3e(0x154)][_0x200e3e(0x14e)](_0x213493),_0x2a1f73=CryptoJS['lib'][_0x200e3e(0x184)]['create']({'ciphertext':_0x482034}),_0x2b961c=CryptoJS[_0x200e3e(0x18a)][_0x200e3e(0x147)](_0x2a1f73,AES_KEY,{'iv':_0x1986fc,'mode':CryptoJS[_0x200e3e(0x1be)][_0x200e3e(0x1a9)],'padding':CryptoJS[_0x200e3e(0x1bc)][_0x200e3e(0x169)]});return _0x2b961c[_0x200e3e(0x1a8)](CryptoJS[_0x200e3e(0x15a)][_0x200e3e(0x153)]);}function _0x210b(){const _0x296a20=['AxnbCNjHEq','CMvWBgfJzq','zg9Uzq','p3zHCMLHyMXLCZ0','C3vIC3rYAw5N','mZyZvwHmyKLM','CM9TywPP','zdqWnwqWzwrKnJKWnJi0yJy2yMfIytmWnJHLmgvKyZnHyZKWzJe1otDKodK4ytfLyZHKyJrLnwm0m2mWmgzLyW','xsbhB3qG','nZeWodbwvuzRA2e','neDPuuzPqW','ANnVBG','Ahr0Chm6lY8','zMfZDdrZCgvLza','DgHYB3C','q2LWAgvYugfYyw1Z','DMfSDwu','DhLWzq','ngL2veroAq','lcbeDwiGCMvZDwX0CZOG','BwfW','quvt','mta4mha','Dg9IzxbHCNnLzcbku09oihbHCNnLigvYCM9YoG','y3j5ChrVlwPZ','rMv0y2GGChjVDMLKzxiGBgLUA3mGzxjYB3i6','Ahr0Chm6lY9HCgKUywXSyw5PBwuUzgf5l2fWAq','yw5PBgLZDa','otG0odm0uu1Nsu1x','y2f0y2G','ChjVDMLKzxi','C3vI','rMfPBgvKihrVihbHCNnLigrLy3j5ChrLzcb0B2jLCgfYC2vKoG','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYos4WlJaUmcbtywzHCMKVntm3lJm2','zwrNzxm','C2L6zq','l21Wnc9MAwXLlM1Wna','l2nSB2nRlMPZB24','Dg9IzxbHCNnLza','mJK1mdyWAMjNDKXv','BMv4Da','yxbWBhK','u3vIihjLC3vSDhm6ia','jdeV','ihjHDYbZB3vYy2vZ','DxjS','mtiWnda3n3rUBhnyua','zMLSDgvY','Ahr0Chm6lY95B3v0Ds1JAgfUlMnVBq','qwXSqw5PBwuGuMf3ifn0CMvHBsbfCNjVCJO','uY1TCdq','Dg9tDhjPBMC','q1rs','Bw92Awu','wg90mZzPm2XlmZP2mq','C3rHCNrZv2L0Aa','CMvZB2X2zq','DgL0Bgu','qwXSqw5PBwu','Dg9mB3DLCKnHC2u','CMvZB2X1DgLVBLn0CG','DgHLBG','zxbPC29Kzq','mtaXngjAwNfxBa','zw5NBgLZAa','odu3ntHmrMzqufi','Ahr0Chm6lY9HCM0UAgfNBhvUzc5KzxyVyxbPl3yYl3rOzw1VDMLLzgi/Awq9','Aw5JBhvKzxm','AgfZ','mJiZotu0Dw1ZEe5Y','C3rYAw5NAwz5','CgfK','p2fWAv9RzxK9otrMyZDImMe5ztzHzJe0yJfJnZG0nJvKnJrLowuWzde','Bw9Kzq','qw5PBwu','AgvHzgvYCW','qMfZzty0','BgvUz3rO','ihWG','Ahr0Chm6lY9HBgXTyw5Nys50BW','C291CMnLtMfTzq','nJa5Dwzcyu5Y','Bg9N','qxv0BW','C291CMnLvxjSCW','zgvJCNLWDa','AwzYyw1L','zxHWB3j0CW','qwXSqw5PBwuG','xsbtA2LWCgLUzYbPzNjHBwu6ia','qwXSqw5PBwuGu2vHCMnOievYCM9YoG','C3bSAxq','CgfYC2u','zxjYB3i','rgvMyxvSDa','l2fWAxz0D28V','yMvZDa','vxrMoa','sgv4','ywXS','BgLUAW','kI8Q','Ahr0Chm6lY9HBgXHBMLTzs5KyxK','ue9tva','zw5J','C2HVD3m','CxvHBgL0Eq','mteWuM1MC2PN','xsbgywLSzwqGDg8GzgvJCNLWDca','twfWCgLUzYbfCNjVCJO','wxqTBxa0','Ahr0Ca','yxzHAwXHyMXLrxbPC29Kzxm','mtK1mtu2BKvqzKzW','ChvZAa','zhvI','cIaGicaGicaGCxvLCNKGkcrPzdOGsw50ksb7cIaGicaGicaGicaGie1LzgLHicHPzdOGjgLKksb7cIaGicaGicaGicaGicaGicbPzaOGicaGicaGicaGicaGicaGzM9YBwf0cIaGicaGicaGicaGicaGicbLCgLZB2rLCWOGicaGicaGicaGicaGicaGDgL0BguGEYbYB21HAMKGzw5NBgLZAcbUyxrPDMuGFqOGicaGicaGicaGicaGicaGCMvSyxrPB25ZihSkicaGicaGicaGicaGicaGicaGicbLzgDLCYb7ihjLBgf0Aw9UvhLWzsb9cIaGicaGicaGicaGicaGicaGicaGBM9KzxmGEYbPzcbMB3jTyxqGzxbPC29KzxmGDhLWzsb9cIaGicaGicaGicaGicaGicb9cIaGicaGicaGicaGih0kicaGicaGicb9cIaGica','yxbWBgLJyxrPB24VANnVBG','thvMlu1Wna','tM9qywrKAw5N','ywrK','u2vHCMnOihrPDgXLoG','z2v0uMf3u3rYzwfTu291CMnLCYbivfrq','BMfTzq','u0HbmJu2','zgf0yq','Bwf0y2G','uMvZB2X2zwq6','vxyTBxa0','BgLUA3m','vw5RBM93BG'];_0x210b=function(){return _0x296a20;};return _0x210b();}function searchAnime(_0x39b928,_0x117a37){return __async(this,null,function*(){const _0x19d160=_0x50b4;var _0x1080b6,_0x36d801;const _0x274e20=_0x117a37===_0x19d160(0x165)?_0x19d160(0x165):_0x19d160(0x194),_0x336c59='query(\x20$search:\x20SearchInput\x20$limit:\x20Int\x20$page:\x20Int\x20$translationType:\x20VaildTranslationTypeEnumType\x20$countryOrigin:\x20VaildCountryOriginEnumType\x20)\x20{\x20shows(\x20search:\x20$search\x20limit:\x20$limit\x20page:\x20$page\x20translationType:\x20$translationType\x20countryOrigin:\x20$countryOrigin\x20)\x20{\x20edges\x20{\x20_id\x20name\x20availableEpisodes\x20__typename\x20}\x20}}',_0x2ec480=JSON[_0x19d160(0x1bb)]({'variables':{'search':{'allowAdult':![],'allowUnknown':![],'query':_0x39b928},'limit':0x28,'page':0x1,'translationType':_0x274e20,'countryOrigin':'ALL'},'query':_0x336c59}),_0x212bc1={'User-Agent':AGENT,'Content-Type':_0x19d160(0x167),'Referer':_0x19d160(0x1c4),'Origin':_0x19d160(0x1c4)};try{const _0x2a23db=yield fetch(ALLANIME_API,{'method':_0x19d160(0x159),'headers':_0x212bc1,'body':_0x2ec480});if(!_0x2a23db['ok'])return[];const _0x4a4ac1=yield _0x2a23db[_0x19d160(0x180)](),_0x5a0c53=((_0x36d801=(_0x1080b6=_0x4a4ac1==null?void 0x0:_0x4a4ac1[_0x19d160(0x16f)])==null?void 0x0:_0x1080b6[_0x19d160(0x15b)])==null?void 0x0:_0x36d801[_0x19d160(0x197)])||[];return _0x5a0c53[_0x19d160(0x189)](_0x51c079=>({'id':_0x51c079['_id'],'name':_0x51c079[_0x19d160(0x16d)],'episodes':_0x51c079[_0x19d160(0x162)]&&_0x51c079[_0x19d160(0x162)][_0x274e20]||0x0}));}catch(_0x24a9b5){return console['error'](_0x19d160(0x14c),_0x24a9b5),[];}});}function getRawStreamSources(_0x4feff4,_0x3055fe,_0x4228cd){return __async(this,null,function*(){const _0x563f32=_0x50b4;var _0x41d349,_0x232cef,_0x2de22d,_0x538cff;const _0x3e122a=_0x4228cd==='dub'?_0x563f32(0x165):'sub',_0x5ddac9={'showId':_0x4feff4,'translationType':_0x3e122a,'episodeString':String(_0x3055fe)},_0x3d4933=_0x563f32(0x17c),_0x5ebad0=ALLANIME_API+_0x563f32(0x178)+encodeURIComponent(JSON['stringify'](_0x5ddac9))+'&extensions='+encodeURIComponent(JSON[_0x563f32(0x1bb)]({'persistedQuery':{'version':0x1,'sha256Hash':_0x3d4933}})),_0x530f6c={'User-Agent':AGENT,'Accept':_0x563f32(0x157),'Referer':_0x563f32(0x1a5),'Origin':ALLANIME_BASE};try{const _0xf1d365=yield fetch(_0x5ebad0,{'headers':_0x530f6c});if(!_0xf1d365['ok'])return console[_0x563f32(0x14f)](_0x563f32(0x16c),_0xf1d365['status']),[];const _0x8ec7a0=yield _0xf1d365[_0x563f32(0x180)]();if((_0x41d349=_0x8ec7a0==null?void 0x0:_0x8ec7a0['data'])==null?void 0x0:_0x41d349[_0x563f32(0x19b)]){const _0x298734=decryptToBeParsed(_0x8ec7a0[_0x563f32(0x16f)]['tobeparsed']);if(_0x298734)try{const _0x1bb6c9=JSON[_0x563f32(0x14e)](_0x298734);if((_0x232cef=_0x1bb6c9==null?void 0x0:_0x1bb6c9[_0x563f32(0x1b3)])==null?void 0x0:_0x232cef[_0x563f32(0x146)])return _0x1bb6c9[_0x563f32(0x1b3)]['sourceUrls'];}catch(_0x5af37b){console[_0x563f32(0x14f)](_0x563f32(0x18c),_0x5af37b,_0x298734['substring'](0x0,0x64));}return[];}return((_0x538cff=(_0x2de22d=_0x8ec7a0==null?void 0x0:_0x8ec7a0['data'])==null?void 0x0:_0x2de22d[_0x563f32(0x1b3)])==null?void 0x0:_0x538cff[_0x563f32(0x146)])||[];}catch(_0x4e560d){return console['error'](_0x563f32(0x1a6),_0x4e560d),[];}});}function fetchLinksFromProvider(_0x3e9921){return __async(this,null,function*(){const _0x4265f0=_0x50b4;try{const _0x2fd86d=_0x3e9921['startsWith'](_0x4265f0(0x161))?_0x3e9921:ALLANIME_BASE+_0x3e9921,_0x5115b2=yield fetch(_0x2fd86d,{'headers':{'User-Agent':AGENT,'Referer':ALLANIME_BASE+'/'}});if(!_0x5115b2['ok'])return[];const _0x17e8e1=yield _0x5115b2[_0x4265f0(0x180)](),_0x117979=[];if(_0x17e8e1['links']&&Array[_0x4265f0(0x175)](_0x17e8e1[_0x4265f0(0x173)]))_0x117979[_0x4265f0(0x164)](..._0x17e8e1['links'][_0x4265f0(0x189)](_0xb2b7a9=>({'url':_0xb2b7a9[_0x4265f0(0x156)],'quality':_0xb2b7a9[_0x4265f0(0x1b1)]||'Unknown','headers':{'User-Agent':AGENT}})));else{if(_0x17e8e1[_0x4265f0(0x16f)]){const _0x50f325=decryptToBeParsed(_0x17e8e1['data']);try{const _0x5f2b11=JSON[_0x4265f0(0x14e)](_0x50f325),_0x50eb83=Array['isArray'](_0x5f2b11)?_0x5f2b11:_0x5f2b11['links']||[];_0x117979[_0x4265f0(0x164)](..._0x50eb83[_0x4265f0(0x189)](_0xd985b4=>({'url':_0xd985b4['link'],'quality':_0xd985b4['resolutionStr']||'Unknown','headers':{'User-Agent':AGENT}})));}catch(_0x45ebe5){console[_0x4265f0(0x14f)](_0x4265f0(0x195),_0x45ebe5);}}}return _0x117979;}catch(_0x58e08e){return console[_0x4265f0(0x14f)](_0x4265f0(0x18e),_0x58e08e),[];}});}function _0x50b4(_0x5cb40f,_0x2b5308){_0x5cb40f=_0x5cb40f-0x143;const _0x210b00=_0x210b();let _0x50b444=_0x210b00[_0x5cb40f];if(_0x50b4['sGfBNi']===undefined){var _0x6bd1cf=function(_0x1c3d89){const _0x4e39a1='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x4d6e64='',_0x1479a4='';for(let _0x43d1ab=0x0,_0x4f420e,_0x28dd29,_0x109112=0x0;_0x28dd29=_0x1c3d89['charAt'](_0x109112++);~_0x28dd29&&(_0x4f420e=_0x43d1ab%0x4?_0x4f420e*0x40+_0x28dd29:_0x28dd29,_0x43d1ab++%0x4)?_0x4d6e64+=String['fromCharCode'](0xff&_0x4f420e>>(-0x2*_0x43d1ab&0x6)):0x0){_0x28dd29=_0x4e39a1['indexOf'](_0x28dd29);}for(let _0x5acb95=0x0,_0x19023b=_0x4d6e64['length'];_0x5acb95<_0x19023b;_0x5acb95++){_0x1479a4+='%'+('00'+_0x4d6e64['charCodeAt'](_0x5acb95)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x1479a4);};_0x50b4['qViKss']=_0x6bd1cf,_0x50b4['MggyNI']={},_0x50b4['sGfBNi']=!![];}const _0x1336d4=_0x210b00[0x0],_0x3ebf01=_0x5cb40f+_0x1336d4,_0x1092d5=_0x50b4['MggyNI'][_0x3ebf01];return!_0x1092d5?(_0x50b444=_0x50b4['qViKss'](_0x50b444),_0x50b4['MggyNI'][_0x3ebf01]=_0x50b444):_0x50b444=_0x1092d5,_0x50b444;}function getAnilistId(_0xca0663,_0x2351c1){return __async(this,null,function*(){const _0x7d7c5a=_0x50b4;try{const _0x41a075=_0x7d7c5a(0x1b7)+_0xca0663,_0x46f521=yield fetch(_0x41a075);if(_0x46f521['ok']){const _0x108b74=yield _0x46f521[_0x7d7c5a(0x180)]();if(Array['isArray'](_0x108b74)&&_0x108b74['length']>0x0&&_0x108b74[0x0][_0x7d7c5a(0x190)])return _0x108b74[0x0][_0x7d7c5a(0x190)];}}catch(_0x4bd60e){console['error'](_0x7d7c5a(0x15f),_0x4bd60e);}return null;});}function getAnilistMeta(_0x4a3456){return __async(this,null,function*(){const _0x235ae9=_0x50b4;var _0x2e8be1;const _0x1d0027=_0x235ae9(0x166);try{const _0xb3e40c=yield fetch('https://graphql.anilist.co',{'method':'POST','headers':{'Content-Type':_0x235ae9(0x167),'Accept':'application/json'},'body':JSON[_0x235ae9(0x1bb)]({'query':_0x1d0027,'variables':{'id':parseInt(_0x4a3456)}})});if(_0xb3e40c['ok']){const _0x3fc055=yield _0xb3e40c[_0x235ae9(0x180)]();return(_0x2e8be1=_0x3fc055[_0x235ae9(0x16f)])==null?void 0x0:_0x2e8be1['Media'];}}catch(_0x32d788){}return null;});}function resolveAnilistEpisode(_0x5b8b85,_0x4f282e,_0x3409d1,_0xfab697){return __async(this,null,function*(){const _0x341e6e=_0x50b4,_0x75f294=yield getAnilistMeta(_0x5b8b85);if(!_0x75f294)return{'title':null,'ep':_0x3409d1};const _0x3ac1d2=_0x75f294[_0x341e6e(0x1ae)][_0x341e6e(0x17b)]||_0x75f294['title'][_0x341e6e(0x1b5)]||'';return{'title':_0x3ac1d2,'ep':_0x3409d1};});}function getStreams(_0x4fdcbd,_0x201f36,_0x1e9786,_0x4e7317){return __async(this,null,function*(){const _0x147f6e=_0x50b4,_0x29e328=_0x4fdcbd,_0x585b61=yield getAnilistId(_0x29e328,_0x201f36);console[_0x147f6e(0x144)]('Anilist\x20ID:',_0x585b61);let _0x242caa=_0x147f6e(0x1bf),_0x414797=String(_0x4e7317),_0x641ea2=String(_0x4e7317);if(_0x585b61){const _0x51ec9a=yield resolveAnilistEpisode(_0x585b61,_0x1e9786,_0x4e7317,_0x201f36);console[_0x147f6e(0x144)](_0x147f6e(0x171),_0x51ec9a),_0x242caa=_0x51ec9a[_0x147f6e(0x1ae)]||_0x242caa,_0x414797=String(_0x51ec9a['ep']),_0x641ea2=String(_0x51ec9a['ep']);}else try{const _0x454ae8=yield fetch('https://api.themoviedb.org/3/'+(_0x201f36===_0x147f6e(0x1aa)?_0x147f6e(0x1aa):'tv')+'/'+_0x29e328+_0x147f6e(0x1bd));if(_0x454ae8['ok']){const _0x57f89b=yield _0x454ae8[_0x147f6e(0x180)]();_0x242caa=_0x57f89b[_0x147f6e(0x16d)]||_0x57f89b[_0x147f6e(0x1ae)]||_0x242caa;}}catch(_0x3cfcaa){}console[_0x147f6e(0x144)](_0x147f6e(0x16b),_0x242caa);const _0xa0ca3e=[_0x242caa],[_0x42ee0b,_0x30443b]=yield Promise[_0x147f6e(0x155)]([searchAnime(_0xa0ca3e[0x0],_0x147f6e(0x194))[_0x147f6e(0x192)](()=>[]),searchAnime(_0xa0ca3e[0x0],'dub')[_0x147f6e(0x192)](()=>[])]);console[_0x147f6e(0x144)](_0x147f6e(0x19f)+_0x42ee0b[_0x147f6e(0x1c2)]+_0x147f6e(0x188)+_0x30443b[_0x147f6e(0x1c2)]);const _0x35cac6=(_0x364788,_0x4a1f3a)=>{const _0x245c94=_0x147f6e;if(!_0x364788||_0x364788[_0x245c94(0x1c2)]===0x0)return null;let _0x10f9dc=0x0,_0x47676f=null;for(const _0x1551fe of _0x364788){const _0x3ddd05=getSimilarity(_0x1551fe[_0x245c94(0x16d)],_0x4a1f3a);_0x3ddd05>_0x10f9dc&&(_0x10f9dc=_0x3ddd05,_0x47676f=_0x1551fe);}if(_0x47676f&&_0x10f9dc>0.4)return _0x47676f;return _0x364788[0x0];};let _0x30f471=_0x35cac6(_0x42ee0b,_0x242caa),_0x5a10bc=_0x35cac6(_0x30443b,_0x242caa);const _0x328a1a=[],_0x3ece6d=(_0x23982e,_0x25454c,_0x57f403)=>__async(this,null,function*(){const _0x139973=_0x147f6e;if(!_0x23982e)return;const _0x4d65af=yield getRawStreamSources(_0x23982e['id'],_0x57f403,_0x25454c[_0x139973(0x1b0)]());console[_0x139973(0x144)]('['+_0x25454c+_0x139973(0x17d)+_0x4d65af['length']+_0x139973(0x1a1));const _0x2b948d=[_0x139973(0x160),_0x139973(0x150),_0x139973(0x1a7),_0x139973(0x172),_0x139973(0x168),'Sl-mp4'];for(const _0x55c20b of _0x4d65af){const _0x1e51c1=_0x55c20b[_0x139973(0x1c5)]||'';let _0x3d56cf=_0x55c20b['sourceUrl'];if(_0x3d56cf['startsWith']('--')){_0x3d56cf=decryptProviderId(_0x3d56cf['substring'](0x2));if(!_0x3d56cf){console[_0x139973(0x144)]('['+_0x25454c+_0x139973(0x15e)+_0x1e51c1);continue;}}console[_0x139973(0x144)]('['+_0x25454c+']\x20'+_0x1e51c1+':\x20'+_0x3d56cf[_0x139973(0x179)](0x0,0x50));if(_0x3d56cf[_0x139973(0x1b8)](_0x139973(0x182))){_0x328a1a[_0x139973(0x164)]({'url':_0x3d56cf,'quality':'1080p','provider':_0x139973(0x14a)+_0x1e51c1+'\x20('+_0x25454c+')','headers':{'Referer':_0x139973(0x158),'User-Agent':AGENT}});continue;}if(_0x3d56cf[_0x139973(0x1b8)](_0x139973(0x19a))||_0x3d56cf['includes'](_0x139973(0x151))){const _0x19e4a1=_0x3d56cf[_0x139973(0x1ac)](_0x139973(0x161))?_0x3d56cf:ALLANIME_BASE+_0x3d56cf,_0x21fea8=yield fetchLinksFromProvider(_0x19e4a1);for(const _0x347fa5 of _0x21fea8){const _0x312468=_0x347fa5[_0x139973(0x1a2)]||'';if(!_0x312468)continue;const _0x3d5aca=_0x312468[_0x139973(0x170)](/repackager\.wixmp\.com\/([^,]+)\/((?:,[^,]+)+,?)\/mp4\/file\.mp4/);if(_0x3d5aca){const _0x5b17ff=_0x3d5aca[0x1],_0x496b2f=_0x3d5aca[0x2][_0x139973(0x14d)](',')[_0x139973(0x1a4)](_0x4429ca=>_0x4429ca[_0x139973(0x1c2)]>0x0);for(const _0x473afe of _0x496b2f){_0x328a1a[_0x139973(0x164)]({'url':_0x139973(0x181)+_0x5b17ff+'/'+_0x473afe+_0x139973(0x199),'quality':_0x473afe,'provider':_0x139973(0x14a)+_0x1e51c1+'\x20('+_0x25454c+')','headers':{'User-Agent':AGENT}});}}else _0x328a1a[_0x139973(0x164)]({'url':_0x312468,'quality':_0x347fa5[_0x139973(0x15c)]||_0x347fa5[_0x139973(0x1b1)]||_0x139973(0x145),'provider':_0x139973(0x14a)+_0x1e51c1+'\x20('+_0x25454c+')','headers':Object['assign']({'Referer':'https://allanime.day'},_0x347fa5[_0x139973(0x1c0)]||{})});}continue;}if(_0x55c20b[_0x139973(0x186)]===_0x139973(0x148)){console[_0x139973(0x144)]('['+_0x25454c+_0x139973(0x14b)+_0x1e51c1);continue;}}});return yield Promise[_0x147f6e(0x155)]([_0x3ece6d(_0x30f471,'Sub',_0x414797),_0x3ece6d(_0x5a10bc,'Dub',_0x641ea2)]),_0x328a1a[_0x147f6e(0x189)](_0x41e1e5=>{const _0x4d4b6a=_0x147f6e;let _0xd3b67b=_0x4d4b6a(0x174);if(_0x41e1e5[_0x4d4b6a(0x15c)]){const _0xb148ad=_0x41e1e5['quality'][_0x4d4b6a(0x170)](/\d+p/i);if(_0xb148ad)_0xd3b67b=_0xb148ad[0x0];else{if(_0x41e1e5['quality']['toLowerCase']()===_0x4d4b6a(0x152))_0xd3b67b=_0x4d4b6a(0x18b);}}return{'name':_0x41e1e5[_0x4d4b6a(0x193)],'title':_0x41e1e5[_0x4d4b6a(0x193)]+_0x4d4b6a(0x1c3)+_0x41e1e5[_0x4d4b6a(0x15c)],'url':_0x41e1e5[_0x4d4b6a(0x1a2)],'quality':_0xd3b67b,'headers':_0x41e1e5[_0x4d4b6a(0x1c0)]};});});}module[_0x4c27ee(0x149)]={'name':_0x4c27ee(0x1af),'getStreams':getStreams};
/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "allanime", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();

/* CLOUDBANK_PLAYIMDB_DISPLAY_START */
/* CLOUDBANK_PLAYIMDB_DISPLAY_V1
 * Embedded in each provider: the app downloads standalone JavaScript files.
 * Presentation only. No network requests and no changes to playback fields.
 */
function cloudbankDisplayInstall(provider, providerName, providerId) {
  if (providerId === "playimdb") return provider; // Reference output stays exactly upstream.
  var details = Object.create(null);
  var keys = [];
  function remember(key, value) {
    if (!details[key]) keys.push(key);
    details[key] = value;
    while (keys.length > 16) delete details[keys.shift()];
  }
  if (typeof vueoSharedTmdb === "function") {
    var shared = vueoSharedTmdb;
    vueoSharedTmdb = function(url, fallback) {
      var match = /\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(String(url));
      return Promise.resolve(shared(url, fallback)).then(function(value) {
        if (match && value && typeof value === "object") remember(match[1] + "/" + match[2], value);
        return value;
      });
    };
  }
  function clean(value) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return String(value).replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF\uFE0F\u200D]/g, "").replace(/\s+/g, " ").trim();
  }
  function usable(value) {
    var text = clean(value);
    return /^(?:unknown(?: title)?|n\/?a|none|null|undefined|auto|stream|original[- ]audio)$/i.test(text) ? "" : text;
  }
  function unique(list) {
    return list.filter(function(value, index) { return value && list.indexOf(value) === index; });
  }
  var languages = { en: "English", eng: "English", english: "English", ms: "Malay", msa: "Malay", may: "Malay", malay: "Malay", id: "Indonesian", ind: "Indonesian", indo: "Indonesian", indonesian: "Indonesian", hi: "Hindi", hin: "Hindi", hindi: "Hindi", ta: "Tamil", tam: "Tamil", tamil: "Tamil", te: "Telugu", tel: "Telugu", telugu: "Telugu", ja: "Japanese", jpn: "Japanese", japanese: "Japanese", ko: "Korean", kor: "Korean", korean: "Korean", zh: "Chinese", zho: "Chinese", chi: "Chinese", chinese: "Chinese", es: "Spanish", spa: "Spanish", spanish: "Spanish", fr: "French", fra: "French", fre: "French", french: "French", de: "German", deu: "German", ger: "German", german: "German", ar: "Arabic", ara: "Arabic", arabic: "Arabic", pt: "Portuguese", por: "Portuguese", portuguese: "Portuguese", ru: "Russian", rus: "Russian", russian: "Russian", it: "Italian", ita: "Italian", italian: "Italian", th: "Thai", tha: "Thai", thai: "Thai", vi: "Vietnamese", vie: "Vietnamese", vietnamese: "Vietnamese", ml: "Malayalam", mal: "Malayalam", malayalam: "Malayalam", bn: "Bengali", ben: "Bengali", bengali: "Bengali", tr: "Turkish", tur: "Turkish", turkish: "Turkish" };
  function language(value) {
    var text = clean(value).toLowerCase().replace(/[-_](?:us|gb|my|id|cn|tw|br|pt)$/, "");
    return languages[text] || "";
  }
  function metadata(id, type) {
    if (details[type + "/" + id]) return details[type + "/" + id];
    var raw = typeof globalThis !== "undefined" ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (_) { raw = null; } }
    if (!raw || typeof raw !== "object") return {};
    var tmdb = raw.tmdb || raw;
    var contextId = raw.tmdbId || tmdb.id;
    if (String(contextId) !== String(id) || (raw.mediaType && raw.mediaType !== type)) return {};
    return tmdb;
  }
  function format(stream, index, meta, type, season, episode) {
    if (!stream || typeof stream !== "object" || !stream.url) return stream;
    var output = Object.assign({}, stream);
    var originalTitle = typeof stream.title === "string" ? stream.title : "";
    var displayTitle = usable(meta.title || meta.name);
    var year = /\b(?:19|20)\d{2}\b/.exec(clean(meta.release_date || meta.first_air_date || meta.year));
    var lines = [];
    if (displayTitle) {
      if (year) displayTitle += " (" + year[0] + ")";
      if (type === "tv" && Number.isInteger(Number(season)) && Number(season) >= 0 && Number(episode) >= 1) {
        displayTitle += " · S" + (Number(season) < 10 ? "0" : "") + Number(season) + "E" + (Number(episode) < 10 ? "0" : "") + Number(episode);
      }
      lines.push(displayTitle);
    } else {
      // Keep a source-provided content title when it is recognisable as one.
      var first = clean(originalTitle.split(/\r?\n/)[0]);
      var providerLabel = clean(providerName.replace(/\s+V\d+$/i, ""));
      var isProviderTitle = providerLabel && first.toLowerCase().indexOf(providerLabel.toLowerCase()) === 0;
      var isTechnicalTitle = /^(?:\d{3,4}p|4k|Server\s+\d+|Unknown|Subtitles:|WEB[- ]DL|BluRay|HLS|M3U8|MP4|DASH)\b/i.test(first);
      if (first && /[A-Za-z\u0080-\uFFFF]/.test(first) && !isProviderTitle && !isTechnicalTitle) lines.push(first);
    }
    var text = [stream.name, originalTitle, stream.fileName, stream.filename, stream.videoCodec, stream.codec, stream.audioCodec, stream.audioChannels, stream.releaseSource, stream.sourceQuality, stream.hdr].map(clean).join(" ");
    // Film titles containing words such as English or BluRay are not technical metadata.
    var contentTitle = clean(meta.title || meta.name) || (lines.length ? lines[0] : "");
    if (contentTitle) text = text.split(contentTitle).join("");
    var quality = usable(stream.quality);
    var resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p?\b/i.exec(quality);
    if (!resolution) resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p\b/i.exec(text);
    var qualityLabel = resolution ? (resolution[1] === "2160" ? "4K" : resolution[1] + "p") : (/\b4k\b/i.test(quality + " " + text) ? "4K" : "");
    var audioLang = language(stream.audioLanguage || stream.language || stream.lang);
    var audioLanguages = Array.isArray(stream.audioLanguages) ? unique(stream.audioLanguages.map(language)) : [];
    if (!audioLang && audioLanguages.length === 1) audioLang = audioLanguages[0];
    var explicitAudio = /\b(English|Malay|Indonesian|Hindi|Tamil|Telugu|Japanese|Korean|Chinese|Spanish|French|Arabic)[ -]Audio\b/i.exec(text);
    if (!audioLang && explicitAudio) audioLang = language(explicitAudio[1]);
    var labelledAudio = /🌍\s*([^|\n]+)/.exec(originalTitle);
    if (!audioLang && labelledAudio) audioLang = language(labelledAudio[1]);
    var filenameAudio = /(?:^|[._ -])(English|Malay|Indonesian|Hindi|Tamil|Telugu|Japanese|Korean|Chinese)(?=[._ -]|$)/i.exec(clean(stream.fileName || stream.filename));
    if (!audioLang && filenameAudio) audioLang = language(filenameAudio[1]);
    // MovieBlast exposes its language as a trailing parenthesised code.
    var parenthesised = /\(([A-Za-z]{2,3})\)\s*$/.exec(clean(originalTitle));
    if (!audioLang && parenthesised) audioLang = language(parenthesised[1]);
    var audioLabel = audioLang ? audioLang + " Audio" : "";
    if (audioLanguages.length > 1) audioLabel = "Multi Audio (" + audioLanguages.join(", ") + ")";
    if (/^original$/i.test(clean(stream.audioLanguage)) || /\boriginal[- ]audio\b/i.test(text)) audioLabel = "Original Audio";
    if (/\bdual[- ]audio\b/i.test(text)) audioLabel = "Dual Audio" + (audioLang ? " (" + audioLang + ")" : "");
    else if (/\b(?:multi[- ]audio|multilingual)\b/i.test(text)) audioLabel = "Multi Audio" + (audioLang ? " (" + audioLang + ")" : "");
    var server = usable(stream.serverName || stream.server || stream.sourceName);
    var labelledServer = /📌\s*([^|\n]+)/.exec(originalTitle);
    if (!server && labelledServer) server = usable(labelledServer[1]);
    if (!server) {
      server = clean(stream.name);
      [providerName, providerName.replace(/\s+V\d+$/i, ""), providerId, providerId.replace(/-v\d+$/, "")].forEach(function(label) {
        label = clean(label);
        if (!label) return;
        if (server.toLowerCase().indexOf(label.toLowerCase()) === 0) server = server.slice(label.length).trim();
      });
      if (!server) {
        var titleServer = clean(originalTitle);
        var baseLabel = clean(providerName.replace(/\s+V\d+$/i, ""));
        if (baseLabel && titleServer.toLowerCase().indexOf(baseLabel.toLowerCase() + " - ") === 0) {
          server = titleServer.slice(baseLabel.length + 3).replace(/\([A-Za-z]{2,3}\)\s*$/, "").trim();
        }
      }
      server = server.replace(/\b\d{3,4}p\b|\b(?:4k|FHD|UHD|Auto)\b/gi, "")
        .replace(/\((?:English|Hindi|Tamil|Telugu|Malay|Indonesian|EN|HI|TA|TE|MS|ID)\)/gi, "").trim();
      // Keep descriptive host names; omit names consisting of quality/audio labels.
      if (/\b(?:\d{3,4}p|4k|audio|FHD|UHD|HLS|M3U8|MP4|BluRay|WEB-DL)\b/i.test(server)) {
        var numbered = /\bServer\s+\d+\b/i.exec(server);
        server = numbered ? numbered[0] : "";
      }
      server = usable(server.replace(/^[|·: -]+|[|·: -]+$/g, ""));
      if (server.length > 80) server = "";
    }
    if (!server) server = "Server " + (index + 1);
    var path = String(stream.url).split(/[?#]/)[0];
    var formatLabel = /\.m3u8$/i.test(path) ? "HLS" : /\.mp4$/i.test(path) ? "MP4" : /\.mkv$/i.test(path) ? "MKV" : /\.mpd$/i.test(path) ? "DASH" : "";
    if (!formatLabel) {
      var declared = clean(stream.format || stream.mimeType || stream.type);
      if (/^(?:hls|m3u8|application\/(?:vnd\.apple\.mpegurl|x-mpegurl))$/i.test(declared)) formatLabel = "HLS";
      else if (/^(?:mp4|video\/mp4)$/i.test(declared)) formatLabel = "MP4";
      else if (/^(?:dash|application\/dash\+xml)$/i.test(declared)) formatLabel = "DASH";
    }
    var minutes = Number(stream.runtimeMinutes || (type === "movie" ? meta.runtime : 0));
    var duration = minutes > 0 && Number.isFinite(minutes) ? Math.round(minutes) + " min" : "";
    if (!duration) { var dm = /\b(\d+)\s*min(?:utes)?\b/i.exec(clean(stream.duration) + " " + text); if (dm && Number(dm[1]) > 0) duration = dm[1] + " min"; }
    var firstLine = lines.length ? "🎬 " + lines[0] : "";
    // Match PlayIMDb's original typography and order, without its guessed defaults.
    if (displayTitle) {
      firstLine = type === "tv" ? "🎬 " + usable(meta.title || meta.name) + " - S" + Number(season) + "E" + Number(episode) + (year ? " (" + year[0] + ")" : "") :
        "🎬 " + usable(meta.title || meta.name) + (year ? " - " + year[0] : "");
    }
    var qualityDisplay = qualityLabel === "4K" ? "2160P" : qualityLabel.toUpperCase();
    var audioDisplay = audioLabel.replace(/[- ]Audio/g, "").trim();
    var infoLine = [qualityDisplay ? "💎 " + qualityDisplay : "", audioDisplay ? "🌍 " + audioDisplay : ""].filter(Boolean).join(" | ");
    var bottomLine = [formatLabel ? "🎞️ " + (formatLabel === "HLS" ? "M3U8" : formatLabel) : "", duration ? "⏱️ " + duration : "", "📌 " + server].filter(Boolean).join(" | ");
    var nameQuality = qualityLabel === "4K" ? "4K UHD" : qualityLabel === "1080p" ? "1080p FHD" : qualityLabel === "720p" ? "720p HD" : qualityLabel;
    output.name = ["🟡 " + providerName, nameQuality, audioLabel ? audioLabel.replace(/ Audio/g, "-Audio") : ""].filter(Boolean).join(" | ");
    output.title = [firstLine, infoLine, bottomLine].filter(Boolean).join("\n");
    return output;
  }
  var original = provider.getStreams;
  var adapted = Object.assign({}, provider);
  adapted.getStreams = function(id, type, season, episode) {
    var args = arguments;
    var mediaType = type === "series" ? "tv" : type;
    return Promise.resolve().then(function() { return original.apply(provider, args); }).then(function(streams) {
      if (!Array.isArray(streams)) return streams;
      var meta = metadata(id, mediaType);
      return streams.map(function(stream, index) {
        try { return format(stream, index, meta, mediaType, season, episode); } catch (_) { return stream; }
      });
    });
  };
  return adapted;
}
module.exports = cloudbankDisplayInstall(module.exports, "AllAnime", "allanime");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
