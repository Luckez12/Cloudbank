// Imported provider: dahmermovies; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0xb19ab1=_0x1c29;function _0x3cc9(){const _0x36befe=['ANnVBG','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','lI4V','icb8icdWN5k+ia','icb8icdIHlNVUi8G','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYnc4WlJaUmcbtywzHCMKVntm3lJm2','BMv4Da','AhjLzG','mJiXmtK0mejoq3jyzG','DgHLBG','A2vLCc1HBgL2zq','zxHWB3j0CW','Bwf0y2G','yxbWBhK','tI9b','w0rHAg1LCK1VDMLLC10Gsw5PDgLHBgL6Aw5NifnJCMfWzxi','8j+tUIa','C2XPy2u','Ahr0Chm6lY9WlJeXmtq3nY54ExOVyNvSAZ91pq','z2v0u3rYzwfTCW','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','Dgv4Da','mtiZmKjcwvnQra','ndKZmteYmfr4AuHerG','zxHLyW','CMvZB2X2zq','mtm0ntKYnerJyKvOsa','mZbRrLbvBfq','yNL0zxm9mc0','mJeYotyWmuvsBvzZqq','DgvZDa','Ahr0Ca','mtCWmtzHEMz4qxm','l21VDMLLCY8','Bg9N','DgL0Bgu','C3rHCNrZv2L0Aa','mtiYote3nxv2vejnDG','t3jPz2LUywW','zgfOBwvYBw92AwvZ','l1nLyxnVBIuYma','icb8icdWN46E77Ipia','mJHVB3L5u2q','ChvZAa','C2L6zq','BMfTzq','Dg9vChbLCKnHC2u','l3r2CY8','icb8icdWN4Yqia','CMvSzwfZzv9KyxrL','rw5NBgLZAa','Aw5JBhvKzxm','Dw5KzwzPBMvK','Bw92Awu','p2fWAv9RzxK9','ntK3ntGYmfLABK5Qva','teLosW','DhjPBq','CMvWBgfJzq','DMfSDwu'];_0x3cc9=function(){return _0x36befe;};return _0x3cc9();}(function(_0x1db96a,_0x538e65){const _0x503397=_0x1c29,_0x5204c=_0x1db96a();while(!![]){try{const _0x4c3612=parseInt(_0x503397(0x172))/0x1+parseInt(_0x503397(0x160))/0x2+-parseInt(_0x503397(0x175))/0x3+-parseInt(_0x503397(0x182))/0x4*(parseInt(_0x503397(0x17d))/0x5)+-parseInt(_0x503397(0x178))/0x6*(parseInt(_0x503397(0x16e))/0x7)+-parseInt(_0x503397(0x16f))/0x8+parseInt(_0x503397(0x153))/0x9*(parseInt(_0x503397(0x173))/0xa);if(_0x4c3612===_0x538e65)break;else _0x5204c['push'](_0x5204c['shift']());}catch(_0xfb33af){_0x5204c['push'](_0x5204c['shift']());}}}(_0x3cc9,0xdb23c));var __async=(_0x45e41a,_0x51e1a,_0x4062f3)=>{return new Promise((_0x5b0a50,_0x172787)=>{const _0x3b5821=_0x1c29;var _0x2df394=_0x41e437=>{const _0x2306a7=_0x1c29;try{_0x4bb7d4(_0x4062f3[_0x2306a7(0x15e)](_0x41e437));}catch(_0x3ff30b){_0x172787(_0x3ff30b);}},_0x4ed7dd=_0x44ec8a=>{try{_0x4bb7d4(_0x4062f3['throw'](_0x44ec8a));}catch(_0x500bc9){_0x172787(_0x500bc9);}},_0x4bb7d4=_0x1c97cc=>_0x1c97cc['done']?_0x5b0a50(_0x1c97cc[_0x3b5821(0x157)]):Promise[_0x3b5821(0x171)](_0x1c97cc[_0x3b5821(0x157)])[_0x3b5821(0x161)](_0x2df394,_0x4ed7dd);_0x4bb7d4((_0x4062f3=_0x4062f3[_0x3b5821(0x165)](_0x45e41a,_0x51e1a))[_0x3b5821(0x15e)]());});};console[_0xb19ab1(0x17a)](_0xb19ab1(0x167));var TMDB_API_KEY=_0xb19ab1(0x16c),DAHMER_MOVIES_API='https://a.111477.xyz',DAHMER_WORKER_API=_0xb19ab1(0x16a);function _0x1c29(_0x52502a,_0x203d6c){_0x52502a=_0x52502a-0x152;const _0x3cc9cd=_0x3cc9();let _0x1c2946=_0x3cc9cd[_0x52502a];if(_0x1c29['IshNFK']===undefined){var _0x1a02e4=function(_0x440d71){const _0x236ded='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x45e41a='',_0x51e1a='';for(let _0x4062f3=0x0,_0x5b0a50,_0x172787,_0x2df394=0x0;_0x172787=_0x440d71['charAt'](_0x2df394++);~_0x172787&&(_0x5b0a50=_0x4062f3%0x4?_0x5b0a50*0x40+_0x172787:_0x172787,_0x4062f3++%0x4)?_0x45e41a+=String['fromCharCode'](0xff&_0x5b0a50>>(-0x2*_0x4062f3&0x6)):0x0){_0x172787=_0x236ded['indexOf'](_0x172787);}for(let _0x4ed7dd=0x0,_0x4bb7d4=_0x45e41a['length'];_0x4ed7dd<_0x4bb7d4;_0x4ed7dd++){_0x51e1a+='%'+('00'+_0x45e41a['charCodeAt'](_0x4ed7dd)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x51e1a);};_0x1c29['TQcnBe']=_0x1a02e4,_0x1c29['uzEjSj']={},_0x1c29['IshNFK']=!![];}const _0x572af7=_0x3cc9cd[0x0],_0x881df4=_0x52502a+_0x572af7,_0x1149bd=_0x1c29['uzEjSj'][_0x881df4];return!_0x1149bd?(_0x1c2946=_0x1c29['TQcnBe'](_0x1c2946),_0x1c29['uzEjSj'][_0x881df4]=_0x1c2946):_0x1c2946=_0x1149bd,_0x1c2946;}function makeRequest(_0x4873c3){return __async(this,null,function*(){const _0xad7b78=_0x1c29;try{return yield fetch(_0x4873c3,{'headers':{'User-Agent':_0xad7b78(0x15d),'Referer':DAHMER_MOVIES_API+'/'}});}catch(_0x259102){return{'ok':![]};}});}function parseLinks(_0x4ebc26){const _0xfff8af=_0xb19ab1,_0x3e8d9a=[],_0x4718e3=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let _0x1cfdca;while((_0x1cfdca=_0x4718e3[_0xfff8af(0x170)](_0x4ebc26))!==null){const _0x5cee51=_0x1cfdca[0x1],_0x450106=_0x5cee51[_0xfff8af(0x164)](/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i),_0x508162=_0x5cee51[_0xfff8af(0x164)](/<td[^>]*>(\d+(?:\.\d+)?\s?[KMGT]B)<\/td>/i);if(_0x450106){const _0x1e531e=_0x450106[0x1],_0x3846ab=_0x450106[0x2]['trim'](),_0xe4ff8f=_0x508162?_0x508162[0x1][_0xfff8af(0x155)]():_0xfff8af(0x166);_0x3846ab&&_0x1e531e!==_0xfff8af(0x15a)&&/\.(mkv|mp4|avi|webm|m3u8)$/i['test'](_0x3846ab)&&_0x3e8d9a['push']({'text':_0x3846ab,'href':_0x1e531e,'size':_0xe4ff8f});}}return _0x3e8d9a;}function invokeDahmerMovies(_0x281b4d,_0x3875c7,_0x33dad9=null,_0x4ecc2c=null){return __async(this,null,function*(){const _0x5887e1=_0x1c29;var _0x22b1cb;const _0x2e17fa=_0x281b4d[_0x5887e1(0x156)](/:/g,''),_0x2db398=_0x33dad9!==null?[_0x5887e1(0x187)+encodeURIComponent(_0x2e17fa)+_0x5887e1(0x180)+(_0x33dad9<0xa?'0'+_0x33dad9:_0x33dad9)+'/','/tvs/'+encodeURIComponent(_0x2e17fa)+_0x5887e1(0x180)+_0x33dad9+'/']:[_0x5887e1(0x179)+encodeURIComponent(_0x2e17fa+'\x20('+_0x3875c7+')')+'/'];let _0x4a108a='',_0x577087='';for(const _0x235ef7 of _0x2db398){const _0x38edc5=DAHMER_MOVIES_API+_0x235ef7,_0xf926d=yield makeRequest(_0x38edc5);if(_0xf926d['ok']){_0x4a108a=yield _0xf926d['text'](),_0x577087=_0x38edc5;break;}}if(!_0x4a108a)return[];const _0x3e7c7c=parseLinks(_0x4a108a),_0x3e7a2d=_0x3e7c7c['sort']((_0x366190,_0x5dcba3)=>{const _0x1b17ed=_0x5887e1,_0x5a7dc3=/2160p|4k/i['test'](_0x366190[_0x1b17ed(0x16d)]),_0x4cab78=/2160p|4k/i[_0x1b17ed(0x176)](_0x5dcba3[_0x1b17ed(0x16d)]);return _0x4cab78-_0x5a7dc3;}),_0x1a99b6=[];for(const _0x250035 of _0x3e7a2d[_0x5887e1(0x169)](0x0,0x5)){let _0x18db41;if(_0x250035[_0x5887e1(0x15f)]['startsWith'](_0x5887e1(0x177)))_0x18db41=_0x250035[_0x5887e1(0x15f)];else _0x250035[_0x5887e1(0x15f)]['includes'](_0x5887e1(0x179))||_0x250035['href'][_0x5887e1(0x18b)](_0x5887e1(0x187))?_0x18db41=DAHMER_MOVIES_API+(_0x250035[_0x5887e1(0x15f)][_0x5887e1(0x17c)]('/')?'':'/')+_0x250035['href']:_0x18db41=_0x577087+_0x250035['href'];_0x18db41=_0x18db41[_0x5887e1(0x156)](/([^:]\/)\/+/g,'$1'),_0x18db41=decodeURI(_0x18db41);let _0x1ca44d=DAHMER_WORKER_API+encodeURI(_0x18db41);const _0x41c687=_0x250035[_0x5887e1(0x16d)];let _0x4c99c0=_0x5887e1(0x17e);const _0x5dfb1a=/\b(HIN|TAM|TEL|Multi|Dual|DUB|Multi-Audio|MULTI)\b/i['test'](_0x41c687),_0x104fa7=/\b(Eng|English)\b/i[_0x5887e1(0x176)](_0x41c687),_0xb619f6=/^[a-zA-Z0-9\s?!\-:]+$/[_0x5887e1(0x176)](_0x281b4d);if(_0x5dfb1a)_0x4c99c0='Multi\x20Audio';else{if(_0xb619f6&&_0x104fa7)_0x4c99c0=_0x5887e1(0x18a);}const _0x5f1538=_0x41c687['match'](/\.(mkv|mp4|m3u8|avi|webm)$/i),_0x4aa592=_0x5f1538?_0x5f1538[0x1][_0x5887e1(0x186)]():_0x5887e1(0x154),_0x2c2ff8=((_0x22b1cb=_0x41c687[_0x5887e1(0x164)](/\b(2160p|1080p|720p|4k)\b/i))==null?void 0x0:_0x22b1cb[0x0])||'1080p',_0x541e77=_0x250035['size']!==_0x5887e1(0x166)?_0x250035[_0x5887e1(0x184)]:'N/A';let _0x8155f9=_0x41c687[_0x5887e1(0x156)](/\.(mkv|mp4|avi|webm|m3u8)$/i,'')[_0x5887e1(0x156)](/[\[\]()._-]/g,'\x20')[_0x5887e1(0x156)](/\s+/g,'\x20')['trim']();_0x1a99b6[_0x5887e1(0x183)]({'name':'DahmerMovies','title':_0x5887e1(0x168)+_0x2c2ff8+_0x5887e1(0x188)+_0x4c99c0+_0x5887e1(0x15b)+_0x541e77+_0x5887e1(0x181)+_0x4aa592+_0x5887e1(0x15c)+_0x8155f9,'url':_0x1ca44d,'quality':_0x2c2ff8['toLowerCase'](),'headers':{'User-Agent':_0x5887e1(0x15d),'Referer':DAHMER_MOVIES_API+'/','Connection':_0x5887e1(0x162),'Accept':'*/*','Range':_0x5887e1(0x174)},'provider':_0x5887e1(0x17f)});}return _0x1a99b6;});}function getStreams(_0x390bdb,_0x599059=_0xb19ab1(0x18d),_0x4513c8=null,_0x3bd20a=null){return __async(this,null,function*(){const _0x15855e=_0x1c29;var _0x4399bd;try{const _0x375ee9=_0x599059==='tv'?'tv':_0x15855e(0x18d),_0x269590=_0x15855e(0x159)+_0x375ee9+'/'+_0x390bdb+_0x15855e(0x152)+TMDB_API_KEY,_0x4732bf=yield makeRequest(_0x269590),_0x5d0d8c=yield _0x4732bf[_0x15855e(0x158)](),_0x5ea823=_0x599059==='tv'?_0x5d0d8c[_0x15855e(0x185)]:_0x5d0d8c[_0x15855e(0x17b)],_0x19bc73=(_0x4399bd=_0x599059==='tv'?_0x5d0d8c['first_air_date']:_0x5d0d8c[_0x15855e(0x189)])==null?void 0x0:_0x4399bd['substring'](0x0,0x4);if(!_0x5ea823)return[];return yield invokeDahmerMovies(_0x5ea823,_0x19bc73,_0x4513c8,_0x3bd20a);}catch(_0x294f5b){return[];}});}if(typeof module!==_0xb19ab1(0x18c))module[_0xb19ab1(0x163)]={'getStreams':getStreams};else global[_0xb19ab1(0x16b)]=getStreams;
/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "dahmermovies", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
