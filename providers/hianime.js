// Imported provider: hianime; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
function _0x518a(_0x1b78e1,_0x35433d){_0x1b78e1=_0x1b78e1-0x17e;const _0x492afb=_0x492a();let _0x518a7b=_0x492afb[_0x1b78e1];if(_0x518a['wpMDaS']===undefined){var _0x5848e6=function(_0x1e8501){const _0x130513='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x2dae07='',_0x274018='';for(let _0x29e17c=0x0,_0x492fa4,_0x22e2bd,_0x254b06=0x0;_0x22e2bd=_0x1e8501['charAt'](_0x254b06++);~_0x22e2bd&&(_0x492fa4=_0x29e17c%0x4?_0x492fa4*0x40+_0x22e2bd:_0x22e2bd,_0x29e17c++%0x4)?_0x2dae07+=String['fromCharCode'](0xff&_0x492fa4>>(-0x2*_0x29e17c&0x6)):0x0){_0x22e2bd=_0x130513['indexOf'](_0x22e2bd);}for(let _0x15cfe8=0x0,_0xc48f6b=_0x2dae07['length'];_0x15cfe8<_0xc48f6b;_0x15cfe8++){_0x274018+='%'+('00'+_0x2dae07['charCodeAt'](_0x15cfe8)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x274018);};_0x518a['MrpHvb']=_0x5848e6,_0x518a['oDYqFZ']={},_0x518a['wpMDaS']=!![];}const _0x4a33f4=_0x492afb[0x0],_0x589b11=_0x1b78e1+_0x4a33f4,_0x181898=_0x518a['oDYqFZ'][_0x589b11];return!_0x181898?(_0x518a7b=_0x518a['MrpHvb'](_0x518a7b),_0x518a['oDYqFZ'][_0x589b11]=_0x518a7b):_0x518a7b=_0x181898,_0x518a7b;}function _0x492a(){const _0x14810d=['qxvKAw8Vu3vIDgL0BguGuhjLzMvYzw5Jzq','C3vIrhvI','Ahr0Chm6lY9TzwDHCgXHEs5IDxP6','l2v4DgvYBMfSx2LKCZ9HCgLFA2v5pq','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','mty0nJq4mJjZz1bZrhq','u3vIicyGrhvI','we1mshr0CfjLCxvLC3q','zgvMAw5LuhjVCgvYDhK','xsaO','C3vIDgL0BgvZ','zMLSDgvY','Aw1KyL9Pza','jMXPBwL0pte','zhvYyxrPB24','AgvHzgvYCW','mtK2mZG5Du5VsMTS','z2v0t3DUuhjVCgvYDhLezxnJCMLWDg9YCW','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','t3jPz2LUywWGkfnvqIK','zxjYB3i','ywXS','mZeWCwDhzffQ','zgf0ys1YzwfSAwq','C2vSzwn0','yxr0CG','jMLKpq','mZm5EMj2C0vY','ChjVDg90ExbL','zgvMAw5LuhjVCgvYDgLLCW','l3n0CMvHBs9NzxrtB3vYy2vZp2LKpq','ndq0nZu5mK1VuMrHqG','tw92Awu','ihWG4O+X77Ipia','mJrT','mJy0nZq1ruzHswPN','DMfSDwu','y2fWDgLVBNm','BMfTzq','B2jQzwn0','mti4nJHbB3PguMi','u3rYzwfTifbYzwzLCMvUy2vZ','Bw92Awu','twvNyunSB3vK','zxbuAxrSzq','zgf0yq','ic0G','jNr5Cgu9','odaZmdiYyuH0uvL2','DxjS','y3jLyxrL','CNvUDgLTzq','rw5NBgLZAcaOrfvckq','mtrsuNzfDvO','jMu9','AgfZt3DUuhjVCgvYDhK','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY9TB3zPzs8','DhjHy2TZ','ChvZAa','BwfW','8j+oRca','BgfIzwW','8j+oPsbt','rw5NBgLZAa','u0nsqvbfuL9trvrusu5huW','AgfZ','x19LC01VzhvSzq','C3rHDhvZ','u3vIie9UBhK','mJbdEvbVqxC','AM9PBG','jNm9','ChjVCgvYDhLjC0vUDw1LCMfIBgu','Ahr0Chm6lY9TzwDHy2XVDwqUyMXVz2D5lMnSAwnR','Btn1oa','l2vWAxnVzguV','ig9Uia','B3jPz2LUywXFBgfUz3vHz2u','yM90Aa','BMv4Da','zhvI','l3n0CMvHBs9ZltmV','z2vUCMvZ','B3jPz2LUx2nVDw50CNK','C2XPy2u','qxv0BW','mZuWmdq1neTnzeHPCa','Ahr0Chm6lY92Awr3AxnOlMXPDMu','DgHYB3C','B3jPz2LUywXFDgL0Bgu','l3n0CMvHBs9TywWV','z2v0t3DUuhjVCgvYDhLezxnJCMLWDg9Y','BgvUz3rO','C3vI','C291CMnLCW','y2fSBa','A2LUza','zgL2lMzPEc1HCMvHi21Lz2fWBgf5lxbSyxLLCG','z2v0uhjVDg90ExbLt2y','rhvIie9UBhK','CMvZB2X2zq','zgvMyxvSDa','Dg9mB3DLCKnHC2u','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmc4WlJaUmcbtywzHCMKVntm3lJm2','sfruuca','zg9Uzq','sgLbBMLTzsb8ief1Dg8GFcbB','BwfSx2LK','zMLSzq','Bg9Hza','z2v0t3DUuhjVCgvYDhLoyw1LCW','zgf0ys1Pza','C29Tzq','p2fWAv9RzxK9','8j+oNU+4JYbnm1u4ihWG4PQHief1Dg8GFcdWN4Ynia','Ahr0Chm6lY9Pzc1TyxbWAw5NlwfWAs1TywXPzc5OzI5ZCgfJzs9HCgKVCMvZB2X2zt9Pzd0','Ahr0Chm6lY9HCgKUAMLRyw4UBw9Ll3y0l2fUAw1Lp3e9','BwfSx2vWAxnVzgu','ywrK','yxbWBhK','DgHLBG','DgL0Bgu','rxbPC29Kzsa','Dg9vChbLCKnHC2u','CgfYC2u'];_0x492a=function(){return _0x14810d;};return _0x492a();}const _0x534f2d=_0x518a;(function(_0x40db90,_0x2dac50){const _0x3aba9e=_0x518a,_0x28abda=_0x40db90();while(!![]){try{const _0x5503ca=parseInt(_0x3aba9e(0x1f5))/0x1+parseInt(_0x3aba9e(0x1ed))/0x2*(-parseInt(_0x3aba9e(0x1e0))/0x3)+-parseInt(_0x3aba9e(0x18d))/0x4*(parseInt(_0x3aba9e(0x1e8))/0x5)+parseInt(_0x3aba9e(0x19e))/0x6*(parseInt(_0x3aba9e(0x1fa))/0x7)+parseInt(_0x3aba9e(0x1e4))/0x8+parseInt(_0x3aba9e(0x1d5))/0x9*(parseInt(_0x3aba9e(0x1db))/0xa)+-parseInt(_0x3aba9e(0x1ca))/0xb;if(_0x5503ca===_0x2dac50)break;else _0x28abda['push'](_0x28abda['shift']());}catch(_0x2aaa4d){_0x28abda['push'](_0x28abda['shift']());}}}(_0x492a,0xae3b3));var __create=Object[_0x534f2d(0x1f7)],__defProp=Object[_0x534f2d(0x1cd)],__defProps=Object[_0x534f2d(0x1e2)],__getOwnPropDesc=Object[_0x534f2d(0x1a3)],__getOwnPropDescs=Object[_0x534f2d(0x1d6)],__getOwnPropNames=Object[_0x534f2d(0x1b6)],__getOwnPropSymbols=Object['getOwnPropertySymbols'],__getProtoOf=Object[_0x534f2d(0x1aa)],__hasOwnProp=Object[_0x534f2d(0x1e1)][_0x534f2d(0x17f)],__propIsEnum=Object['prototype'][_0x534f2d(0x190)],__defNormalProp=(_0x2dae07,_0x274018,_0x29e17c)=>_0x274018 in _0x2dae07?__defProp(_0x2dae07,_0x274018,{'enumerable':!![],'configurable':!![],'writable':!![],'value':_0x29e17c}):_0x2dae07[_0x274018]=_0x29e17c,__spreadValues=(_0x492fa4,_0x22e2bd)=>{const _0x2b407e=_0x534f2d;for(var _0x254b06 in _0x22e2bd||(_0x22e2bd={}))if(__hasOwnProp[_0x2b407e(0x1a7)](_0x22e2bd,_0x254b06))__defNormalProp(_0x492fa4,_0x254b06,_0x22e2bd[_0x254b06]);if(__getOwnPropSymbols)for(var _0x254b06 of __getOwnPropSymbols(_0x22e2bd)){if(__propIsEnum[_0x2b407e(0x1a7)](_0x22e2bd,_0x254b06))__defNormalProp(_0x492fa4,_0x254b06,_0x22e2bd[_0x254b06]);}return _0x492fa4;},__spreadProps=(_0x15cfe8,_0xc48f6b)=>__defProps(_0x15cfe8,__getOwnPropDescs(_0xc48f6b)),__copyProps=(_0x18421e,_0x204a78,_0x11897e,_0x461fc8)=>{const _0x4cf2e8=_0x534f2d;if(_0x204a78&&typeof _0x204a78===_0x4cf2e8(0x1ec)||typeof _0x204a78==='function'){for(let _0x17b24f of __getOwnPropNames(_0x204a78))if(!__hasOwnProp[_0x4cf2e8(0x1a7)](_0x18421e,_0x17b24f)&&_0x17b24f!==_0x11897e)__defProp(_0x18421e,_0x17b24f,{'get':()=>_0x204a78[_0x17b24f],'enumerable':!(_0x461fc8=__getOwnPropDesc(_0x204a78,_0x17b24f))||_0x461fc8['enumerable']});}return _0x18421e;},__toESM=(_0x4dde22,_0x120ea3,_0x25db69)=>(_0x25db69=_0x4dde22!=null?__create(__getProtoOf(_0x4dde22)):{},__copyProps(_0x120ea3||!_0x4dde22||!_0x4dde22[_0x534f2d(0x18a)]?__defProp(_0x25db69,_0x534f2d(0x1ad),{'value':_0x4dde22,'enumerable':!![]}):_0x25db69,_0x4dde22)),__async=(_0x29d962,_0x5d921d,_0x15a883)=>{return new Promise((_0x4ab987,_0xe95780)=>{const _0x3bb134=_0x518a;var _0x26f92c=_0x3d0820=>{const _0x5144a4=_0x518a;try{_0x5eb037(_0x15a883[_0x5144a4(0x197)](_0x3d0820));}catch(_0x14ebc6){_0xe95780(_0x14ebc6);}},_0x1ea74d=_0x2ff374=>{const _0x6b926e=_0x518a;try{_0x5eb037(_0x15a883[_0x6b926e(0x1a0)](_0x2ff374));}catch(_0x1cd14e){_0xe95780(_0x1cd14e);}},_0x5eb037=_0x6f11ba=>_0x6f11ba[_0x3bb134(0x1b1)]?_0x4ab987(_0x6f11ba[_0x3bb134(0x1e9)]):Promise[_0x3bb134(0x1ac)](_0x6f11ba['value'])[_0x3bb134(0x1c0)](_0x26f92c,_0x1ea74d);_0x5eb037((_0x15a883=_0x15a883[_0x3bb134(0x1bf)](_0x29d962,_0x5d921d))[_0x3bb134(0x197)]());});},import_cheerio_without_node_native=__toESM(require('cheerio-without-node-native')),MEGAPLAY_BASE=_0x534f2d(0x1c7),VIDWISH_BASE=_0x534f2d(0x19f),MEGACLOUD_BASE=_0x534f2d(0x191),TMDB_API_KEY='1865f43a0549ca50d341dd9ab8b29f49',DEFAULT_HEADERS={'User-Agent':_0x534f2d(0x1af),'Accept':'*/*','Connection':'keep-alive'};function fetchText(_0x5267e4){return __async(this,arguments,function*(_0x45ccd9,_0x4bb980={}){const _0x20f29a=_0x518a,_0x5212ba=yield fetch(_0x45ccd9,__spreadValues({'headers':__spreadValues(__spreadValues({},DEFAULT_HEADERS),_0x4bb980[_0x20f29a(0x1d4)])},_0x4bb980));if(!_0x5212ba['ok'])throw new Error(_0x20f29a(0x1b0)+_0x5212ba[_0x20f29a(0x18b)]+_0x20f29a(0x194)+_0x45ccd9);return yield _0x5212ba['text']();});}function fetchJson(_0x46b20f){return __async(this,arguments,function*(_0x207286,_0x46f2a0={}){const _0x403cfa=_0x518a,_0x111e1a=yield fetchText(_0x207286,_0x46f2a0);return JSON[_0x403cfa(0x1c4)](_0x111e1a);});}function getImdbId(_0x2c75d7,_0x86b892){return __async(this,null,function*(){const _0xf83dbe=_0x518a;try{const _0x4003c9=_0xf83dbe(0x1d7)+(_0x86b892==='tv'?'tv':_0xf83dbe(0x1ef))+'/'+_0x2c75d7+_0xf83dbe(0x1c8)+TMDB_API_KEY,_0x4ab9aa=yield fetchJson(_0x4003c9);return _0x4ab9aa[_0xf83dbe(0x1d1)]||null;}catch(_0x17141d){return null;}});}function getTmdbDetails(_0x252301,_0x15e30d){return __async(this,null,function*(){try{const _0x523a4f='https://api.themoviedb.org/3/'+(_0x15e30d==='tv'?'tv':'movie')+'/'+_0x252301+'?api_key='+TMDB_API_KEY;return yield fetchJson(_0x523a4f);}catch(_0x4ce065){return null;}});}function getEpisodeMetadata(_0x173fd5,_0x2f3985,_0x2f37ca,_0x2f8a19){return __async(this,null,function*(){const _0x5e2319=_0x518a;try{if(_0x2f3985===_0x5e2319(0x1ef)){const _0x1c1e8f=_0x5e2319(0x180)+_0x173fd5+_0x5e2319(0x1b9)+TMDB_API_KEY,_0x39dc1c=yield fetchJson(_0x1c1e8f);return{'title':_0x39dc1c[_0x5e2319(0x1c1)]||_0x5e2319(0x1e5),'duration':_0x39dc1c[_0x5e2319(0x1f8)]?_0x39dc1c[_0x5e2319(0x1f8)]+'m':'N/A'};}else{const _0x52a169=_0x5e2319(0x1c9)+_0x173fd5+'/season/'+_0x2f37ca+_0x5e2319(0x193)+_0x2f8a19+_0x5e2319(0x1b9)+TMDB_API_KEY,_0x570c4d=yield fetchJson(_0x52a169);return{'title':_0x570c4d[_0x5e2319(0x1eb)]||_0x5e2319(0x1c2)+_0x2f8a19,'duration':_0x570c4d['runtime']?_0x570c4d[_0x5e2319(0x1f8)]+'m':_0x5e2319(0x1e7)};}}catch(_0x38aecd){return{'title':'Episode\x20'+_0x2f8a19,'duration':_0x5e2319(0x1e7)};}});}function resolveMapping(_0x4995db,_0x2365e5,_0x5a84a1){return __async(this,null,function*(){const _0x26302b=_0x518a;try{const _0xb65be9=_0x26302b(0x1bb)+_0x4995db+_0x26302b(0x18f)+_0x2365e5+_0x26302b(0x17e)+_0x5a84a1,_0x3bc4ed=yield fetchJson(_0xb65be9);if(_0x3bc4ed[_0x26302b(0x1d9)])return null;return _0x3bc4ed;}catch(_0x6b6afc){return null;}});}function searchMalId(_0x1e73db,_0xd87fc6){return __async(this,null,function*(){const _0x497763=_0x518a;try{const _0x2f1e3e=_0xd87fc6===_0x497763(0x1ef)?'movie':'tv',_0x4c44db=_0x497763(0x1bc)+encodeURIComponent(_0x1e73db)+_0x497763(0x1f4)+_0x2f1e3e+_0x497763(0x1d2),_0xdb646a=yield fetchJson(_0x4c44db);if(_0xdb646a['data']&&_0xdb646a[_0x497763(0x1f2)][_0x497763(0x1a4)]>0x0)return _0xdb646a['data'][0x0][_0x497763(0x1b3)];return null;}catch(_0x375f0e){return null;}});}function extractSources(_0x37492a,_0x5db6a6,_0x9fddec,_0x54d0c1,_0x54723c,_0xb13dbf,_0x13fa30,_0x3990cb,_0x1dd32c,_0x3c867b){return __async(this,null,function*(){const _0x264f8d=_0x518a;var _0x59ab2b;try{const _0x2d9d1c=yield fetchJson(_0x37492a,{'headers':{'X-Requested-With':_0x264f8d(0x1cc),'Referer':_0x5db6a6,'Origin':_0x9fddec}}),_0x91625f=(_0x59ab2b=_0x2d9d1c[_0x264f8d(0x1a6)])==null?void 0x0:_0x59ab2b[_0x264f8d(0x1b4)];if(!_0x91625f)return[];const _0x3f5a78=_0x1dd32c['toLowerCase']()===_0x264f8d(0x1a5)?_0x264f8d(0x1d8):_0x264f8d(0x1f9),_0x9e6cb=_0x1dd32c[_0x264f8d(0x1c3)]();let _0x185941=[];_0xb13dbf===_0x264f8d(0x1ef)?_0x185941=[_0x264f8d(0x184)+_0x54723c,_0x264f8d(0x1ba)+_0x3f5a78+'\x20|\x20⏱️\x20'+_0x3c867b['duration']]:_0x185941=[_0x264f8d(0x184)+_0x54723c,_0x264f8d(0x186)+_0x13fa30+'E'+_0x3990cb+_0x264f8d(0x1f3)+_0x3c867b[_0x264f8d(0x1f1)],'🎞️\x20M3U8\x20|\x20⚡\x20Auto\x20|\x20🌍\x20'+_0x3f5a78+_0x264f8d(0x1e6)+_0x3c867b[_0x264f8d(0x1d3)]];const _0x5e9a48=_0x185941[_0x264f8d(0x18e)]('\x0a'),_0x5bddf2=[];_0x5bddf2[_0x264f8d(0x182)]({'name':_0x264f8d(0x1b2)+_0x54d0c1+_0x264f8d(0x1ce)+_0x9e6cb+')','title':_0x5e9a48,'url':_0x91625f,'quality':_0x264f8d(0x19d),'headers':__spreadProps(__spreadValues({},DEFAULT_HEADERS),{'Referer':_0x9fddec+'/','Origin':_0x9fddec}),'provider':'hianime','type':_0x264f8d(0x192)});if(_0x2d9d1c[_0x264f8d(0x181)]&&_0x2d9d1c['tracks'][_0x264f8d(0x1a4)]>0x0){const _0x5ba4b5=_0x2d9d1c[_0x264f8d(0x181)]['filter'](_0x2698de=>_0x2698de[_0x264f8d(0x1b4)]&&_0x2698de[_0x264f8d(0x1a8)]===_0x264f8d(0x1ea))[_0x264f8d(0x183)](_0x466d9f=>({'url':_0x466d9f[_0x264f8d(0x1b4)],'name':_0x466d9f[_0x264f8d(0x185)]||_0x264f8d(0x187),'language':_0x466d9f[_0x264f8d(0x185)]?_0x466d9f[_0x264f8d(0x185)][_0x264f8d(0x19c)](0x0,0x3)[_0x264f8d(0x1ae)]():'en'}));_0x5bddf2[0x0][_0x264f8d(0x1cf)]=_0x5ba4b5;}return _0x5bddf2;}catch(_0xc9e618){return[];}});}function scrapeType(_0x5f36cd,_0x105396,_0x6ab94d,_0x2f8165,_0x5483aa,_0x50e7d1,_0x8de394){return __async(this,null,function*(){const _0x42164d=_0x518a,_0x5e1cac=[],_0x2caa0b=MEGAPLAY_BASE+_0x42164d(0x1a2)+_0x5f36cd+'/'+_0x105396+'/'+_0x6ab94d;try{const _0x29afac=yield fetchText(_0x2caa0b,{'headers':{'Referer':_0x2caa0b}}),_0x49a6e5=import_cheerio_without_node_native[_0x42164d(0x1ad)]['load'](_0x29afac),_0x14afb3=_0x49a6e5(_0x42164d(0x1a9));if(!_0x14afb3['length'])return[];const _0x24b5d1=_0x14afb3['attr'](_0x42164d(0x1b7)),_0x2eaf70=_0x14afb3[_0x42164d(0x1de)](_0x42164d(0x1dc)),_0x358486=[];if(_0x24b5d1){const _0x561168=MEGAPLAY_BASE+_0x42164d(0x1e3)+_0x24b5d1+_0x42164d(0x1df)+_0x24b5d1;_0x358486[_0x42164d(0x182)](extractSources(_0x561168,_0x2caa0b,MEGAPLAY_BASE,'MegaPlay',_0x2f8165,_0x50e7d1,_0x8de394,_0x105396,_0x6ab94d,_0x5483aa));}if(_0x2eaf70){const _0x2e7767=VIDWISH_BASE+'/stream/s-2/'+_0x2eaf70+'/'+_0x6ab94d;_0x358486[_0x42164d(0x182)](((()=>__async(this,null,function*(){const _0x5ae9fd=_0x42164d;try{const _0x2f7c7f=yield fetchText(_0x2e7767,{'headers':{'Referer':_0x2caa0b}}),_0x2e40ae=import_cheerio_without_node_native[_0x5ae9fd(0x1ad)][_0x5ae9fd(0x1b5)](_0x2f7c7f),_0x315d7b=_0x2e40ae('div.fix-area#megaplay-player'),_0x3b622d=_0x315d7b[_0x5ae9fd(0x1de)](_0x5ae9fd(0x1b7));if(_0x3b622d){const _0x3731c5=VIDWISH_BASE+_0x5ae9fd(0x1e3)+_0x3b622d+'&id='+_0x3b622d;return yield extractSources(_0x3731c5,_0x2e7767,VIDWISH_BASE,'Vidwish',_0x2f8165,_0x50e7d1,_0x8de394,_0x105396,_0x6ab94d,_0x5483aa);}}catch(_0x308f42){}return[];}))()));}if(_0x2eaf70){const _0x21c11a=MEGACLOUD_BASE+_0x42164d(0x199)+_0x2eaf70+'/'+_0x6ab94d;_0x358486['push'](((()=>__async(this,null,function*(){const _0x2bc360=_0x42164d;try{const _0x5bea62=yield fetchText(_0x21c11a,{'headers':{'Referer':_0x2caa0b}}),_0x60928c=import_cheerio_without_node_native['default'][_0x2bc360(0x1b5)](_0x5bea62),_0x38cb83=_0x60928c(_0x2bc360(0x1a9)),_0x7cab52=_0x38cb83[_0x2bc360(0x1de)]('data-id');if(_0x7cab52){const _0x29efbd=MEGACLOUD_BASE+_0x2bc360(0x1e3)+_0x7cab52+_0x2bc360(0x1df)+_0x7cab52;return yield extractSources(_0x29efbd,_0x21c11a,MEGACLOUD_BASE,_0x2bc360(0x1f0),_0x2f8165,_0x50e7d1,_0x8de394,_0x105396,_0x6ab94d,_0x5483aa);}}catch(_0x18a89f){}return[];}))()));}const _0x2d09f6=yield Promise[_0x42164d(0x1da)](_0x358486);for(const _0x58af50 of _0x2d09f6){_0x5e1cac[_0x42164d(0x182)](..._0x58af50);}}catch(_0x5cac93){}return _0x5e1cac;});}function onSettings(){return __async(this,null,function*(){const _0x2b1ea6=_0x518a;return[{'type':'header','label':_0x2b1ea6(0x1ee)},{'type':_0x2b1ea6(0x1dd),'key':_0x2b1ea6(0x1c6),'label':_0x2b1ea6(0x1c5),'options':[{'label':_0x2b1ea6(0x1cb),'value':_0x2b1ea6(0x196)},{'label':_0x2b1ea6(0x18c),'value':_0x2b1ea6(0x1a5)},{'label':_0x2b1ea6(0x1ab),'value':_0x2b1ea6(0x198)}],'defaultValue':_0x2b1ea6(0x196)}];});}function getStreams(_0x5bd111,_0x1a8559='tv',_0x4cfc56=0x1,_0x2d2abe=0x1){return __async(this,null,function*(){const _0x53b74c=_0x518a;try{const _0x3f85df=yield getTmdbDetails(_0x5bd111,_0x1a8559);if(!_0x3f85df)return[];const _0x11f81d=_0x3f85df[_0x53b74c(0x19a)]||[],_0x83f11e=_0x11f81d[_0x53b74c(0x1b8)](_0x214e2b=>_0x214e2b['id']===0x10),_0x48cdf2=_0x3f85df[_0x53b74c(0x195)]||'',_0x22eff8=_0x3f85df[_0x53b74c(0x19b)]||[],_0x427082=_0x48cdf2==='ja'||_0x22eff8['includes']('JP');if(!_0x83f11e||!_0x427082)return[];let _0x58d750=null,_0x555d4f=_0x2d2abe,_0x31ea66=_0x3f85df[_0x53b74c(0x1eb)]||_0x3f85df[_0x53b74c(0x1c1)]||_0x3f85df[_0x53b74c(0x1a1)]||(_0x1a8559===_0x53b74c(0x1ef)?_0x53b74c(0x1e5):'Anime');const _0x560e7=yield getImdbId(_0x5bd111,_0x1a8559);if(!_0x560e7)return[];const _0xeb5b6e=yield getEpisodeMetadata(_0x5bd111,_0x1a8559,_0x4cfc56,_0x2d2abe),_0x15eb37={'epTitle':_0xeb5b6e['title'],'duration':_0xeb5b6e[_0x53b74c(0x1d3)]},_0x2bfc5c=_0x1a8559===_0x53b74c(0x1ef)?0x1:_0x4cfc56,_0x40abb6=_0x1a8559===_0x53b74c(0x1ef)?0x1:_0x2d2abe;_0x1a8559===_0x53b74c(0x1ef)&&(_0x58d750=yield searchMalId(_0x31ea66,'movie'),_0x555d4f=0x1);if(!_0x58d750&&_0x1a8559!=='movie'){const _0x237577=yield resolveMapping(_0x560e7,_0x2bfc5c,_0x40abb6);_0x237577&&_0x237577[_0x53b74c(0x1b3)]&&(_0x58d750=_0x237577['mal_id'],_0x555d4f=_0x237577[_0x53b74c(0x1bd)]||_0x2d2abe);}if(!_0x58d750)return[];const _0x4356e2=globalThis[_0x53b74c(0x188)]||{},_0x20c779=_0x4356e2[_0x53b74c(0x1c6)]||'both';let _0x22ca7a=[];if(_0x20c779==='both'){const [_0x31baf3,_0x1a1e6c]=yield Promise[_0x53b74c(0x1da)]([scrapeType(_0x58d750,_0x555d4f,_0x53b74c(0x1a5),_0x31ea66,_0x15eb37,_0x1a8559,_0x2bfc5c),scrapeType(_0x58d750,_0x555d4f,_0x53b74c(0x198),_0x31ea66,_0x15eb37,_0x1a8559,_0x2bfc5c)]);_0x22ca7a=[..._0x31baf3,..._0x1a1e6c];}else _0x22ca7a=yield scrapeType(_0x58d750,_0x555d4f,_0x20c779,_0x31ea66,_0x15eb37,_0x1a8559,_0x2bfc5c);const _0x324702=new Set();return _0x22ca7a[_0x53b74c(0x1d0)](_0x4694dc=>{const _0x5263e5=_0x53b74c;if(_0x324702[_0x5263e5(0x189)](_0x4694dc[_0x5263e5(0x1f6)]))return![];return _0x324702[_0x5263e5(0x1be)](_0x4694dc['url']),!![];});}catch(_0x55da10){return[];}});}module['exports']={'getStreams':getStreams,'onSettings':onSettings};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "hianime", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();

/* CLOUDBANK_STREAM_DISPLAY_START */
/* CLOUDBANK_STREAM_DISPLAY_V1
 * Embedded in each provider: the app downloads standalone JavaScript files.
 * Presentation only. No network requests and no changes to playback fields.
 */
function cloudbankDisplayInstall(provider, providerName, providerId) {
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
    var contentTitle = clean(meta.title || meta.name);
    if (contentTitle) text = text.split(contentTitle).join("");
    var quality = usable(stream.quality);
    var resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p?\b/i.exec(quality);
    if (!resolution) resolution = /\b(2160|1440|1080|720|576|480|360|240|144)p\b/i.exec(text);
    var qualityLabel = resolution ? (resolution[1] === "2160" ? "4K" : resolution[1] + "p") : (/\b4k\b/i.test(quality + " " + text) ? "4K" : "");
    var release = /\b(WEB[ ._-]?DL|WEB[ ._-]?RIP|BLU[ ._-]?RAY|BD[ ._-]?REMUX|REMUX|DVD[ ._-]?RIP|HD[ ._-]?RIP|HDTV|HDCAM|CAM)\b/i.exec(text);
    var releaseLabel = release ? release[1].toUpperCase().replace(/[ ._]/g, "-") : "";
    if (/^WEB-?DL$/.test(releaseLabel)) releaseLabel = "WEB-DL";
    if (/^WEB-?RIP$/.test(releaseLabel)) releaseLabel = "WEBRip";
    if (/^BLU-?RAY$/.test(releaseLabel)) releaseLabel = "BluRay";
    if (/REMUX/.test(releaseLabel)) releaseLabel = "Remux";
    var codec = /\b(HEVC|H[ ._-]?265|X265|AVC|H[ ._-]?264|X264|AV1)\b/i.exec(text);
    var codecLabel = codec ? (/265|HEVC/i.test(codec[1]) ? "HEVC" : /264|AVC/i.test(codec[1]) ? "H.264" : "AV1") : "";
    var hdr = /\b(DOLBY[ ._-]?VISION|HDR10\+|HDR10|HDR|SDR)(?!\w)/i.exec(text);
    var hdrLabel = hdr ? (/DOLBY/i.test(hdr[1]) ? "Dolby Vision" : hdr[1].toUpperCase()) : "";
    var videoLine = unique([qualityLabel, releaseLabel, codecLabel, hdrLabel]).join(" · ");
    if (videoLine) lines.push(videoLine);
    var audioLang = language(stream.audioLanguage || stream.language || stream.lang);
    var audioLanguages = Array.isArray(stream.audioLanguages) ? unique(stream.audioLanguages.map(language)) : [];
    if (!audioLang && audioLanguages.length === 1) audioLang = audioLanguages[0];
    var explicitAudio = /\b(English|Malay|Indonesian|Hindi|Tamil|Telugu|Japanese|Korean|Chinese|Spanish|French|Arabic)[ -]Audio\b/i.exec(text);
    if (!audioLang && explicitAudio) audioLang = language(explicitAudio[1]);
    // MovieBlast exposes its language as a trailing parenthesised code.
    var parenthesised = /\(([A-Za-z]{2,3})\)\s*$/.exec(clean(originalTitle));
    if (!audioLang && parenthesised) audioLang = language(parenthesised[1]);
    var audioLabel = audioLang ? audioLang + " Audio" : "";
    if (audioLanguages.length > 1) audioLabel = "Multi Audio (" + audioLanguages.join(", ") + ")";
    if (/^original$/i.test(clean(stream.audioLanguage))) audioLabel = "Original Audio";
    if (/\bdual[- ]audio\b/i.test(text)) audioLabel = "Dual Audio" + (audioLang ? " (" + audioLang + ")" : "");
    else if (/\b(?:multi[- ]audio|multilingual)\b/i.test(text)) audioLabel = "Multi Audio" + (audioLang ? " (" + audioLang + ")" : "");
    var audioCodec = /\b(DOLBY[ ._-]?ATMOS|ATMOS|TRUEHD|DTS[ ._-]?HD[ ._-]?MA|DTS[ ._-]?HD|DTS[ ._-]?X|DTS|E[ ._-]?AC[ ._-]?3|DDP|AC[ ._-]?3|AAC|FLAC|OPUS)\b/i.exec(text);
    var audioCodecLabel = audioCodec ? audioCodec[1].toUpperCase().replace(/[ ._]/g, "-") : "";
    if (/ATMOS/.test(audioCodecLabel)) audioCodecLabel = "Dolby Atmos";
    if (audioCodecLabel === "TRUEHD") audioCodecLabel = "Dolby TrueHD";
    if (/^(E-?AC-?3|DDP)$/.test(audioCodecLabel)) audioCodecLabel = "Dolby Digital Plus";
    if (/^AC-?3$/.test(audioCodecLabel)) audioCodecLabel = "Dolby Digital";
    var channels = /\b(7\.1|6\.1|5\.1|2\.0)\b/.exec(text);
    var audioLine = unique([audioLabel, [audioCodecLabel, channels ? channels[1] : ""].filter(Boolean).join(" ")]).join(" · ");
    if (audioLine) lines.push(audioLine);
    var subs = Array.isArray(stream.subtitles) ? unique(stream.subtitles.map(function(sub) {
      return sub && (language(sub.language) || language(sub.lang) || language(sub.code) || language(sub.id));
    })) : [];
    if (subs.length) lines.push("Subtitles: " + subs.join(", "));
    var server = usable(stream.serverName || stream.server || stream.sourceName);
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
    var size = usable(stream.size || stream.fileSize || (stream.behaviorHints && stream.behaviorHints.videoSize));
    if (!size) { var sm = /\b(\d+(?:\.\d+)?)\s*(GB|MB|TB|GiB|MiB)\b/i.exec(text); if (sm) size = sm[1] + " " + sm[2]; }
    if (/^\d+(?:\.\d+)?$/.test(size)) {
      var bytes = Number(size);
      size = bytes > 0 ? (bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + " GB" : (bytes / 1048576).toFixed(1) + " MB") : "";
    } else if (!/^\d+(?:\.\d+)?\s*(?:GB|MB|TB|GiB|MiB)$/i.test(size)) size = "";
    var minutes = Number(stream.runtimeMinutes || (type === "movie" ? meta.runtime : 0));
    var duration = minutes > 0 && Number.isFinite(minutes) ? Math.round(minutes) + " min" : "";
    if (!duration) { var dm = /\b(\d+)\s*min(?:utes)?\b/i.exec(clean(stream.duration) + " " + text); if (dm && Number(dm[1]) > 0) duration = dm[1] + " min"; }
    lines.push(unique([formatLabel, server, size, duration]).join(" · "));
    output.name = "";
    output.title = lines.join("\n");
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
module.exports = cloudbankDisplayInstall(module.exports, "HiAnime", "hianime");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
