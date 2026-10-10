// Imported provider: showbox; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x3cd342=_0x5e70;(function(_0x5bde39,_0x597b92){const _0x2a2d73={_0x5dff50:0x1f0,_0x468eb5:0x1f5,_0x24b78e:0x21e,_0x88db5e:0x244,_0x3cb3b3:0x20e,_0x1a0bf5:0x1de},_0x390e29=_0x5e70,_0x35abec=_0x5bde39();while(!![]){try{const _0x47cb6f=parseInt(_0x390e29(_0x2a2d73._0x5dff50))/0x1*(-parseInt(_0x390e29(0x23f))/0x2)+-parseInt(_0x390e29(_0x2a2d73._0x468eb5))/0x3+-parseInt(_0x390e29(0x1a7))/0x4*(parseInt(_0x390e29(0x22b))/0x5)+-parseInt(_0x390e29(0x249))/0x6*(-parseInt(_0x390e29(_0x2a2d73._0x24b78e))/0x7)+parseInt(_0x390e29(_0x2a2d73._0x88db5e))/0x8+parseInt(_0x390e29(_0x2a2d73._0x3cb3b3))/0x9*(parseInt(_0x390e29(0x1a9))/0xa)+parseInt(_0x390e29(_0x2a2d73._0x1a0bf5))/0xb;if(_0x47cb6f===_0x597b92)break;else _0x35abec['push'](_0x35abec['shift']());}catch(_0x37d0ea){_0x35abec['push'](_0x35abec['shift']());}}}(_0x5eb0,0xaf6cc));var __async=(_0x1e07e2,_0x2cc067,_0x1be933)=>{const _0x15d55a={_0x1460ff:0x1c3};return new Promise((_0x2e56f2,_0x7c1fa0)=>{const _0x550975=_0x5e70;var _0x2c1987=_0x55af57=>{const _0x3bf95d=_0x5e70;try{_0x51e2ae(_0x1be933[_0x3bf95d(0x21a)](_0x55af57));}catch(_0x198de1){_0x7c1fa0(_0x198de1);}},_0x440915=_0x581606=>{const _0x45671c=_0x5e70;try{_0x51e2ae(_0x1be933[_0x45671c(0x1d6)](_0x581606));}catch(_0x16b483){_0x7c1fa0(_0x16b483);}},_0x51e2ae=_0x46bc26=>_0x46bc26['done']?_0x2e56f2(_0x46bc26[_0x550975(0x225)]):Promise[_0x550975(0x1ae)](_0x46bc26['value'])['then'](_0x2c1987,_0x440915);_0x51e2ae((_0x1be933=_0x1be933[_0x550975(_0x15d55a._0x1460ff)](_0x1e07e2,_0x2cc067))[_0x550975(0x21a)]());});},cheerio=require('cheerio-without-node-native'),CryptoJS=require('crypto-js'),TMDB_API_KEY='439c478a771f35c05022f9feabcca01c',TMDB_BASE_URL='https://api.themoviedb.org/3',DEFAULT_API_BASE=_0x3cd342(0x1c0),WORKING_HEADERS={'User-Agent':_0x3cd342(0x1d2),'Accept':_0x3cd342(0x1fb),'Accept-Language':_0x3cd342(0x1c5),'Content-Type':'application/json'};function getQualityEmoji(_0x2e4b3c){const _0x1525cd={_0x1350d2:0x1bb,_0x98c864:0x1bf},_0x55b5fa=_0x3cd342;switch(_0x2e4b3c){case _0x55b5fa(0x22c):return'✨';case'4K':return'🌟';case _0x55b5fa(0x1f7):return'⚡';case _0x55b5fa(0x1cf):return'🔥';case _0x55b5fa(_0x1525cd._0x1350d2):return'💎';case'480p':return _0x55b5fa(_0x1525cd._0x98c864);default:return'📼';}}function _0x5eb0(){const _0x417976=['qumZiduUmq','ttjuuW','8j+oPYbevfm','zMLSDgvY','sevwqW','BgLUA3m','kI8Q','yxr0CG','ANnVBG','Dgv4Da','mZyWCa','vw5RBM93BG','AM9PBG','ihWG8j+nQIbdB29RAwuGiW','ndCYmJuZv1vmvere','sers','vhjPCgXLrevt','l29ZCZ0','sc4YnJu','mJa2nZy3oeLHueDSvG','lK1qna','mtq0mha','8j+oRca','Bg9N','Dg9vChbLCKnHC2u','yxbWBgLJyxrPB24VANnVBG','Dg9tDhjPBMC','lNnPEMu','CMvSzwfZzv9KyxrL','8j+mKcbxruiTuMLW','zgL2lMzPBgvFCxvHBgL0Eq','rKHe','ksb8ifm','EwvHCG','DwK9Dg9Rzw4Xlcb1At10B2TLBJi','ic0Tlq','DMvYC2LVBNm','DwK9','cI0TlsbqCM9JzxnZAw5NienVB2TPzsa','ndGWua','C3rHDhvZ','mtiZzdzJzwrMnJi2zhK1ndiZm2fHmxC2','w1nOB3DcB3HDiezHAwXLzcb0BYbKzwnYExb0igjHC2u2ncb1AvrVA2vUoG','8j+tUIbirfrw','mJi1rg9hv0ni','sfruuca','qMfZzty0','CgfYC2u','8j+mIcbevG','u2HVD0jVEcbdB25MAwD1CMf0Aw9U','AxnbCNjHEq','C3bSAxq','l3r2lW','8j+oNU+4JYbbvJe','sersmtaR','w1nOB3DcB3HDifnJCMfWzxiGzxHLy3v0Aw9UigzHAwX1CMu6ia','BMv4Da','DxjS','Aw5JBhvKzxm','t3b0Aw9UywWGt1ntigDYB3vWihbHCMfTzxrLCI4','mJi0mJHxDwnmwKq','u0rs','reqRnY4X','ihWGq29VA2LLia','4PYOieHeuG','C2vHC29Uia','zMLSzv9ZAxPL','DMfSDwu','zw5J','wdi2na','re9mqLKGvKLtsu9o','rerqnY4X','8j+oPYberca1lJe','mtbRCfHHueu','t3jPz2LUywW','BgvUz3rO','C2HHCMvmAw5R','sdi2nq','sersmta','rMvIqM94ie9tuYbhCM91CcaOt3b0Aw9UywWP','seruvG','8j+nVYa','DgHLBG','mJe2mfa','8j+tPIbns1y','yxbPqMfZzq','AhrTBa','u2HVD0jVEcb8ia','Cg9W','8j+tUIbtrfi','Dg9gAxHLza','Bw92Awu','AgvHzgvY','ng9pvfjquG','Bwf0y2G','w1nOB3DcB3HDiejHC2u2ncbkv1qVsLnptIb0B2TLBIbKzxrLy3rLzc4Gqxr0zw1WDgLUzYbHDxrVBwf0AwmGzgvJCNLWDgLVBI4UlG','8j+oNU+4JYbirvzd','ic0Gka','mZG3mtm4neniAwrsuq','BNvTyMvY','y29Kzq','lLrt','zxHWB3j0CW','otu0uefnv0vK','Ahr0Chm6lY93D3CUzMvIyM94lMnVBs8','Dw5KzwzPBMvK','8j+tPIbuuW','BwLK','zwfJAa','DhjPBq','mtqWmtKZnNrss1fHDW','Dg9mB3DLCKnHC2u','ndu5mdKWy3bdBxPH','8j+tPIbnudq','zM9YrwfJAa','BMfTzq','mta4mfa','CMvZB2X2zq','zMLUza','v0vcreW','rMvIqM94ifvjifrVA2vUCYaOu2vWyxjHDgvKigj5ignVBw1HCYK','zMLK','w1nOB3DcB3HDie5VifvjihrVA2vUicHJB29RAwuPigzVDw5KigLUihnLDhrPBMDZlG','zgvJCNLWDa','u0nsqvbfuL9trvrusu5huW','jM1Pzd0','rerqns4X','ieDc','B3nZr3jVDxa','ihWG8j+sVIa','nZiWCa','zMLSzv9Uyw1L','jNbHCMvUDf9Pzd0','q0fn','8j+xNo+4JW','Ahr0Chm6lY9Pzc1TyxbWAw5NlwfWAs1ZAg93yM94lxbYB3H5lMHMlNnWywnLl2fWAs9TzwrPyq','zMLSzv9SAxn0','v0vcuKLq','yxbWBhK','DgL0Bgu','zw4TvvmSzw47Ct0WlJK','CgfKu3rHCNq','BwvZC2fNzq','vxrMoa','DwLuB2TLBG','8j+uIIbbDg1VCW','8j+oNU+4JYbilJi2ncb8ipcFK7OGu0rsihWG8j+oPYbtDgvYzw8','ugTJCZC','zxjYB3i','p2nVB2TPzt0','mta4mha','C3rHCNrZv2L0Aa','rfrt','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmc4WlJaUmcbtywzHCMKVntm3lJm2','C2HHCMvFBgLUAW','8j+tPsbxruiTreW','Ahr0Chm6lY93D3CUzMvIyM94lMnVBs9TyNaVDg9FC2HHCMvFCgfNzt9IB3HFDhLWzt0','DgHYB3C','C3rYAw5N','zgf0yq','t1jh','DwLK','ndGWCa','zw5JCNLWDf9KyxrH','tva0','mtaWmZm3mtziBMDHCeu','4PYOieHeuJeWkW','qvzj','C291CMnL'];_0x5eb0=function(){return _0x417976;};return _0x5eb0();}function getSubheadingQualityLabel(_0xc5b276,_0x4a266c){const _0x2d477c=_0x3cd342;if(_0xc5b276===_0x2d477c(0x22c)&&_0x4a266c){const _0x22e515=_0x4a266c['match'](/(\d{3,4})[pP]/);if(_0x22e515)return'✨\x20'+_0x22e515[0x1]+'p';return'✨\x20Original';}const _0x84cace=getQualityEmoji(_0xc5b276);return _0x84cace+'\x20'+_0xc5b276;}function getFileContainerFormat(_0x4e9021){const _0x4bb180={_0x18e360:0x236,_0x152c87:0x1e0,_0x491a15:0x21c,_0x4b4322:0x1e3},_0x2519a4=_0x3cd342;if(!_0x4e9021)return _0x2519a4(_0x4bb180._0x18e360);const _0x1e0105=_0x4e9021['toUpperCase']();if(_0x1e0105['includes'](_0x2519a4(0x1f6))||_0x1e0105[_0x2519a4(0x21c)](_0x2519a4(0x1dd)))return _0x2519a4(0x1aa);if(_0x1e0105['includes']('.AVI')||_0x1e0105[_0x2519a4(0x21c)](_0x2519a4(_0x4bb180._0x152c87)))return'📦\x20AVI';if(_0x1e0105[_0x2519a4(_0x4bb180._0x491a15)](_0x2519a4(0x247))||_0x1e0105['includes'](_0x2519a4(_0x4bb180._0x4b4322)))return _0x2519a4(0x24c);return _0x2519a4(0x236);}function _0x5e70(_0x24c6a8,_0x181650){_0x24c6a8=_0x24c6a8-0x1a4;const _0x5eb021=_0x5eb0();let _0x5e7047=_0x5eb021[_0x24c6a8];if(_0x5e70['nQUzsb']===undefined){var _0x1f84a3=function(_0x5c62de){const _0x58ce67='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x1e07e2='',_0x2cc067='';for(let _0x1be933=0x0,_0x2e56f2,_0x7c1fa0,_0x2c1987=0x0;_0x7c1fa0=_0x5c62de['charAt'](_0x2c1987++);~_0x7c1fa0&&(_0x2e56f2=_0x1be933%0x4?_0x2e56f2*0x40+_0x7c1fa0:_0x7c1fa0,_0x1be933++%0x4)?_0x1e07e2+=String['fromCharCode'](0xff&_0x2e56f2>>(-0x2*_0x1be933&0x6)):0x0){_0x7c1fa0=_0x58ce67['indexOf'](_0x7c1fa0);}for(let _0x440915=0x0,_0x51e2ae=_0x1e07e2['length'];_0x440915<_0x51e2ae;_0x440915++){_0x2cc067+='%'+('00'+_0x1e07e2['charCodeAt'](_0x440915)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x2cc067);};_0x5e70['AzfVPx']=_0x1f84a3,_0x5e70['HKRVTU']={},_0x5e70['nQUzsb']=!![];}const _0x4a6191=_0x5eb021[0x0],_0x1dade2=_0x24c6a8+_0x4a6191,_0xc34f21=_0x5e70['HKRVTU'][_0x1dade2];return!_0xc34f21?(_0x5e7047=_0x5e70['AzfVPx'](_0x5e7047),_0x5e70['HKRVTU'][_0x1dade2]=_0x5e7047):_0x5e7047=_0xc34f21,_0x5e7047;}function parseFilenameMetadata(_0x169c64){const _0x458491={_0x5c8185:0x1fa,_0x236d40:0x21c,_0x3c5c49:0x242,_0x359e1c:0x217,_0x4fec7c:0x21c,_0xce37e4:0x1f1,_0x2931df:0x21f,_0x3e0742:0x1ca,_0xc05a9c:0x1b7,_0x2dfda1:0x21c,_0x18a7fb:0x229,_0x4543be:0x21c,_0x467dba:0x1d1,_0x506020:0x1e4,_0x3860de:0x1cb,_0x58c1ec:0x21c,_0x5d5a7a:0x21c,_0x4cd3f5:0x1c2,_0x28a59b:0x232,_0x2466bc:0x1b0},_0x54f20c=_0x3cd342;if(!_0x169c64)return{'line3':'🎞️\x20H.264\x20|\x20📺\x20SDR\x20|\x20🎧\x20Stereo','source':_0x54f20c(0x1d4)};const _0x2fa54d=_0x169c64[_0x54f20c(_0x458491._0x5c8185)]();let _0xc8ef74='';if(_0x2fa54d['includes'](_0x54f20c(0x1e6))||_0x2fa54d[_0x54f20c(_0x458491._0x236d40)](_0x54f20c(0x22f))||_0x2fa54d[_0x54f20c(0x21c)](_0x54f20c(0x1f4))||_0x2fa54d[_0x54f20c(0x21c)]('X265'))_0xc8ef74=_0x54f20c(_0x458491._0x3c5c49);else{if(_0x2fa54d[_0x54f20c(_0x458491._0x236d40)]('AVC')||_0x2fa54d['includes']('H264')||_0x2fa54d['includes']('H.264')||_0x2fa54d['includes'](_0x54f20c(0x227)))_0xc8ef74='🎞️\x20H.264';else _0x2fa54d[_0x54f20c(_0x458491._0x236d40)]('AV1')&&(_0xc8ef74=_0x54f20c(_0x458491._0x359e1c));}let _0x3a214d='';if(_0x2fa54d['includes']('DV')||_0x2fa54d['includes'](_0x54f20c(0x228))||_0x2fa54d[_0x54f20c(_0x458491._0x4fec7c)]('DOLBYVISION'))_0x3a214d=_0x54f20c(0x212);else{if(_0x2fa54d[_0x54f20c(_0x458491._0x236d40)](_0x54f20c(0x218)))_0x3a214d=_0x54f20c(0x1df);else{if(_0x2fa54d[_0x54f20c(_0x458491._0x236d40)](_0x54f20c(0x230)))_0x3a214d='✨\x20HDR10';else{if(_0x2fa54d['includes'](_0x54f20c(_0x458491._0xce37e4)))_0x3a214d=_0x54f20c(0x222);else _0x2fa54d['includes'](_0x54f20c(_0x458491._0x2931df))&&(_0x3a214d=_0x54f20c(0x23b));}}}let _0x124e61='';if(_0x2fa54d['includes']('ATMOS'))_0x124e61=_0x54f20c(_0x458491._0x3e0742);else{if(_0x2fa54d[_0x54f20c(_0x458491._0x236d40)](_0x54f20c(_0x458491._0xc05a9c))||_0x2fa54d[_0x54f20c(_0x458491._0x236d40)]('DD+5.1')||_0x2fa54d['includes']('EAC3\x205.1'))_0x124e61='🎧\x20DDP\x205.1';else{if(_0x2fa54d[_0x54f20c(_0x458491._0x2dfda1)](_0x54f20c(_0x458491._0x18a7fb))||_0x2fa54d['includes'](_0x54f20c(0x220))||_0x2fa54d[_0x54f20c(_0x458491._0x4fec7c)]('EAC3\x207.1'))_0x124e61='🎧\x20DDP\x207.1';else{if(_0x2fa54d['includes']('DD5.1')||_0x2fa54d['includes'](_0x54f20c(0x1e2))||_0x2fa54d[_0x54f20c(0x21c)]('5.1'))_0x124e61=_0x54f20c(0x22a);else{if(_0x2fa54d[_0x54f20c(_0x458491._0x236d40)]('AAC'))_0x124e61='🎧\x20AAC';else _0x2fa54d[_0x54f20c(_0x458491._0x4543be)](_0x54f20c(_0x458491._0x467dba))&&(_0x124e61=_0x54f20c(_0x458491._0x506020));}}}}const _0x36ab00=[_0xc8ef74,_0x3a214d,_0x124e61]['filter'](Boolean),_0x6a1bec=_0x36ab00['length']>0x0?_0x36ab00[_0x54f20c(0x1ee)]('\x20|\x20'):_0x54f20c(_0x458491._0x3860de);let _0x330116='📥\x20WEB-DL';if(_0x2fa54d['includes']('BLURAY')||_0x2fa54d[_0x54f20c(0x21c)]('BLU-RAY')||_0x2fa54d[_0x54f20c(_0x458491._0x58c1ec)]('BDREMUX'))_0x330116='💿\x20BluRay';else{if(_0x2fa54d[_0x54f20c(_0x458491._0x5d5a7a)](_0x54f20c(_0x458491._0x4cd3f5))||_0x2fa54d[_0x54f20c(0x21c)]('WEB-RIP'))_0x330116=_0x54f20c(0x1ff);else{if(_0x2fa54d['includes']('TELESYNC')||_0x2fa54d['includes']('TS')||_0x2fa54d['includes'](_0x54f20c(0x1be)))_0x330116='📺\x20TELESYNC';else{if(_0x2fa54d[_0x54f20c(0x21c)](_0x54f20c(_0x458491._0x28a59b)))_0x330116=_0x54f20c(0x20d);else(_0x2fa54d[_0x54f20c(_0x458491._0x58c1ec)](_0x54f20c(_0x458491._0x2466bc))||_0x2fa54d['includes']('WEB-DL'))&&(_0x330116=_0x54f20c(0x1d4));}}}return{'line3':_0x6a1bec,'source':_0x330116};}function parseSingleToken(_0x9c54e1){const _0x263893={_0x516a1d:0x1d0,_0x3b89d8:0x1dc,_0x471d03:0x20b,_0x254e3e:0x1c8,_0x1fe913:0x1da,_0x1ad0b2:0x1cd,_0x1555d9:0x20c},_0x422d01=_0x3cd342;if(!_0x9c54e1)return'';if(_0x9c54e1[_0x422d01(_0x263893._0x516a1d)]('eyJ')){console['log'](_0x422d01(0x241));try{const _0xd3e108=CryptoJS['enc'][_0x422d01(0x210)]['parse'](_0x9c54e1),_0x4e7e6c=_0xd3e108['toString'](CryptoJS[_0x422d01(0x226)][_0x422d01(0x1c8)]),_0x3928dd=JSON['parse'](_0x4e7e6c);if(_0x3928dd&&_0x3928dd[_0x422d01(_0x263893._0x3b89d8)]){const _0x541660='wEiphTn!',_0x1e7ff6=_0x422d01(_0x263893._0x471d03),_0x1b80a3=CryptoJS['enc'][_0x422d01(_0x263893._0x254e3e)][_0x422d01(0x211)](_0x1e7ff6),_0x5c6b74=CryptoJS['enc']['Utf8']['parse'](_0x541660),_0x38f31a=CryptoJS[_0x422d01(0x1f2)][_0x422d01(0x1b4)](_0x3928dd[_0x422d01(0x1dc)],_0x1b80a3,{'iv':_0x5c6b74,'mode':CryptoJS['mode']['CBC'],'padding':CryptoJS['pad'][_0x422d01(0x1cc)]}),_0x28a259=_0x38f31a[_0x422d01(0x1fc)](CryptoJS['enc'][_0x422d01(0x1c8)]),_0x6ece35=JSON[_0x422d01(0x211)](_0x28a259);if(_0x6ece35&&_0x6ece35['uid'])return String(_0x6ece35[_0x422d01(_0x263893._0x1fe913)]);}}catch(_0x261626){console[_0x422d01(_0x263893._0x1ad0b2)](_0x422d01(_0x263893._0x1555d9),_0x261626[_0x422d01(0x1c7)]);}}return _0x9c54e1;}function getAllUiTokens(){const _0x1a5ae7={_0x347621:0x1c9,_0x7df1c8:0x1b5},_0x19fae6=_0x3cd342;try{let _0xac82dc='';if(typeof global!=='undefined'&&global['SCRAPER_SETTINGS']&&global['SCRAPER_SETTINGS']['uiToken'])_0xac82dc=String(global[_0x19fae6(0x1b5)][_0x19fae6(_0x1a5ae7._0x347621)])[_0x19fae6(0x1a6)]();else typeof window!=='undefined'&&window[_0x19fae6(0x1b5)]&&window[_0x19fae6(_0x1a5ae7._0x7df1c8)]['uiToken']&&(_0xac82dc=String(window['SCRAPER_SETTINGS'][_0x19fae6(0x1c9)])['trim']());if(!_0xac82dc)return[];return _0xac82dc[_0x19fae6(0x215)](',')['map'](_0x1ade7c=>_0x1ade7c[_0x19fae6(0x1a6)]())['filter'](Boolean);}catch(_0x45b1df){return[];}}function getOssGroup(){const _0x6a560c={_0x46e76f:0x1b5},_0x5d7c83=_0x3cd342;try{if(typeof global!=='undefined'&&global['SCRAPER_SETTINGS']&&global[_0x5d7c83(_0x6a560c._0x46e76f)][_0x5d7c83(0x1b9)])return String(global['SCRAPER_SETTINGS'][_0x5d7c83(0x1b9)]);if(typeof window!=='undefined'&&window['SCRAPER_SETTINGS']&&window['SCRAPER_SETTINGS']['ossGroup'])return String(window[_0x5d7c83(0x1b5)]['ossGroup']);}catch(_0x220982){}return null;}function getApiBase(){const _0x11724d={_0x29fa79:0x1b5,_0x41ddb0:0x237},_0x5741fd=_0x3cd342;try{if(typeof global!==_0x5741fd(0x24b)&&global['SCRAPER_SETTINGS']&&global['SCRAPER_SETTINGS']['apiBase'])return String(global[_0x5741fd(_0x11724d._0x29fa79)][_0x5741fd(0x237)]);if(typeof window!=='undefined'&&window['SCRAPER_SETTINGS']&&window['SCRAPER_SETTINGS'][_0x5741fd(0x237)])return String(window['SCRAPER_SETTINGS'][_0x5741fd(_0x11724d._0x41ddb0)]);}catch(_0x4cea13){}return DEFAULT_API_BASE;}function getQualityFromName(_0x2d088c){const _0x556b7c={_0x4a2127:0x1fa,_0x5192f2:0x1d9,_0x5e5600:0x235,_0x336458:0x1f7,_0x35f7e1:0x1ad,_0x136740:0x201,_0x1de60c:0x1cf,_0x4be47b:0x1ec},_0x184f07=_0x3cd342;if(!_0x2d088c)return'Unknown';const _0x7bee4=_0x2d088c[_0x184f07(_0x556b7c._0x4a2127)]();if(_0x7bee4===_0x184f07(_0x556b7c._0x5192f2)||_0x7bee4==='ORIGINAL')return _0x184f07(0x22c);if(_0x7bee4==='4K'||_0x7bee4===_0x184f07(_0x556b7c._0x5e5600))return'4K';if(_0x7bee4==='1440P'||_0x7bee4==='2K')return _0x184f07(_0x556b7c._0x336458);if(_0x7bee4===_0x184f07(_0x556b7c._0x35f7e1)||_0x7bee4===_0x184f07(_0x556b7c._0x136740))return _0x184f07(_0x556b7c._0x1de60c);if(_0x7bee4==='720P'||_0x7bee4==='HD')return'720p';if(_0x7bee4===_0x184f07(0x209)||_0x7bee4==='SD')return _0x184f07(0x1db);if(_0x7bee4==='360P')return _0x184f07(_0x556b7c._0x4be47b);if(_0x7bee4==='240P')return'240p';const _0x342995=_0x2d088c[_0x184f07(0x240)](/(\d{3,4})[pP]?/);if(_0x342995){const _0x592d82=parseInt(_0x342995[0x1]);if(_0x592d82>=0x870)return'4K';if(_0x592d82>=0x5a0)return'1440p';if(_0x592d82>=0x438)return _0x184f07(_0x556b7c._0x1de60c);if(_0x592d82>=0x2d0)return _0x184f07(0x1bb);if(_0x592d82>=0x1e0)return _0x184f07(0x1db);if(_0x592d82>=0x168)return _0x184f07(0x1ec);return'240p';}return'Unknown';}function formatFileSize(_0x4a4f7b){const _0x4bf322=_0x3cd342;if(!_0x4a4f7b)return'Unknown\x20Size';if(typeof _0x4a4f7b===_0x4bf322(0x1d7)&&(_0x4a4f7b['includes']('GB')||_0x4a4f7b['includes']('MB')||_0x4a4f7b[_0x4bf322(0x21c)]('KB')))return _0x4a4f7b;if(typeof _0x4a4f7b===_0x4bf322(0x245)){const _0x25425b=_0x4a4f7b/(0x400*0x400*0x400);if(_0x25425b>=0x1)return _0x25425b['toFixed'](0x2)+_0x4bf322(0x1b8);const _0x429eca=_0x4a4f7b/(0x400*0x400);return _0x429eca[_0x4bf322(0x23c)](0x2)+'\x20MB';}return _0x4a4f7b;}function getTMDBDetails(_0x438cbb,_0x4b3182){const _0x73df2a={_0x8c3f0a:0x20a,_0x5b7b89:0x1ac,_0x6c8980:0x1c4,_0x366794:0x1c7};return __async(this,null,function*(){const _0x56988e=_0x5e70,_0x49c0f8=_0x4b3182==='tv'?'tv':'movie',_0x1f8121=TMDB_BASE_URL+'/'+_0x49c0f8+'/'+_0x438cbb+'?api_key='+TMDB_API_KEY;try{const _0x19c466=yield fetch(_0x1f8121);if(!_0x19c466['ok'])throw new Error(_0x56988e(0x20f)+_0x19c466[_0x56988e(_0x73df2a._0x8c3f0a)]);const _0x4cf314=yield _0x19c466['json'](),_0x5ba675=_0x4b3182==='tv'?_0x4cf314[_0x56988e(_0x73df2a._0x5b7b89)]:_0x4cf314[_0x56988e(_0x73df2a._0x6c8980)],_0x46efd9=_0x4b3182==='tv'?_0x4cf314['first_air_date']:_0x4cf314[_0x56988e(0x1fe)],_0xf5bf18=_0x46efd9?parseInt(_0x46efd9[_0x56988e(0x215)]('-')[0x0]):null;return{'title':_0x5ba675,'year':_0xf5bf18};}catch(_0x3cb522){return console['log']('[ShowBox]\x20TMDB\x20details\x20query\x20failed:\x20'+_0x3cb522[_0x56988e(_0x73df2a._0x366794)]),{'title':'TMDB\x20ID\x20'+_0x438cbb,'year':null};}});}function extractFebBoxShare(_0x521d70,_0x393e98,_0x56a732,_0x4411af,_0x4a1c83,_0x317524,_0x4e45a6){const _0x405180={_0x2d87e4:0x1b6,_0xce3dcd:0x1d8,_0x5c6614:0x22e,_0x400ec7:0x234,_0xc666e9:0x246,_0x3dd312:0x23d,_0x2098e2:0x1c1,_0x15711a:0x223,_0x3f5810:0x1d8,_0x4f13ac:0x1d8,_0x5221a0:0x1e5,_0x115b4b:0x24a,_0x236022:0x1d0,_0x144393:0x207,_0x24ddbb:0x238,_0x318373:0x200,_0x2d5c05:0x1a5};return __async(this,null,function*(){const _0x270de1={_0x6c0e8c:0x1af,_0x4c2311:0x1fd,_0x17b548:0x224,_0x5df043:0x239,_0x111750:0x1f8,_0x4d5fad:0x243,_0x98f4e5:0x203,_0x25787e:0x1c6},_0x47e7f2=_0x5e70,_0x2823e2=[];try{const _0x214951=_0x393e98==='tv'?0x2:0x1,_0x18780d=_0x47e7f2(0x1d5)+_0x214951+_0x47e7f2(_0x405180._0x2d87e4)+_0x521d70+'&json=1',_0x5f0859=yield fetch(_0x18780d)[_0x47e7f2(0x234)](_0x5679e8=>_0x5679e8[_0x47e7f2(0x1ea)]());if(!_0x5f0859||_0x5f0859[_0x47e7f2(0x246)]!==0x1||!_0x5f0859[_0x47e7f2(_0x405180._0xce3dcd)])return[];const _0x16f024=_0x5f0859['data'][_0x47e7f2(0x1d3)]||_0x5f0859[_0x47e7f2(_0x405180._0xce3dcd)][_0x47e7f2(_0x405180._0x5c6614)];if(!_0x16f024)return[];const _0x3d60d7=_0x16f024[_0x47e7f2(0x215)]('/')[_0x47e7f2(0x23a)](),_0x110653='https://www.febbox.com/file/file_share_list?share_key='+_0x3d60d7,_0xbe1eb1=yield fetch(_0x110653,{'headers':{'Accept-Language':'en'}})[_0x47e7f2(_0x405180._0x400ec7)](_0x37fb83=>_0x37fb83[_0x47e7f2(0x1ea)]());if(!_0xbe1eb1||_0xbe1eb1[_0x47e7f2(_0x405180._0xc666e9)]!==0x1||!_0xbe1eb1['data']||!_0xbe1eb1[_0x47e7f2(_0x405180._0xce3dcd)][_0x47e7f2(0x1c1)])return[];let _0x25468f=[];if(_0x393e98===_0x47e7f2(_0x405180._0x3dd312))_0x25468f=_0xbe1eb1['data'][_0x47e7f2(_0x405180._0x2098e2)];else{const _0x51aab6=_0x47e7f2(_0x405180._0x15711a)+_0x56a732,_0x5d66a0=_0xbe1eb1[_0x47e7f2(_0x405180._0x3f5810)][_0x47e7f2(0x1c1)][_0x47e7f2(0x1af)](_0x1b3fa1=>_0x1b3fa1[_0x47e7f2(0x1bc)]&&_0x1b3fa1[_0x47e7f2(0x1bc)][_0x47e7f2(0x1a8)]()===_0x51aab6);if(!_0x5d66a0)return[];const _0x1964de='https://www.febbox.com/file/file_share_list?share_key='+_0x3d60d7+_0x47e7f2(0x1bd)+_0x5d66a0[_0x47e7f2(0x1b2)]+'&page=1',_0x2209f6=yield fetch(_0x1964de,{'headers':{'Accept-Language':'en'}})['then'](_0x131ab6=>_0x131ab6['json']());if(!_0x2209f6||_0x2209f6['code']!==0x1||!_0x2209f6['data']||!_0x2209f6[_0x47e7f2(0x1d8)]['file_list'])return[];const _0x17fbb4=String(_0x56a732)[_0x47e7f2(0x1c6)](0x2,'0'),_0x24a838=String(_0x4411af)['padStart'](0x2,'0');_0x25468f=_0x2209f6[_0x47e7f2(_0x405180._0x4f13ac)]['file_list'][_0x47e7f2(_0x405180._0x5221a0)](_0x37db69=>_0x37db69['file_name']&&(_0x37db69[_0x47e7f2(0x1bc)]['toLowerCase']()['includes']('s'+_0x17fbb4+'e'+_0x24a838)||_0x37db69['file_name'][_0x47e7f2(0x1a8)]()[_0x47e7f2(0x21c)]('s'+_0x56a732+'e'+_0x4411af)));}const _0x71004e={'Accept':_0x47e7f2(0x1e8),'Accept-Language':'en-US,en;q=0.8','Connection':'keep-alive','Range':'bytes=0-','Referer':_0x47e7f2(_0x405180._0x115b4b),'User-Agent':'Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/120.0.0.0\x20Safari/537.36'},_0x57ee1a=_0x4a1c83[_0x47e7f2(_0x405180._0x236022)](_0x47e7f2(_0x405180._0x144393))?_0x4a1c83:_0x47e7f2(_0x405180._0x144393)+_0x4a1c83;for(const _0x29259e of _0x25468f){const _0xef87aa='https://www.febbox.com/console/video_quality_list?fid='+_0x29259e[_0x47e7f2(0x1b2)]+'&share_key='+_0x3d60d7,_0x5a5936=yield fetch(_0xef87aa,{'headers':{'Cookie':_0x57ee1a}})['then'](_0x380830=>_0x380830[_0x47e7f2(0x1ea)]())['catch'](()=>null);if(!_0x5a5936||!_0x5a5936[_0x47e7f2(_0x405180._0x24ddbb)])continue;const _0x836de1=cheerio['load'](_0x5a5936['html']);_0x836de1(_0x47e7f2(_0x405180._0x318373))[_0x47e7f2(_0x405180._0x2d5c05)]((_0x233c3e,_0x4f2e55)=>{const _0x592cb0=_0x47e7f2,_0x5e71ad=_0x836de1(_0x4f2e55),_0x548b96=_0x5e71ad['attr']('data-url'),_0x187d55=_0x5e71ad[_0x592cb0(0x1e9)]('data-quality'),_0x164e25=_0x5e71ad[_0x592cb0(_0x270de1._0x6c0e8c)](_0x592cb0(_0x270de1._0x4c2311))[_0x592cb0(0x1eb)]()['trim']();if(_0x548b96){const _0x371112=getQualityFromName(_0x187d55),_0x1882b6=getSubheadingQualityLabel(_0x371112,_0x29259e['file_name']||_0x548b96),_0x3ca865=formatFileSize(_0x164e25||_0x29259e[_0x592cb0(_0x270de1._0x17b548)]),_0x1b6e60=getFileContainerFormat(_0x29259e[_0x592cb0(0x1bc)]||_0x548b96),_0x219d04=parseFilenameMetadata(_0x29259e['file_name']||_0x548b96),_0x10f83d=_0x592cb0(_0x270de1._0x5df043)+_0x371112+'\x20|\x20Cookie\x20'+_0x317524,_0x99e4e=_0x393e98==='tv'?_0x592cb0(_0x270de1._0x111750)+(_0x4e45a6['title']||'Unknown')+_0x592cb0(_0x270de1._0x4d5fad)+(_0x4e45a6[_0x592cb0(_0x270de1._0x98f4e5)]||'')+')\x20|\x20S'+String(_0x56a732)['padStart'](0x2,'0')+'\x20E'+String(_0x4411af)[_0x592cb0(_0x270de1._0x25787e)](0x2,'0'):'🍿\x20'+(_0x4e45a6['title']||'Unknown')+'\x20-\x20('+(_0x4e45a6['year']||'')+')',_0x38737d=_0x1882b6+'\x20|\x20💾\x20'+_0x3ca865+'\x20|\x20'+_0x1b6e60,_0x46a170=_0x219d04['line3'],_0x1e40d5=_0x219d04[_0x592cb0(0x1e1)]+_0x592cb0(0x1ef)+_0x317524,_0x1cd513=_0x99e4e+'\x0a'+_0x38737d+'\x0a'+_0x46a170+'\x0a'+_0x1e40d5;_0x2823e2['push']({'name':_0x10f83d,'title':_0x1cd513,'size':_0x1cd513,'description':_0x1cd513,'url':_0x548b96,'quality':'','language':'','headers':_0x71004e});}});}}catch(_0x5a5b82){console['error']('[ShowBox]\x20FebBox\x20share\x20extraction\x20error:\x20'+_0x5a5b82[_0x47e7f2(0x1c7)]);}return _0x2823e2;});}function processShowBoxResponse(_0x4420f9,_0x59b34e,_0xe8c7ce,_0x439155,_0x26d574,_0xd2aed0){const _0x4b44ca={_0x516296:0x206,_0x15f67f:0x1ab},_0x376ef4={_0x56df7f:0x214,_0x5604c1:0x1e7},_0x5b7332=_0x3cd342,_0x5f00bc=[];try{if(!_0x4420f9||!_0x4420f9['success']||!_0x4420f9['versions']||!Array['isArray'](_0x4420f9[_0x5b7332(0x206)]))return _0x5f00bc;_0x4420f9[_0x5b7332(_0x4b44ca._0x516296)][_0x5b7332(_0x4b44ca._0x15f67f)](function(_0x1721b3,_0x3979ff){const _0x1d531b={_0x56703e:0x21b,_0x497054:0x203,_0x49d093:0x202,_0xd41144:0x1c6,_0x56bf18:0x233,_0x46d153:0x1c4,_0x3219b2:0x1ed,_0x37e3cb:0x1ba},_0x19ca08=_0x5b7332,_0x5cb4d0=_0x1721b3['size']||'Unknown';_0x1721b3[_0x19ca08(0x1e7)]&&Array[_0x19ca08(_0x376ef4._0x56df7f)](_0x1721b3['links'])&&_0x1721b3[_0x19ca08(_0x376ef4._0x5604c1)]['forEach'](function(_0x3088fc){const _0x3f355e=_0x19ca08;if(!_0x3088fc['url'])return;const _0x515fce=getQualityFromName(_0x3088fc['quality']||'Unknown'),_0x5d3476=getSubheadingQualityLabel(_0x515fce,_0x3088fc[_0x3f355e(_0x1d531b._0x56703e)]),_0x469b0d=_0x3088fc['size']||_0x5cb4d0,_0x599972=formatFileSize(_0x469b0d),_0x4690d3=getFileContainerFormat(_0x3088fc['url']),_0x4f5954=parseFilenameMetadata(_0x3088fc[_0x3f355e(0x21b)]);let _0x3796e4='ShowBox';_0x4420f9['versions']['length']>0x1&&(_0x3796e4+='\x20V'+(_0x3979ff+0x1));const _0x39bf52=_0x3796e4+'\x20|\x20'+_0x515fce+_0x3f355e(0x221)+_0xd2aed0,_0x2234b6=_0xe8c7ce==='tv'?_0x3f355e(0x1f8)+(_0x59b34e['title']||_0x3f355e(0x1ed))+'\x20-\x20('+(_0x59b34e[_0x3f355e(_0x1d531b._0x497054)]||'')+_0x3f355e(_0x1d531b._0x49d093)+String(_0x439155)[_0x3f355e(_0x1d531b._0xd41144)](0x2,'0')+'\x20E'+String(_0x26d574)['padStart'](0x2,'0'):_0x3f355e(_0x1d531b._0x56bf18)+(_0x59b34e[_0x3f355e(_0x1d531b._0x46d153)]||_0x3f355e(_0x1d531b._0x3219b2))+_0x3f355e(0x243)+(_0x59b34e['year']||'')+')',_0x37d967=_0x5d3476+_0x3f355e(_0x1d531b._0x37e3cb)+_0x599972+'\x20|\x20'+_0x4690d3,_0x42a0f8=_0x4f5954['line3'],_0x7f1f13=_0x4f5954['source']+'\x20|\x20🍪\x20Cookie\x20#'+_0xd2aed0,_0xdd5659=_0x2234b6+'\x0a'+_0x37d967+'\x0a'+_0x42a0f8+'\x0a'+_0x7f1f13;_0x5f00bc['push']({'name':_0x39bf52,'title':_0xdd5659,'size':_0xdd5659,'description':_0xdd5659,'url':_0x3088fc['url'],'quality':'','language':''});});});}catch(_0x3ef880){console['error']('[ShowBox]\x20Error\x20processing\x20response:\x20'+_0x3ef880['message']);}return _0x5f00bc;}function getStreams(_0x1496c7,_0x576afa='movie',_0x428500=null,_0x45539c=null){const _0x467f4a={_0x49ea7:0x1b3,_0x3dde3d:0x208,_0x4d3dc7:0x205,_0x12129f:0x1ce,_0x429b8d:0x216,_0x523edf:0x1d8,_0xbb11a4:0x1a4};return __async(this,null,function*(){const _0x398ee8=_0x5e70;console[_0x398ee8(0x1f9)]('[ShowBox]\x20Fetching\x20streams\x20for\x20TMDB\x20ID:\x20'+_0x1496c7+',\x20Type:\x20'+_0x576afa);const _0x55405b=getAllUiTokens(),_0x548dc0=getOssGroup(),_0x1d9c35=getApiBase();if(_0x55405b[_0x398ee8(0x22d)]===0x0)return console['error'](_0x398ee8(_0x467f4a._0x49ea7)),[];let _0x5c5332=[];try{const _0x3c2f38=yield getTMDBDetails(_0x1496c7,_0x576afa);for(let _0x391943=0x0;_0x391943<_0x55405b[_0x398ee8(0x22d)];_0x391943++){const _0x50dc2d=_0x391943+0x1,_0x32145f=_0x55405b[_0x391943],_0x3b35df=parseSingleToken(_0x32145f);if(!_0x3b35df)continue;console['log'](_0x398ee8(_0x467f4a._0x3dde3d)+_0x50dc2d+_0x398ee8(_0x467f4a._0x4d3dc7));let _0x5ef24b=[],_0x3acb31;_0x576afa==='tv'&&_0x428500&&_0x45539c?_0x548dc0?_0x3acb31=_0x1d9c35+'/tv/'+_0x1496c7+_0x398ee8(0x1f3)+_0x548dc0+'/'+_0x428500+'/'+_0x45539c+_0x398ee8(_0x467f4a._0x12129f)+encodeURIComponent(_0x3b35df):_0x3acb31=_0x1d9c35+_0x398ee8(_0x467f4a._0x429b8d)+_0x1496c7+'/'+_0x428500+'/'+_0x45539c+'?cookie='+encodeURIComponent(_0x3b35df):_0x3acb31=_0x1d9c35+'/movie/'+_0x1496c7+_0x398ee8(0x1ce)+encodeURIComponent(_0x3b35df);let _0x1dc6fc=null;try{const _0x5284e6=yield fetch(_0x3acb31,{'headers':WORKING_HEADERS});if(_0x5284e6['ok']){const _0x2ba20d=yield _0x5284e6[_0x398ee8(0x1ea)]();_0x5ef24b=processShowBoxResponse(_0x2ba20d,_0x3c2f38,_0x576afa,_0x428500,_0x45539c,_0x50dc2d);if(_0x2ba20d['id']||_0x2ba20d['mid'])_0x1dc6fc=_0x2ba20d['id']||_0x2ba20d['mid'];else _0x2ba20d[_0x398ee8(_0x467f4a._0x523edf)]&&(_0x2ba20d[_0x398ee8(_0x467f4a._0x523edf)]['id']||_0x2ba20d['data'][_0x398ee8(_0x467f4a._0xbb11a4)])&&(_0x1dc6fc=_0x2ba20d['data']['id']||_0x2ba20d['data']['mid']);}}catch(_0x371d99){console['log']('[ShowBox]\x20Proxy\x20server\x20lookup\x20failed\x20for\x20Cookie\x20'+_0x50dc2d+':\x20'+_0x371d99['message']);}if(_0x1dc6fc){const _0x5e33cf=yield extractFebBoxShare(_0x1dc6fc,_0x576afa,_0x428500,_0x45539c,_0x3b35df,_0x50dc2d,_0x3c2f38);_0x5e33cf['length']>0x0&&(_0x5ef24b=_0x5ef24b['concat'](_0x5e33cf));}console['log']('[ShowBox]\x20Found\x20'+_0x5ef24b[_0x398ee8(0x22d)]+'\x20links\x20for\x20Cookie\x20'+_0x50dc2d),_0x5c5332=_0x5c5332['concat'](_0x5ef24b);}return _0x5c5332;}catch(_0x13bb69){return console['error'](_0x398ee8(0x219)+_0x13bb69['message']),[];}});}function onSettings(){const _0x59f3a3={_0x48cfd8:0x23e,_0x42505f:0x213};return __async(this,null,function*(){const _0x273770=_0x5e70;return[{'type':_0x273770(_0x59f3a3._0x48cfd8),'label':_0x273770(_0x59f3a3._0x42505f)},{'type':_0x273770(0x1eb),'isPassword':!![],'key':_0x273770(0x1c9),'label':_0x273770(0x1b1),'placeholder':_0x273770(0x204),'description':'Add\x20multiple\x20tokens\x20separated\x20by\x20commas.\x20Links\x20will\x20display\x20grouped\x20by\x20cookie\x20indicator.'},{'type':_0x273770(0x1eb),'key':'ossGroup','label':_0x273770(0x231),'placeholder':'','description':_0x273770(0x21d)}];});}module[_0x3cd342(0x248)]={'getStreams':getStreams,'onSettings':onSettings};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "showbox", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "ShowBox", "showbox");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
