// Imported provider: vidlink; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x4d78f2=_0x2c1a;function _0x2c23(){const _0x523b48=['Bg9N','ihWGtwfPBIbnAxjYB3i','ANnVBG','l2vUyY12AwrSAw5Rp3rLEhq9','l2fWAs9Il21VDMLLlW','ndKYmJG1ELfnsLvb','yxv0BW','ngPoCwP5yq','C3rHCNrZv2L0Aa','CgXHEwXPC3q','ig1PBG','zxbPC29Kzv9YDw5FDgLTzq','A2vLCc1HBgL2zq','AgfZt3DUuhjVCgvYDhK','w1zPzgXPBMTDiezLDgnOAw5NihbSyxLSAxn0igzYB206ia','ihWG8j+mJsbpCMLNAw5HBcb8ipcFKR4G','zgvMAw5LuhjVCgvYDgLLCW','zxjYB3i','C3vIC3rYAw5N','mta4mhaGrKHe','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','qxv0BYbeEw5HBwLJ','Ahr0Chm6lY9LBMmTzgvJlMfWCc9HCgK','DgL0Bgu','mta4ma','Dgv4Da','zg9Uzq','odiYntq5yvn3vffW','mJe2mfa','mJu2nZKYveXKzKT2','nZiWua','zhvYyxrPB24','C3bSAxq','ChjVDg90ExbL','nZiWCcbira','nduGBwLU','zMLYC3rFywLYx2rHDgu','DMfSDwu','vMfYAwfIBguGu2L6zq','w00ZvtHDifbHCNnPBMCGBwfZDgvYig0ZDtG6ia','w1zPzgXPBMTDie5VigvUy3j5ChrLzcbjrcbYzxr1CM5Lza','w1zPzgXPBMTDievYCM9YoIa','BgvUz3rO','mZyW','cUkAOsa','neSGvuHe','w00ZvtHDievYCM9YihbHCNnPBMCGttnvocWGCMv0DxjUAw5NigvTChr5lG','Aw5JBhvKzxm','Dg9mB3DLCKnHC2u','w1zPzgXPBMTDiezHAwXLzcb0BYbWyxjZzsbLEhrYysbXDwfSAxrPzxmGzM9Yia','otaGBwLU','Ahr0Chm6lY92AwrSAw5RlNbYBW','y2fSBa','DgHYB3C','ogvxver1ta','ChjVCgvYDhLjC0vUDw1LCMfIBgu','mJe2ma','l2vWAxnVzguV','BMv4Da','vxnLCI1bz2vUDa','qxv0BW','ndeXmZyYner4thzgDa','ChvZAa','mtmZmZaYnNfWq2PmBa','B3jPz2LU','zMHK','ic0G','mJyYmJy5mgzbDwn1uq','nJHLmdK0nJK5nti1yJe4ytCWyMfImMy4nMiXzMe3mdy','p2fWAv9RzxK9','CNvUDgLTzq','DxjS','yxbWBhK','DgHLBG','nJCWmtGWs1HRsgfc','tI9b'];_0x2c23=function(){return _0x523b48;};return _0x2c23();}(function(_0x61193a,_0x334af4){const _0x1d1947={_0x2d0fd7:0x187,_0x35401c:0x1b6,_0x52732f:0x1a9,_0xb21edc:0x1ab},_0x3c87e8=_0x2c1a,_0x2788ce=_0x61193a();while(!![]){try{const _0x142824=parseInt(_0x3c87e8(0x1bf))/0x1*(parseInt(_0x3c87e8(0x189))/0x2)+parseInt(_0x3c87e8(_0x1d1947._0x2d0fd7))/0x3+-parseInt(_0x3c87e8(_0x1d1947._0x35401c))/0x4+-parseInt(_0x3c87e8(0x1bd))/0x5+-parseInt(_0x3c87e8(_0x1d1947._0x52732f))/0x6+parseInt(_0x3c87e8(0x1af))/0x7+-parseInt(_0x3c87e8(0x1a2))/0x8*(-parseInt(_0x3c87e8(_0x1d1947._0xb21edc))/0x9);if(_0x142824===_0x334af4)break;else _0x2788ce['push'](_0x2788ce['shift']());}catch(_0x3bf6c3){_0x2788ce['push'](_0x2788ce['shift']());}}}(_0x2c23,0x57a21));var __async=(_0x541021,_0x4133af,_0x4e4688)=>{const _0x4658ae={_0x5cf06d:0x1b4},_0x14d637={_0x50d1d7:0x1a6};return new Promise((_0x3914b8,_0x15cb6b)=>{const _0x40e13e=_0x2c1a;var _0x59c7e8=_0x297daa=>{const _0x3b0f26=_0x2c1a;try{_0x414964(_0x4e4688[_0x3b0f26(_0x14d637._0x50d1d7)](_0x297daa));}catch(_0x5656b8){_0x15cb6b(_0x5656b8);}},_0x18896d=_0xcfa585=>{try{_0x414964(_0x4e4688['throw'](_0xcfa585));}catch(_0x49e62a){_0x15cb6b(_0x49e62a);}},_0x414964=_0xcc0f3b=>_0xcc0f3b['done']?_0x3914b8(_0xcc0f3b[_0x40e13e(0x191)]):Promise['resolve'](_0xcc0f3b['value'])['then'](_0x59c7e8,_0x18896d);_0x414964((_0x4e4688=_0x4e4688[_0x40e13e(_0x4658ae._0x5cf06d)](_0x541021,_0x4133af))['next']());});},__defProp=Object['defineProperty'],__defProps=Object[_0x4d78f2(0x1c8)],__getOwnPropDescs=Object['getOwnPropertyDescriptors'],__getOwnPropSymbols=Object['getOwnPropertySymbols'],__hasOwnProp=Object['prototype'][_0x4d78f2(0x1c5)],__propIsEnum=Object[_0x4d78f2(0x18d)][_0x4d78f2(0x1a3)],__defNormalProp=(_0x2adf9c,_0x1da427,_0x2589c6)=>_0x1da427 in _0x2adf9c?__defProp(_0x2adf9c,_0x1da427,{'enumerable':!![],'configurable':!![],'writable':!![],'value':_0x2589c6}):_0x2adf9c[_0x1da427]=_0x2589c6,__spreadValues=(_0x48738e,_0x51c4c4)=>{const _0x1295e3=_0x4d78f2;for(var _0x1c55ae in _0x51c4c4||(_0x51c4c4={}))if(__hasOwnProp[_0x1295e3(0x1a0)](_0x51c4c4,_0x1c55ae))__defNormalProp(_0x48738e,_0x1c55ae,_0x51c4c4[_0x1c55ae]);if(__getOwnPropSymbols)for(var _0x1c55ae of __getOwnPropSymbols(_0x51c4c4)){if(__propIsEnum['call'](_0x51c4c4,_0x1c55ae))__defNormalProp(_0x48738e,_0x1c55ae,_0x51c4c4[_0x1c55ae]);}return _0x48738e;},__spreadProps=(_0x560518,_0x44c238)=>__defProps(_0x560518,__getOwnPropDescs(_0x44c238)),__async2=(_0xc3dbce,_0x519e1c,_0x29be60)=>{const _0x4b1b8c={_0x5e6688:0x1b4};return new Promise((_0x128a75,_0x4939c0)=>{const _0x52a740={_0x2c7c37:0x1a6},_0x37bc57=_0x2c1a;var _0x18594d=_0x7a5008=>{const _0x3c46a4=_0x2c1a;try{_0x2d029e(_0x29be60[_0x3c46a4(_0x52a740._0x2c7c37)](_0x7a5008));}catch(_0x1fa5e8){_0x4939c0(_0x1fa5e8);}},_0x124519=_0x38df2a=>{const _0x1f1735=_0x2c1a;try{_0x2d029e(_0x29be60[_0x1f1735(0x1a1)](_0x38df2a));}catch(_0x29a84f){_0x4939c0(_0x29a84f);}},_0x2d029e=_0x54316d=>_0x54316d[_0x37bc57(0x1d2)]?_0x128a75(_0x54316d['value']):Promise['resolve'](_0x54316d['value'])[_0x37bc57(0x1b5)](_0x18594d,_0x124519);_0x2d029e((_0x29be60=_0x29be60[_0x37bc57(_0x4b1b8c._0x5e6688)](_0xc3dbce,_0x519e1c))['next']());});},VIDLINK_API=_0x4d78f2(0x19f),DECRYPT_API=_0x4d78f2(0x1ce),TMDB_API_KEY=_0x4d78f2(0x1b0),HEADERS={'User-Agent':'Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/122.0.0.0\x20Safari/537.36','Connection':_0x4d78f2(0x1c4),'Referer':'https://vidlink.pro/','Origin':_0x4d78f2(0x19f)};function formatBytes(_0x1d12de){const _0x318664=_0x4d78f2;if(!_0x1d12de||isNaN(_0x1d12de))return _0x318664(0x192);const _0x5de26c=['B','KB','MB','GB'];let _0x4321bd=0x0;while(_0x1d12de>=0x400&&_0x4321bd<_0x5de26c['length']-0x1){_0x1d12de/=0x400,_0x4321bd++;}return _0x1d12de['toFixed'](0x2)+'\x20'+_0x5de26c[_0x4321bd];}function calculateCalculatedFallbackSize(_0x43887c,_0x5cf79f){const _0x327021={_0xbbe2b2:0x19b},_0x255778=_0x4d78f2,_0x392511=parseInt(_0x5cf79f)||0x5a,_0x35a1f3=String(_0x43887c||'')[_0x255778(0x19c)]();let _0x3e68ae=0x1450;if(_0x35a1f3[_0x255778(_0x327021._0xbbe2b2)]('4k')||_0x35a1f3[_0x255778(_0x327021._0xbbe2b2)](_0x255778(0x1a4)))_0x3e68ae=0x3e80;else{if(_0x35a1f3['includes']('1080')||_0x35a1f3[_0x255778(0x19b)]('fhd'))_0x3e68ae=0x1450;else{if(_0x35a1f3['includes']('720')||_0x35a1f3['includes']('hd'))_0x3e68ae=0x9c4;else{if(_0x35a1f3['includes']('480')||_0x35a1f3[_0x255778(0x19b)]('sd'))_0x3e68ae=0x4b0;}}}const _0x255b95=0.94+_0x392511%0x9/0x64,_0x18c7b9=_0x3e68ae*_0x255b95*0x3e8/0x8*(_0x392511*0x3c);return formatBytes(_0x18c7b9);}function getTmdbMetadata(_0xde73a7,_0x276019,_0x109a4a,_0x1c3436){const _0x44cc41={_0x48e935:0x18f,_0x1b26b3:0x19e,_0x47f5da:0x1cc,_0x4952af:0x1b2,_0x26d82b:0x1b2,_0x331573:0x1b2,_0x53c411:0x1c2,_0x3eaad3:0x1c3};return __async(this,null,function*(){const _0x3eb519=_0x2c1a;let _0xca7c9b='Unknown\x20Title',_0xe71fc9=_0x276019==='tv'?_0x3eb519(_0x44cc41._0x48e935):_0x3eb519(_0x44cc41._0x1b26b3);try{const _0x4980e7=_0x276019==='movie'?'movie':'tv',_0xd7237c=_0x3eb519(_0x44cc41._0x47f5da)+_0x4980e7+'/'+_0xde73a7+_0x3eb519(0x1b1)+TMDB_API_KEY,_0x378228=yield fetch(_0xd7237c);if(!_0x378228['ok'])return{'name':_0xca7c9b,'year':'N/A','duration':_0xe71fc9};const _0x13183d=yield _0x378228[_0x3eb519(0x1ba)]();let _0x149b80=_0xe71fc9;if(_0x276019==='movie'&&_0x13183d[_0x3eb519(_0x44cc41._0x4952af)])_0x149b80=_0x13183d[_0x3eb519(0x1b2)]+'\x20min';else{if(_0x276019==='tv'){const _0x1c0bde='https://api.themoviedb.org/3/tv/'+_0xde73a7+'/season/'+_0x109a4a+_0x3eb519(0x1a5)+_0x1c3436+'?api_key='+TMDB_API_KEY,_0x28ee9b=yield fetch(_0x1c0bde);if(_0x28ee9b['ok']){const _0x39fc87=yield _0x28ee9b[_0x3eb519(0x1ba)]();if(_0x39fc87[_0x3eb519(_0x44cc41._0x26d82b)])_0x149b80=_0x39fc87[_0x3eb519(_0x44cc41._0x331573)]+_0x3eb519(_0x44cc41._0x53c411);else _0x13183d[_0x3eb519(_0x44cc41._0x3eaad3)]&&_0x13183d['episode_run_time'][_0x3eb519(0x196)]>0x0&&(_0x149b80=_0x13183d['episode_run_time'][0x0]+_0x3eb519(0x1c2));}}}return{'name':_0x13183d[_0x3eb519(0x1cf)]||_0x13183d['name']||_0xca7c9b,'year':(_0x13183d['release_date']||_0x13183d[_0x3eb519(0x190)]||'')[_0x3eb519(0x18c)]('-')[0x0]||'N/A','duration':_0x149b80};}catch(_0x31b79c){return{'name':_0xca7c9b,'year':_0x3eb519(0x1b7),'duration':_0xe71fc9};}});}function _0x2c1a(_0x43fa70,_0x31d75b){_0x43fa70=_0x43fa70-0x187;const _0x2c23c6=_0x2c23();let _0x2c1a4d=_0x2c23c6[_0x43fa70];if(_0x2c1a['yDfSex']===undefined){var _0x2badc9=function(_0x28e74b){const _0x39c6dc='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x541021='',_0x4133af='';for(let _0x4e4688=0x0,_0x3914b8,_0x15cb6b,_0x59c7e8=0x0;_0x15cb6b=_0x28e74b['charAt'](_0x59c7e8++);~_0x15cb6b&&(_0x3914b8=_0x4e4688%0x4?_0x3914b8*0x40+_0x15cb6b:_0x15cb6b,_0x4e4688++%0x4)?_0x541021+=String['fromCharCode'](0xff&_0x3914b8>>(-0x2*_0x4e4688&0x6)):0x0){_0x15cb6b=_0x39c6dc['indexOf'](_0x15cb6b);}for(let _0x18896d=0x0,_0x414964=_0x541021['length'];_0x18896d<_0x414964;_0x18896d++){_0x4133af+='%'+('00'+_0x541021['charCodeAt'](_0x18896d)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x4133af);};_0x2c1a['YsWNbC']=_0x2badc9,_0x2c1a['VZGbjx']={},_0x2c1a['yDfSex']=!![];}const _0x53c2ad=_0x2c23c6[0x0],_0x1a90f0=_0x43fa70+_0x53c2ad,_0x427a74=_0x2c1a['VZGbjx'][_0x1a90f0];return!_0x427a74?(_0x2c1a4d=_0x2c1a['YsWNbC'](_0x2c1a4d),_0x2c1a['VZGbjx'][_0x1a90f0]=_0x2c1a4d):_0x2c1a4d=_0x427a74,_0x2c1a4d;}function generateM3u8(_0x916c06){const _0x3666dc={_0x434cfc:0x1b8,_0x272a89:0x193,_0x1a65f4:0x1ca,_0x3e5bb5:0x18c,_0x1e85c5:0x1c0,_0x19426b:0x1ac,_0x50027e:0x1aa};return __async2(this,arguments,function*(_0x4742cc,_0xd3349={}){const _0x386999=_0x2c1a;try{console[_0x386999(_0x3666dc._0x434cfc)](_0x386999(_0x3666dc._0x272a89)+_0x4742cc);const _0x102033=yield fetch(_0x4742cc,{'headers':_0xd3349}),_0x56f9f3=yield _0x102033[_0x386999(0x1d1)](),_0x2948b6=_0x4742cc[_0x386999(_0x3666dc._0x1a65f4)](0x0,_0x4742cc['lastIndexOf']('/'))+'/',_0x2a8079=[],_0x3299ee=/#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+).*?\n([^\n]+)/g;let _0x56e1ff;while((_0x56e1ff=_0x3299ee['exec'](_0x56f9f3))!==null){const _0x5595d7=parseInt(_0x56e1ff[0x1][_0x386999(_0x3666dc._0x3e5bb5)]('x')[0x1]);if(_0x5595d7<0x2d0)continue;const _0x2c6144=_0x5595d7+'p';let _0x3eff8d=_0x56e1ff[0x2]['trim']();if(!_0x3eff8d[_0x386999(_0x3666dc._0x1e85c5)]('http')){if(_0x3eff8d['startsWith']('/')){const _0x459239=new URL(_0x4742cc)[_0x386999(_0x3666dc._0x19426b)];_0x3eff8d=_0x459239+_0x3eff8d;}else _0x3eff8d=_0x2948b6+_0x3eff8d;}_0x2a8079[_0x386999(_0x3666dc._0x50027e)]({'quality':_0x2c6144,'url':_0x3eff8d});}return _0x2a8079;}catch(_0x6a895e){return console['warn'](_0x386999(0x19a),_0x6a895e),[];}});}function getStreams(_0x30be17,_0x3ab998,_0x456cb3,_0x25010e){const _0x27610a={_0x141b5f:0x1b8,_0x2f0ec7:0x1b8,_0x49655d:0x1bc,_0x5d5f56:0x19d};return __async2(this,null,function*(){const _0x3ca55a={_0x10e81a:0x1a4,_0x98441d:0x199,_0x26a653:0x188,_0x537e1e:0x19b,_0x2a32dc:0x18a,_0x576d87:0x1be,_0x3f565d:0x1b9,_0x136109:0x1ae,_0x4511a7:0x1aa},_0x497e5e=_0x2c1a;console[_0x497e5e(_0x27610a._0x141b5f)]('[Vidlink]\x20Fetching\x20streams\x20for\x20'+_0x3ab998+'\x20'+_0x30be17);try{const _0x498435=DECRYPT_API+_0x497e5e(0x1bb)+_0x30be17,_0x41d92f=yield fetch(_0x498435),_0x398de0=yield _0x41d92f['json'](),_0x3e0592=_0x398de0['result'];if(!_0x3e0592)return console[_0x497e5e(_0x27610a._0x2f0ec7)](_0x497e5e(0x194)),[];const _0x131462=_0x3ab998!=='tv'&&_0x456cb3==null,_0x249719=_0x131462?'movie':'tv',_0x3b42a1=yield getTmdbMetadata(_0x30be17,_0x249719,_0x456cb3,_0x25010e),_0x373493=_0x131462?VIDLINK_API+_0x497e5e(_0x27610a._0x49655d)+_0x3e0592:VIDLINK_API+'/api/b/tv/'+_0x3e0592+'/'+_0x456cb3+'/'+_0x25010e;console['log'](_0x497e5e(0x1c6)+_0x373493);const _0x38f503=yield fetch(_0x373493,{'headers':HEADERS}),_0x172337=yield _0x38f503['json'](),_0x38acbb=_0x172337&&_0x172337['stream']&&_0x172337['stream'][_0x497e5e(0x1c1)];if(!_0x38acbb)return console['log']('[Vidlink]\x20No\x20playlist\x20in\x20response'),[];const _0x5de6a0=[],_0x564c88=(_0x49bb74,_0x25f1fd)=>{const _0x3b1aed=_0x497e5e;let _0x27cf62=_0x3b1aed(0x1cb),_0x5bbc47='1080P';const _0x10d9ea=String(_0x49bb74)[_0x3b1aed(0x19c)]();if(_0x10d9ea['includes'](_0x3b1aed(_0x3ca55a._0x10e81a))||_0x10d9ea[_0x3b1aed(0x19b)]('4k'))_0x27cf62=_0x3b1aed(_0x3ca55a._0x98441d),_0x5bbc47=_0x3b1aed(_0x3ca55a._0x26a653);else{if(_0x10d9ea[_0x3b1aed(_0x3ca55a._0x537e1e)](_0x3b1aed(0x1d0)))_0x27cf62='1080p\x20FHD',_0x5bbc47='1080P';else{if(_0x10d9ea['includes']('720'))_0x27cf62=_0x3b1aed(0x18e),_0x5bbc47=_0x3b1aed(_0x3ca55a._0x2a32dc);else _0x10d9ea['includes'](_0x3b1aed(_0x3ca55a._0x576d87))&&(_0x27cf62=_0x3b1aed(0x1cd),_0x5bbc47=_0x3b1aed(0x1a8));}}const _0x4809b0=calculateCalculatedFallbackSize(_0x5bbc47,_0x3b42a1[_0x3b1aed(0x18b)]),_0x3d982b=_0x3b42a1['name']+(!_0x131462?'\x20S'+_0x456cb3+'E'+_0x25010e:''),_0x2406d9='VidLink\x20|\x20'+_0x27cf62+_0x3b1aed(_0x3ca55a._0x3f565d),_0x3adf33='🎬\x20'+_0x3d982b+_0x3b1aed(_0x3ca55a._0x136109)+_0x3b42a1['year']+_0x3b1aed(0x198)+_0x5bbc47+_0x3b1aed(0x1c7)+_0x4809b0+'\x0a🎞️\x20M3U8\x20|\x20⏱️\x20'+_0x3b42a1['duration']+'\x20|\x20📌\x20Main\x20Mirror';_0x5de6a0[_0x3b1aed(_0x3ca55a._0x4511a7)]({'name':_0x2406d9,'title':_0x3adf33,'url':_0x25f1fd,'quality':_0x49bb74,'type':'m3u8','headers':{'User-Agent':HEADERS[_0x3b1aed(0x1a7)],'Referer':VIDLINK_API+'/','Origin':VIDLINK_API},'provider':'vidlink'});};_0x564c88(_0x497e5e(0x1a8),_0x38acbb);try{const _0x514053=yield generateM3u8(_0x38acbb,{'Referer':VIDLINK_API+'/','User-Agent':HEADERS['User-Agent']});_0x514053['forEach'](_0x2d92db=>{const _0x2863a4=_0x497e5e;_0x564c88(_0x2d92db['quality'],_0x2d92db[_0x2863a4(0x1b3)]);});}catch(_0x3658a5){console['warn'](_0x497e5e(_0x27610a._0x5d5f56)+_0x38acbb);}return console[_0x497e5e(0x1b8)]('[Vidlink]\x20Found\x20playlist\x20stream'),_0x5de6a0['map'](_0x4f56f9=>__spreadProps(__spreadValues({},_0x4f56f9),{'quality':getSortedQuality(_0x4f56f9['quality'])}));}catch(_0x5856c2){return console[_0x497e5e(0x1c9)](_0x497e5e(0x195)+_0x5856c2['message']),[];}});}function getSortedQuality(_0x464a66){const _0x22a2a7={_0x5093e4:0x19c,_0x52fae2:0x19b,_0x218bbf:0x19b,_0x5ba2d9:0x1ad},_0x2e6313=_0x4d78f2;if(!_0x464a66)return'Auto';const _0x3084f6=_0x464a66[_0x2e6313(_0x22a2a7._0x5093e4)]();if(_0x3084f6[_0x2e6313(_0x22a2a7._0x52fae2)]('auto'))return _0x2e6313(0x1a8);if(_0x3084f6[_0x2e6313(0x19b)](_0x2e6313(0x1a4))||_0x3084f6['includes']('4k')||_0x3084f6[_0x2e6313(0x19b)]('uhd'))return'​'+_0x464a66;if(_0x3084f6[_0x2e6313(_0x22a2a7._0x218bbf)](_0x2e6313(0x1d0))||_0x3084f6[_0x2e6313(0x19b)](_0x2e6313(_0x22a2a7._0x5ba2d9)))return'​​'+_0x464a66;if(_0x3084f6[_0x2e6313(0x19b)]('720')||_0x3084f6['includes']('hd'))return'​​​'+_0x464a66;if(_0x3084f6['includes']('480')||_0x3084f6['includes']('sd'))return'​​​​'+_0x464a66;if(_0x3084f6['includes'](_0x2e6313(0x197)))return'​​​​​'+_0x464a66;return'​​​​'+_0x464a66;}module['exports']={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidlink", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "VidLink", "vidlink");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
