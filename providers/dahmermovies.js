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
/* CLOUDBANK_DAHMER_CONSOLIDATED_V1: TV 4K path + existing main fallback under one ID. */
function cloudbankDahmerQuality(text) {
  var match = /(?:^|[^0-9])(\d{3,4})p\b/i.exec(String(text || ''));
  return match ? match[1] + 'p' : /\b4k\b/i.test(String(text || '')) ? '2160p' : 'Unknown';
}
function cloudbankDahmerQualityAllowed(text) {
  var q = cloudbankDahmerQuality(text), settings = typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS || {};
  return q === 'Unknown' || settings['q' + parseInt(q, 10)] !== false;
}
function cloudbankDahmerScope(nativeFetch, deadline) {
  var bounded = cloudbankMergedBudgetFetch(nativeFetch, deadline);
  // Metadata is shared within this engine request only.
  var metadata = Object.create(null);
  return function(url, options) {
    if (Date.now() >= deadline) return Promise.reject(new Error('Dahmermovies request budget exhausted'));
    var raw = typeof url === 'string' ? url : url && url.url;
    var isDetails = typeof raw === 'string' && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/\d+(?:\?|$)/.test(raw);
    if (!isDetails || options && options.method && String(options.method).toUpperCase() !== 'GET') return bounded(url, options);
    if (!metadata[raw]) metadata[raw] = bounded(url, options).then(function(response) {
      if (!response.ok) throw new Error('TMDB HTTP ' + response.status);
      return response.json();
    }).catch(function(error) { delete metadata[raw]; throw error; });
    return metadata[raw].then(function(data) {
      var body = JSON.stringify(data);
      return {ok:true,status:200,url:raw,headers:{get:function(){return 'application/json';}},json:function(){return Promise.resolve(JSON.parse(body));},text:function(){return Promise.resolve(body);}};
    });
  };
}
function cloudbankMergedBudgetFetch(nativeFetch, deadline) {
  function bounded(run) {
    var remaining = Math.min(2200, deadline - Date.now());
    if (remaining <= 0) return Promise.reject(new Error('Merged engine budget exhausted'));
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error('Merged engine request timeout')); }, remaining);
      Promise.resolve().then(run).then(function(value) { clearTimeout(timer); resolve(value); }, function(error) { clearTimeout(timer); reject(error); });
    });
  }
  return function(url, options) {
    return bounded(function() { return nativeFetch(url, options); }).then(function(response) {
      return { ok: response.ok, status: response.status, statusText: response.statusText, url: response.url, headers: response.headers,
        text: function() { return bounded(function() { return response.text(); }); },
        json: function() { return bounded(function() { return response.json(); }); },
        arrayBuffer: function() { return bounded(function() { return response.arrayBuffer(); }); } };
    });
  };
}

function cloudbankDahmerLegacy(nativeFetch, deadline) {
  var isolated = Object.create(typeof globalThis !== 'undefined' ? globalThis : {});
  var embedded = {exports:{}};
  (function(module, exports, fetch, globalThis, global, self) {
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

/* CLOUDBANK_VERSION_MERGE_ADAPTER_START */
function cloudbankVersionMerge(engines, providerId) {
  var primary = engines[0].provider;
  var merged = Object.assign({}, primary);
  function platform(args) {
    var options = args[4];
    var hint = options && options.platform || (typeof globalThis !== 'undefined' && (globalThis.VUEO_PLATFORM || globalThis.PLATFORM || globalThis.platform));
    if (!hint && typeof navigator !== 'undefined') hint = navigator.userAgent;
    hint = String(hint || '').toLowerCase();
    if (/ios|iphone|ipad/.test(hint)) return 'ios';
    if (/android/.test(hint)) return 'android';
    return hint;
  }
  function available(engine, args) {
    if (!engine.enabled) return false;
    if (!engine.disabledPlatforms.length) return true;
    var current = platform(args);
    // Preserve source platform restrictions when the host cannot identify its platform.
    return !!current && engine.disabledPlatforms.indexOf(current) < 0;
  }
  function key(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(key).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + key(value[k]); }).join(',') + '}';
  }
  function combine(results) {
    var seen = Object.create(null), out = [];
    results.forEach(function(rows) {
      if (!Array.isArray(rows)) return;
      rows.forEach(function(stream) {
        if (!stream || typeof stream.url !== 'string' || !/^(https?:\/\/|magnet:)/i.test(stream.url)) return;
        var identity;
        try { identity = key([stream.url, stream.name || '', stream.headers || {}, stream.subtitles || [], stream.audio || stream.language || '', stream.quality || '']); }
        catch (_) { identity = String(stream.url) + '/' + String(stream.name || ''); }
        if (seen[identity]) return;
        seen[identity] = true;
        out.push(Object.assign({}, stream, { provider: providerId }));
      });
    });
    return out;
  }
  merged.getStreams = function(id, type, season, episode) {
    var args = Array.prototype.slice.call(arguments);
    type = type === 'series' ? 'tv' : type;
    if (!String(id || '').trim() || (type !== 'movie' && type !== 'tv')) return Promise.resolve([]);
    if (type === 'tv' && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    args[0] = String(id); args[1] = type;
    if (type === 'tv') { args[2] = Number(season); args[3] = Number(episode); }
    var deadline = Date.now() + 18500;
    var active = engines.filter(function(engine) { return available(engine, args); });
    var results = active.map(function() { return []; });
    return new Promise(function(resolve) {
      var done = false, primaryDone = false, alternateStarted = false, alternateDone = false;
      var timers = [];
      function finish() {
        if (done) return; done = true;
        timers.forEach(clearTimeout);
        resolve(combine(results));
      }
      function attempt(index, ms, next) {
        if (done || Date.now() >= deadline) { next(); return; }
        var settled = false;
        var timer = setTimeout(function() { settle([]); }, Math.min(ms, deadline - Date.now())); timers.push(timer);
        function settle(rows) {
          if (settled || done) return; settled = true; clearTimeout(timer);
          results[index] = Array.isArray(rows) ? rows : [];
          next();
        }
        Promise.resolve().then(function() { return active[index].provider.getStreams.apply(active[index].provider, args); }).then(settle, function() { settle([]); });
      }
      function alternate(index) {
        if (done) return;
        if (index >= active.length) { alternateDone = true; if (primaryDone) finish(); return; }
        attempt(index, 6000, function() {
          if (combine([results[index]]).length) { alternateDone = true; if (primaryDone) finish(); }
          else alternate(index + 1);
        });
      }
      function startAlternate() {
        if (alternateStarted || done) return; alternateStarted = true; alternate(1);
      }
      if (!active.length) { finish(); return; }
      timers.push(setTimeout(finish, 18500));
      // A fast successful primary starts no duplicate engine. A slow or failed one unlocks the fallback.
      timers.push(setTimeout(startAlternate, 5000));
      attempt(0, 18500, function() {
        primaryDone = true;
        if (combine([results[0]]).length) { finish(); return; }
        startAlternate();
        if (alternateDone) finish();
      });
    });
  };
  // Preserve primary settings and add missing alternate controls/options under the same provider ID.
  if (engines.some(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; })) {
    merged.onSettings = function() {
      var args = arguments;
      return Promise.all(engines.filter(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; }).map(function(engine) {
        return new Promise(function(resolve) {
          var timer = setTimeout(function() { resolve([]); }, 1500);
          Promise.resolve().then(function() { return engine.provider.onSettings.apply(engine.provider, args); }).then(function(value) { clearTimeout(timer); resolve(value); }, function() { clearTimeout(timer); resolve([]); });
        });
      })).then(function(values) {
        if (values.length && !Array.isArray(values[0])) return values[0];
        var out = [], keys = Object.create(null), headers = Object.create(null);
        values.forEach(function(rows) {
          if (!Array.isArray(rows)) return;
          rows.forEach(function(setting) {
            if (!setting || typeof setting !== 'object') return;
            if (!setting.key) {
              var identity = key(setting); if (!headers[identity]) { headers[identity] = true; out.push(setting); } return;
            }
            var existing = keys[setting.key];
            if (!existing) { existing = Object.assign({}, setting); if (Array.isArray(setting.options)) existing.options = setting.options.slice(); keys[setting.key] = existing; out.push(existing); return; }
            if (existing.type === setting.type && Array.isArray(existing.options) && Array.isArray(setting.options)) {
              setting.options.forEach(function(option) { if (!existing.options.some(function(current) { return current.value === option.value; })) existing.options.push(option); });
            }
          });
        });
        return out;
      });
    };
  }
  return merged;
}
function cloudbankMergedBudgetFetch(nativeFetch, deadline) {
  function bounded(run) {
    var remaining = Math.min(2200, deadline - Date.now());
    if (remaining <= 0) return Promise.reject(new Error('Merged engine budget exhausted'));
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error('Merged engine request timeout')); }, remaining);
      Promise.resolve().then(run).then(function(value) { clearTimeout(timer); resolve(value); }, function(error) { clearTimeout(timer); reject(error); });
    });
  }
  return function(url, options) {
    return bounded(function() { return nativeFetch(url, options); }).then(function(response) {
      return { ok: response.ok, status: response.status, statusText: response.statusText, url: response.url, headers: response.headers,
        text: function() { return bounded(function() { return response.text(); }); },
        json: function() { return bounded(function() { return response.json(); }); },
        arrayBuffer: function() { return bounded(function() { return response.arrayBuffer(); }); } };
    });
  };
}
function cloudbankMergedMetadataFetch(nativeFetch) {
  return function(url, options) {
    var raw = typeof url === 'string' ? url : url && url.url;
    var match = typeof raw === 'string' && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(raw);
    if (!match || options && options.method && String(options.method).toUpperCase() !== 'GET' || typeof vueoSharedTmdb !== 'function') return nativeFetch(url, options);
    var context = typeof globalThis !== 'undefined' ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof context === 'string') { try { context = JSON.parse(context); } catch (_) { context = null; } }
    var contextId = context && (context.tmdbId || context.tmdb && context.tmdb.id);
    if (contextId && String(contextId) !== match[2]) return nativeFetch(url, options);
    return vueoSharedTmdb(raw, function() {
      return nativeFetch(url, options).then(function(response) { if (!response.ok) throw new Error('TMDB HTTP ' + response.status); return response.json(); });
    }).then(function(data) {
      var body = JSON.stringify(data);
      return { ok: true, status: 200, url: raw, headers: { get: function(name) { return String(name).toLowerCase() === 'content-type' ? 'application/json' : null; } },
        json: function() { return Promise.resolve(JSON.parse(body)); }, text: function() { return Promise.resolve(body); } };
    });
  };
}
/* CLOUDBANK_VERSION_MERGE_ADAPTER_END */

var cloudbankMergedEngines = [{ id: "dahmermovies", enabled: true, disabledPlatforms: [], provider: module.exports }];
cloudbankMergedEngines.push({ id: "dahmermovies-v2", enabled: true, disabledPlatforms: [], provider: (function() {
  function createEngine(deadline) {
  var embedded = { exports: {} };
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported merged module: " + name);
    return require(name);
  }
  (function(module, exports, require, fetch, global) {
/* CLOUDBANK_MERGED_ENGINE_START:dahmermovies-v2 */
// Dahmer Movies Scraper for Nuvio Local Scrapers
// React Native compatible version

// Settings layout
async function onSettings() {
    return [
        { type: "header", label: "Quality Preferences" },
        { type: "toggle", key: "q2160", label: "Enable 4K (2160p)", defaultValue: true },
        { type: "toggle", key: "q1440", label: "Enable 2K (1440p)", defaultValue: true },
        { type: "toggle", key: "q1080", label: "Enable FHD (1080p)", defaultValue: true },
        { type: "toggle", key: "q720", label: "Enable HD (720p)", defaultValue: true },
        { type: "toggle", key: "q480", label: "Enable SD (480p)", defaultValue: true }
    ];
}

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 60000; // 60 seconds

// Quality mapping
const Qualities = {
    Unknown: 0,
    P144: 144,
    P240: 240,
    P360: 360,
    P480: 480,
    P720: 720,
    P1080: 1080,
    P1440: 1440,
    P2160: 2160
};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    const requestOptions = {
        timeout: TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            ...options.headers
        },
        ...options
    };

    return fetch(url, requestOptions).then(function (response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    });
}

// Utility functions
function getEpisodeSlug(season = null, episode = null) {
    if (season === null && episode === null) {
        return ['', ''];
    }
    const seasonSlug = season < 10 ? `0${season}` : `${season}`;
    const episodeSlug = episode < 10 ? `0${episode}` : `${episode}`;
    return [seasonSlug, episodeSlug];
}

function getIndexQuality(str) {
    if (!str) return Qualities.Unknown;
    const match = str.match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : Qualities.Unknown;
}

// Extract quality with codec information
function getQualityWithCodecs(str) {
    if (!str) return 'Unknown';

    // Extract base quality (resolution)
    const qualityMatch = str.match(/(\d{3,4})[pP]/);
    const baseQuality = qualityMatch ? `${qualityMatch[1]}p` : 'Unknown';

    // Extract codec information (excluding HEVC and bit depth)
    const codecs = [];
    const lowerStr = str.toLowerCase();

    // HDR formats
    if (lowerStr.includes('dv') || lowerStr.includes('dolby vision')) codecs.push('DV');
    if (lowerStr.includes('hdr10+')) codecs.push('HDR10+');
    else if (lowerStr.includes('hdr10') || lowerStr.includes('hdr')) codecs.push('HDR');

    // Special formats
    if (lowerStr.includes('remux')) codecs.push('REMUX');
    if (lowerStr.includes('imax')) codecs.push('IMAX');

    // Combine quality with codecs using pipeline separator
    if (codecs.length > 0) {
        return `${baseQuality} | ${codecs.join(' | ')}`;
    }

    return baseQuality;
}

function getIndexQualityTags(str, fullTag = false) {
    if (!str) return '';

    if (fullTag) {
        const match = str.match(/(.*)\.(?:mkv|mp4|avi)/i);
        return match ? match[1].trim() : str;
    } else {
        const match = str.match(/\d{3,4}[pP]\.?(.*?)\.(mkv|mp4|avi)/i);
        return match ? match[1].replace(/\./g, ' ').trim() : str;
    }
}

function encodeUrl(url) {
    try {
        return encodeURI(url);
    } catch (e) {
        return url;
    }
}

function decode(input) {
    try {
        return decodeURIComponent(input);
    } catch (e) {
        return input;
    }
}

// Function to resolve redirects and get the final direct URL
function resolveFinalUrl(startUrl) {
    const maxRedirects = 5;
    const referer = 'https://a.111477.xyz/';
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

    function attemptResolve(url, count, retryCount = 0) {
        if (count >= maxRedirects) {
            return Promise.resolve(url.includes('111477.xyz') ? null : url);
        }

        return fetch(url, {
            method: 'HEAD',
            redirect: 'manual',
            headers: {
                'User-Agent': userAgent,
                'Referer': referer
            }
        }).then(function (response) {
            // Handle rate limiting
            if (response.status === 429 && retryCount < 3) {
                const waitTime = (retryCount + 1) * 3000;
                return new Promise(resolve => setTimeout(resolve, waitTime))
                    .then(() => attemptResolve(url, count, retryCount + 1));
            }

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (location) {
                    const nextUrl = location.startsWith('http') 
                        ? location 
                        : new URL(location, url).href;
                    return attemptResolve(nextUrl, count + 1);
                }
            }
            
            // If we are at a 200 OK but still on the redirector domain, it's a failure
            if (url.includes('111477.xyz')) {
                return null;
            }

            return url;
        }).catch(function (error) {
            return null;
        });
    }

    return attemptResolve(startUrl, 0);
}

// Format file size from bytes to human readable format
function formatFileSize(sizeText) {
    if (!sizeText) return null;

    // If it's already formatted (contains GB, MB, etc.), return as is
    if (/\d+(\.\d+)?\s*(GB|MB|KB|TB)/i.test(sizeText)) {
        return sizeText;
    }

    // If it's a number (bytes), convert to human readable
    const bytes = parseInt(sizeText);
    if (isNaN(bytes)) return sizeText;

    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(2);

    return `${size} ${sizes[i]}`;
}

// Parse HTML using basic string manipulation (React Native compatible)
function parseLinks(html) {
    const links = [];

    // Parse table rows to get both links and file sizes
    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const rowContent = rowMatch[1];

        // Extract link from the row
        const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
        if (!linkMatch) continue;

        const href = linkMatch[1];
        const text = linkMatch[2].trim();

        // Skip parent directory and empty links
        if (!text || href === '../' || text === '../') continue;

        // Extract file size from the same row - try multiple patterns
        let size = null;

        // Pattern 1: DahmerMovies specific - data-sort attribute with byte size
        const sizeMatch1 = rowContent.match(/<td[^>]*data-sort=["']?(\d+)["']?[^>]*>/i);
        if (sizeMatch1) {
            size = sizeMatch1[1]; // Use the data-sort value (bytes)
        }

        // Pattern 2: Standard Apache directory listing with filesize class
        if (!size) {
            const sizeMatch2 = rowContent.match(/<td[^>]*class=["']filesize["'][^>]*[^>]*>([^<]+)<\/td>/i);
            if (sizeMatch2) {
                size = sizeMatch2[1].trim();
            }
        }

        // Pattern 3: Look for size in any td element after the link (formatted sizes)
        if (!size) {
            const sizeMatch3 = rowContent.match(/<\/a><\/td>\s*<td[^>]*>([^<]+(?:GB|MB|KB|B|\d+\s*(?:GB|MB|KB|B)))<\/td>/i);
            if (sizeMatch3) {
                size = sizeMatch3[1].trim();
            }
        }

        // Pattern 4: Look for size anywhere in the row (more permissive)
        if (!size) {
            const sizeMatch4 = rowContent.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|B|bytes?))/i);
            if (sizeMatch4) {
                size = sizeMatch4[1].trim();
            }
        }

        links.push({ text, href, size });
    }

    // Fallback to simple link parsing if table parsing fails
    if (links.length === 0) {
        const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const text = match[2].trim();
            if (text && href && href !== '../' && text !== '../') {
                links.push({ text, href, size: null });
            }
        }
    }

    return links;
}

// Main Dahmer Movies fetcher function
function invokeDahmerMovies(title, year, season = null, episode = null) {
    console.log(`[DahmerMovies] Searching for: ${title} (${year})${season ? ` Season ${season}` : ''}${episode ? ` Episode ${episode}` : ''}`);

    const settings = globalThis.SCRAPER_SETTINGS || {};
    const allowed = [];
    if (settings.q2160 !== false) allowed.push(2160);
    if (settings.q1440 !== false) allowed.push(1440);
    if (settings.q1080 !== false) allowed.push(1080);
    if (settings.q720 !== false) allowed.push(720);
    if (settings.q480 !== false) allowed.push(480);

    // Construct URL based on content type (with proper encoding)
    const encodedUrl = season === null
        ? `${DAHMER_MOVIES_API}/movies/${encodeURIComponent(title.replace(/:/g, '') + ' (' + year + ')')}/`
        : `${DAHMER_MOVIES_API}/tvs/${encodeURIComponent(title.replace(/:/g, ' -'))}/${encodeURIComponent('Season ' + season)}/`;

    console.log(`[DahmerMovies] Fetching from: ${encodedUrl}`);

    return makeRequest(encodedUrl).then(function (response) {
        return response.text();
    }).then(function (html) {
        console.log(`[DahmerMovies] Response length: ${html.length}`);

        // Parse HTML to extract links
        const paths = parseLinks(html);
        console.log(`[DahmerMovies] Found ${paths.length} total links`);

        // Filter based on content type and quality settings
        let filteredPaths;
        if (season === null) {
            // For movies, filter by quality
            filteredPaths = paths.filter(path => {
                const q = getIndexQuality(path.text);
                return allowed.includes(q);
            });
            console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} movie links (Allowed: ${allowed.join(', ')})`);
        } else {
            // For TV shows, filter by season and episode + quality
            const [seasonSlug, episodeSlug] = getEpisodeSlug(season, episode);
            const episodePattern = new RegExp(`S${seasonSlug}E${episodeSlug}`, 'i');
            filteredPaths = paths.filter(path => {
                if (!episodePattern.test(path.text)) return false;
                
                const q = getIndexQuality(path.text);
                return allowed.includes(q);
            });
            console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} TV episode links (S${seasonSlug}E${episodeSlug}, Allowed: ${allowed.join(', ')})`);
        }

        if (filteredPaths.length === 0) {
            console.log('[DahmerMovies] No matching content found');
            return [];
        }

        // Function to sleep/delay
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

        // Process results sequentially to avoid 429 rate limiting
        const results = [];
        const maxLinks = 10; // Increased to 10 links
        const pathsToProcess = filteredPaths.slice(0, maxLinks);
        
        async function processPaths() {
            for (const path of pathsToProcess) {
                const quality = getIndexQuality(path.text);
                const qualityWithCodecs = getQualityWithCodecs(path.text);
                const tags = getIndexQualityTags(path.text);

                // Construct proper URL
                let fullUrl;
                if (path.href.startsWith('http')) {
                    try {
                        const url = new URL(path.href);
                        fullUrl = `${url.protocol}//${url.host}${url.pathname}`;
                    } catch (error) {
                        fullUrl = path.href.replace(/ /g, '%20');
                    }
                } else if (path.href.startsWith('/')) {
                    const urlObj = new URL(DAHMER_MOVIES_API);
                    const encodedPath = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
                    fullUrl = `${urlObj.protocol}//${urlObj.host}${encodedPath}`;
                } else {
                    const baseUrl = encodedUrl.endsWith('/') ? encodedUrl : encodedUrl + '/';
                    const encodedPath = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
                    fullUrl = baseUrl + encodedPath;
                }

                try {
                    const finalUrl = await resolveFinalUrl(fullUrl);
                    if (finalUrl) {
                        results.push({
                            name: "DahmerMovies",
                            title: path.text,
                            url: finalUrl,
                            quality: qualityWithCodecs,
                            size: formatFileSize(path.size),
                            type: "direct",
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
                                'Referer': DAHMER_MOVIES_API + '/'
                            },
                            provider: "dahmermovies",
                            filename: path.text
                        });
                    }
                    
                    // 1.5 second delay to balance speed and safety
                    await sleep(1500);
                } catch (e) {
                    console.log(`[DahmerMovies] Failed to resolve ${fullUrl}`);
                }
            }
            
            // Sort by quality (highest first)
            results.sort((a, b) => {
                const qualityA = getIndexQuality(a.filename);
                const qualityB = getIndexQuality(b.filename);
                return qualityB - qualityA;
            });

            console.log(`[DahmerMovies] Successfully processed ${results.length} streams`);
            return results;
        }

        return processPaths();

    }).catch(function (error) {
        if (error.name === 'AbortError') {
            console.log('[DahmerMovies] Request timeout - server took too long to respond');
        } else {
            console.log(`[DahmerMovies] Error: ${error.message}`);
        }
        return [];
    });
}

// Main function to get streams for TMDB content
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[DahmerMovies] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    // Get TMDB info
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return makeRequest(tmdbUrl).then(function (tmdbResponse) {
        return tmdbResponse.json();
    }).then(function (tmdbData) {
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const year = mediaType === 'tv' ? tmdbData.first_air_date?.substring(0, 4) : tmdbData.release_date?.substring(0, 4);

        if (!title) {
            throw new Error('Could not extract title from TMDB response');
        }

        console.log(`[DahmerMovies] TMDB Info: "${title}" (${year})`);

        // Call the main scraper function
        return invokeDahmerMovies(
            title,
            year ? parseInt(year) : null,
            seasonNum,
            episodeNum
        );

    }).catch(function (error) {
        console.error(`[DahmerMovies] Error in getStreams: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams, onSettings };
} else {
    // For React Native environment
    global.getStreams = getStreams;
    global.onSettings = onSettings;
}

/* CLOUDBANK_MERGED_ENGINE_END:dahmermovies-v2 */
  })(embedded, embedded.exports, portableRequire, cloudbankMergedBudgetFetch(cloudbankMergedMetadataFetch(fetch), deadline), typeof globalThis !== "undefined" ? globalThis : global);
  return Object.assign({}, embedded.exports);
  }
  var settingsProvider = createEngine(Date.now() + 6000);
  return Object.assign({}, settingsProvider, { getStreams: function() {
    // A fresh request scope prevents an expired scan from borrowing a later scan's deadline.
    var engine = createEngine(Date.now() + 6000);
    return engine.getStreams.apply(engine, arguments);
  } });
})() });
module.exports = cloudbankVersionMerge(cloudbankMergedEngines, "dahmermovies");
if (typeof globalThis !== "undefined") { globalThis.getStreams = module.exports.getStreams; if (module.exports.onSettings) globalThis.onSettings = module.exports.onSettings; }


  })(embedded, embedded.exports, cloudbankDahmerScope(nativeFetch, deadline), isolated, isolated, isolated);
  return embedded.exports;
}
function cloudbankDahmerTV(nativeFetch, deadline) {
  var embedded = {exports:{}};
  (function(module, exports, fetch) {
/* CLOUDBANK_DAHMER_TV_CORE_START */

const _0x2d04b7=_0x496e;(function(_0x5076a3,_0x39fd72){const _0x12f68b=_0x496e,_0x39212e=_0x5076a3();while(!![]){try{const _0x403b05=-parseInt(_0x12f68b(0x176))/0x1+-parseInt(_0x12f68b(0x159))/0x2+parseInt(_0x12f68b(0x151))/0x3*(-parseInt(_0x12f68b(0x164))/0x4)+-parseInt(_0x12f68b(0x148))/0x5+parseInt(_0x12f68b(0x145))/0x6*(-parseInt(_0x12f68b(0x144))/0x7)+parseInt(_0x12f68b(0x177))/0x8+parseInt(_0x12f68b(0x170))/0x9;if(_0x403b05===_0x39fd72)break;else _0x39212e['push'](_0x39212e['shift']());}catch(_0x555243){_0x39212e['push'](_0x39212e['shift']());}}}(_0x39aa,0x286b8));var __async=(_0x3b000f,_0x6b952b,_0x285023)=>{return new Promise((_0x4983ee,_0xc561fb)=>{const _0x387399=_0x496e;var _0x51942c=_0x6d4c8c=>{const _0x4b04c8=_0x496e;try{_0x2ad414(_0x285023[_0x4b04c8(0x16f)](_0x6d4c8c));}catch(_0x203eba){_0xc561fb(_0x203eba);}},_0x18eb73=_0x383366=>{const _0x59aa14=_0x496e;try{_0x2ad414(_0x285023[_0x59aa14(0x158)](_0x383366));}catch(_0xe29812){_0xc561fb(_0xe29812);}},_0x2ad414=_0x291a99=>_0x291a99[_0x387399(0x14a)]?_0x4983ee(_0x291a99[_0x387399(0x153)]):Promise['resolve'](_0x291a99['value'])[_0x387399(0x15b)](_0x51942c,_0x18eb73);_0x2ad414((_0x285023=_0x285023[_0x387399(0x171)](_0x3b000f,_0x6b952b))[_0x387399(0x16f)]());});};console[_0x2d04b7(0x14d)](_0x2d04b7(0x15d));var TMDB_API_KEY=_0x2d04b7(0x14e),DAHMER_MOVIES_API=_0x2d04b7(0x165);function makeRequest(_0x30119a){return __async(this,null,function*(){const _0xa81022=_0x496e;try{return yield fetch(_0x30119a,{'headers':{'User-Agent':_0xa81022(0x163)}});}catch(_0x3c2474){return{'ok':![]};}});}function resolveFinalUrl(_0x627e34){return __async(this,null,function*(){const _0x6078ab=_0x496e;let _0x3fb108=_0x627e34;_0x627e34[_0x6078ab(0x149)](_0x6078ab(0x154))&&(_0x3fb108=decodeURIComponent(_0x627e34[_0x6078ab(0x16e)]('u=')[0x1]));try{const _0x3bf089=yield fetch(_0x3fb108,{'method':_0x6078ab(0x14c),'redirect':_0x6078ab(0x15e),'headers':{'User-Agent':_0x6078ab(0x174),'Referer':DAHMER_MOVIES_API+'/'}});return _0x3bf089[_0x6078ab(0x15c)];}catch(_0xb659b3){return _0x3fb108;}});}function parseLinks(_0x26f757){const _0x19ef35=_0x2d04b7,_0x5eb3f4=[],_0x51fc2a=new RegExp(_0x19ef35(0x152),'gis');let _0x169d05;while((_0x169d05=_0x51fc2a[_0x19ef35(0x16a)](_0x26f757))!==null){const _0x39826c=_0x169d05[0x1],_0x51945a=_0x39826c[_0x19ef35(0x17a)](/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);if(_0x51945a){const _0x3d7834=_0x51945a[0x1],_0x20c39e=_0x51945a[0x2][_0x19ef35(0x155)]();_0x20c39e&&_0x3d7834!==_0x19ef35(0x167)&&/\.(mkv|mp4|avi|webm)$/i['test'](_0x20c39e)&&_0x5eb3f4['push']({'text':_0x20c39e,'href':_0x3d7834});}}return _0x5eb3f4;}function invokeDahmerMovies(_0x192091,_0xd66db5,_0x494e3e=null,_0x5a3aa2=null){return __async(this,null,function*(){const _0x24af47=_0x496e,_0x1f47e4=_0x192091[_0x24af47(0x166)](/:/g,''),_0x337327=_0x494e3e!==null?[_0x24af47(0x15a)+encodeURIComponent(_0x1f47e4)+_0x24af47(0x15f)+(_0x494e3e<0xa?'0'+_0x494e3e:_0x494e3e)+'/','/tvs/'+encodeURIComponent(_0x1f47e4)+_0x24af47(0x15f)+_0x494e3e+'/']:['/movies/'+encodeURIComponent(_0x1f47e4+'\x20('+_0xd66db5+')')+'/'];let _0x515d71='',_0x664bb5='';for(const _0x132250 of _0x337327){const _0x2bb293=DAHMER_MOVIES_API+_0x132250,_0x397254=yield makeRequest(_0x2bb293);if(_0x397254['ok']){var page=yield _0x397254.text();if(parseLinks(page).length){_0x515d71=page;_0x664bb5=_0x2bb293;break;}}}if(!_0x515d71)return[];const _0x11d018=parseLinks(_0x515d71);let _0x777c46=_0x11d018;if(_0x494e3e!==null&&_0x5a3aa2!==null){const _0x1cf256=_0x5a3aa2<0xa?'0'+_0x5a3aa2:_0x5a3aa2,_0x3bbd1a=new RegExp('(?:^|[^a-z0-9])(?:S0*'+Number(_0x494e3e)+')?E0*'+Number(_0x5a3aa2)+'(?![0-9])','i');_0x777c46=_0x11d018[_0x24af47(0x16d)](_0x2f6fd5=>_0x3bbd1a['test'](_0x2f6fd5[_0x24af47(0x156)]));}_0x777c46=_0x777c46.filter(function(row){return cloudbankDahmerQualityAllowed(row.text);});const _0x26a508=_0x777c46['sort']((_0x419f63,_0x31c5b6)=>{const _0x1a5cad=_0x24af47,_0x40fb2c=/2160p|4k/i['test'](_0x419f63[_0x1a5cad(0x156)]),_0x342460=/2160p|4k/i[_0x1a5cad(0x169)](_0x31c5b6[_0x1a5cad(0x156)]);return _0x342460-_0x40fb2c;}),_0x9bc5c9=[];for(const _0x592ff6 of _0x26a508[_0x24af47(0x175)](0x0,0x5)){let _0x280393;if(_0x592ff6['href'][_0x24af47(0x168)]('http'))_0x280393=_0x592ff6[_0x24af47(0x14b)];else _0x592ff6[_0x24af47(0x14b)][_0x24af47(0x149)](_0x24af47(0x17b))||_0x592ff6[_0x24af47(0x14b)][_0x24af47(0x149)](_0x24af47(0x15a))?_0x280393=DAHMER_MOVIES_API+(_0x592ff6[_0x24af47(0x14b)][_0x24af47(0x168)]('/')?'':'/')+_0x592ff6[_0x24af47(0x14b)]:_0x280393=_0x664bb5+_0x592ff6['href'];_0x280393=_0x280393[_0x24af47(0x166)](/([^:]\/)\/+/g,'$1');const _0x46f628=yield resolveFinalUrl(_0x280393);_0x9bc5c9[_0x24af47(0x162)]({'name':_0x24af47(0x146),'title':_0x592ff6['text'],'url':_0x46f628,'quality':cloudbankDahmerQuality(_0x592ff6.text),'headers':{'User-Agent':_0x24af47(0x174),'Referer':DAHMER_MOVIES_API+'/','Range':_0x24af47(0x150)},'provider':_0x24af47(0x178)});}return _0x9bc5c9;});}function _0x496e(_0x50604e,_0xc1f6bb){_0x50604e=_0x50604e-0x144;const _0x39aa64=_0x39aa();let _0x496e7c=_0x39aa64[_0x50604e];if(_0x496e['DVuJgC']===undefined){var _0x5d39d7=function(_0x3663ff){const _0x1a3d11='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x3b000f='',_0x6b952b='';for(let _0x285023=0x0,_0x4983ee,_0xc561fb,_0x51942c=0x0;_0xc561fb=_0x3663ff['charAt'](_0x51942c++);~_0xc561fb&&(_0x4983ee=_0x285023%0x4?_0x4983ee*0x40+_0xc561fb:_0xc561fb,_0x285023++%0x4)?_0x3b000f+=String['fromCharCode'](0xff&_0x4983ee>>(-0x2*_0x285023&0x6)):0x0){_0xc561fb=_0x1a3d11['indexOf'](_0xc561fb);}for(let _0x18eb73=0x0,_0x2ad414=_0x3b000f['length'];_0x18eb73<_0x2ad414;_0x18eb73++){_0x6b952b+='%'+('00'+_0x3b000f['charCodeAt'](_0x18eb73)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x6b952b);};_0x496e['ModTYJ']=_0x5d39d7,_0x496e['OzmMUG']={},_0x496e['DVuJgC']=!![];}const _0x561694=_0x39aa64[0x0],_0x25d3ae=_0x50604e+_0x561694,_0x344d51=_0x496e['OzmMUG'][_0x25d3ae];return!_0x344d51?(_0x496e7c=_0x496e['ModTYJ'](_0x496e7c),_0x496e['OzmMUG'][_0x25d3ae]=_0x496e7c):_0x496e7c=_0x344d51,_0x496e7c;}function getStreams(_0x1e74c7,_0x4e7a14='movie',_0x479f09=null,_0x21c0c7=null){return __async(this,null,function*(){const _0x46a367=_0x496e;var _0x2ae1e9;try{const _0x2ce8eb=_0x4e7a14==='tv'?'tv':_0x46a367(0x172),_0x10adb0='https://api.themoviedb.org/3/'+_0x2ce8eb+'/'+_0x1e74c7+_0x46a367(0x16b)+TMDB_API_KEY,_0x55b796=yield makeRequest(_0x10adb0),_0x1fc166=yield _0x55b796[_0x46a367(0x14f)](),_0x4720c9=_0x4e7a14==='tv'?_0x1fc166['name']:_0x1fc166[_0x46a367(0x173)],_0x5989ac=(_0x2ae1e9=_0x4e7a14==='tv'?_0x1fc166[_0x46a367(0x157)]:_0x1fc166['release_date'])==null?void 0x0:_0x2ae1e9[_0x46a367(0x160)](0x0,0x4);if(!_0x4720c9)return[];return yield invokeDahmerMovies(_0x4720c9,_0x5989ac,_0x479f09,_0x21c0c7);}catch(_0x3e51b0){return[];}});}function _0x39aa(){const _0x5200e5=['Bwf0y2G','l21VDMLLCY8','mJe2mha','mtr5rhfHrhC','ndq4nJy4yKDNu1vt','rgfOBwvYtw92AwvZ','mta4mha','mti0nZu2me5izLDcAa','Aw5JBhvKzxm','zg9Uzq','AhjLzG','sevbra','Bg9N','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','ANnVBG','yNL0zxm9mc0','nJbtEgv2zuq','phrYw14+xsO+kc4QpYK8xc90CJ4','DMfSDwu','l2j1BgS/Dt0','DhjPBq','Dgv4Da','zMLYC3rFywLYx2rHDgu','DgHYB3C','ntuZntiYDNLoyvLm','l3r2CY8','DgHLBG','DxjS','w0rHAg1LCK1VDMLLC10Gsw5PDgLHBgL6Aw5NifnJCMfWzxi','zM9SBg93','l1nLyxnVBIuYma','C3vIC3rYAw5N','z2v0u3rYzwfTCW','ChvZAa','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2','mty0mJrwvNjHtwK','Ahr0Chm6lY9HlJeXmtq3nY54ExO','CMvWBgfJzq','lI4V','C3rHCNrZv2L0Aa','DgvZDa','zxHLyW','p2fWAv9RzxK9','Dw5KzwzPBMvK','zMLSDgvY','C3bSAxq','BMv4Da','odyYoty1mhHQvxvqCa','yxbWBhK','Bw92Awu','DgL0Bgu','tw96AwXSys81lJaGkefUzhjVAwqPiev4B1bSyxLLCG','C2XPy2u','mtu1otG5ru1fuwDR','oty1mtG0u3zfCMXK','zgfOBwvYBw92AwvZ','zxHWB3j0CW'];_0x39aa=function(){return _0x5200e5;};return _0x39aa();}if(typeof module!==_0x2d04b7(0x16c))module[_0x2d04b7(0x179)]={'getStreams':getStreams};else global[_0x2d04b7(0x161)]=getStreams;

/* CLOUDBANK_DAHMER_TV_CORE_END */
  })(embedded, embedded.exports, cloudbankMetadataFetch(cloudbankDahmerScope(nativeFetch, deadline)));
  return embedded.exports;
}

function cloudbankDahmerInstall(nativeFetch) {
  // Reuse the merged settings, including quality switches, without starting HTTP.
  var settingsProvider = cloudbankDahmerLegacy(nativeFetch, Date.now() + 18500);
  var provider = Object.assign({}, settingsProvider);
  function valid(rows) {
    var seen = Object.create(null);
    return (Array.isArray(rows) ? rows : []).filter(function(stream) {
      if (!stream || typeof stream.url !== 'string' || !/^https?:\/\//i.test(stream.url)) return false;
      if (!cloudbankDahmerQualityAllowed(stream.filename || stream.title || stream.quality)) return false;
      var key = JSON.stringify([stream.url,stream.quality,stream.headers,stream.subtitles]);
      if (seen[key]) return false; seen[key] = true; return true;
    }).map(function(stream) { return Object.assign({}, stream, {provider:'dahmermovies'}); });
  }
  function run(make, deadline, args) {
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function(){finish([]);}, Math.max(0,deadline-Date.now()));
      function finish(rows) { if(done)return;done=true;clearTimeout(timer);resolve(valid(rows)); }
      Promise.resolve().then(function(){var engine=make(nativeFetch,deadline);return engine.getStreams.apply(engine,args);}).then(finish,function(){finish([]);});
    });
  }
  provider.getStreams = function(id,type,season,episode) {
    var args = Array.prototype.slice.call(arguments), kind = type === 'series' ? 'tv' : type;
    if (!String(id || '').trim() || (kind !== 'movie' && kind !== 'tv')) return Promise.resolve([]);
    if (kind === 'tv' && (!Number.isInteger(Number(season)) || Number(season)<0 || !Number.isInteger(Number(episode)) || Number(episode)<1)) return Promise.resolve([]);
    args[0]=String(id);args[1]=kind;
    if(kind==='tv'){args[2]=Number(season);args[3]=Number(episode);}
    else {args[2]=null;args[3]=null;}
    var deadline=Date.now()+18500;
    console.log('[Dahmermovies] ROUTE: consolidated catalogue, 4K priority');
    return run(cloudbankDahmerTV,Math.min(deadline,Date.now()+6500),args).then(function(rows) {
      if(rows.length)return rows;
      console.log('[Dahmermovies] ROUTE: preferred catalogue empty; existing main fallback');
      return run(cloudbankDahmerLegacy,deadline,args);
    });
  };
  return provider;
}
module.exports = cloudbankDahmerInstall(fetch);

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
module.exports = cloudbankDisplayInstall(module.exports, "Dahmermovies", "dahmermovies");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */

if (typeof globalThis !== "undefined" && module.exports.onSettings) globalThis.onSettings = module.exports.onSettings;
if (typeof global !== "undefined" && module.exports.onSettings) global.onSettings = module.exports.onSettings;
if (typeof self !== "undefined" && module.exports.onSettings) self.onSettings = module.exports.onSettings;
