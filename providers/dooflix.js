// Imported provider: dooflix; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
var _0x11dac7=_0xe5ff;(function(_0x14c3f7,_0x383793){var _0x2c5f87=_0xe5ff,_0x135d1b=_0x14c3f7();while(!![]){try{var _0x1640ee=-parseInt(_0x2c5f87(0x117))/0x1+parseInt(_0x2c5f87(0x11c))/0x2*(parseInt(_0x2c5f87(0x118))/0x3)+-parseInt(_0x2c5f87(0x11b))/0x4+-parseInt(_0x2c5f87(0x138))/0x5+parseInt(_0x2c5f87(0x12c))/0x6*(-parseInt(_0x2c5f87(0x121))/0x7)+parseInt(_0x2c5f87(0x136))/0x8*(parseInt(_0x2c5f87(0x112))/0x9)+parseInt(_0x2c5f87(0x131))/0xa;if(_0x1640ee===_0x383793)break;else _0x135d1b['push'](_0x135d1b['shift']());}catch(_0x11476e){_0x135d1b['push'](_0x135d1b['shift']());}}}(_0x356d,0x9f541));function _0x356d(){var _0x594af4=['ChjVDg90ExbL','rg9VrMXPEcaTia','B2jQzwn0','BMv4Da','CMvZB2X2zq','zxjYB3i','nJC4qM1lwNbX','vxnLCI1bz2vUDa','z2v0t3DUuhjVCgvYDhLoyw1LCW','DgHLBG','Bw92Awu','mJC5mJG2odb1y2DvzLG','w0rVB0zSAxHDievYCM9YoIa','mZa1','x19LC01VzhvSzq','zg9VzMXPEa','mtm2ChHpu1Pu','BgLUA3m','nJuYntG5nwLpCNLWtq','DxjS','w0rVB0zSAxHDie1PC3nPBMCGC2vHC29Uig9YigvWAxnVzguGzM9YifrwihnOB3C','Ahr0Chm6lY9TB2XVCc5HCNqV','l2fWAs8Zl3r2lW','z2v0','DMfSDwu','l2XPBMTZp2fWAv9RzxK9','DgHYB3C','qxv0BW','w0rVB0zSAxHDievYCM9YigzLDgnOAw5NihjLzgLYzwn0igzVCIa','zg9Uzq','BwvZC2fNzq','ChvZAa','Cu5Os0XkAvPwEw9lzgK5tKnrr3O4q0LhCNbvAwP1AKu','mteZnJDpqvjsAK0','lcbuExbLoIa','y2fSBa','zNvUy3rPB24','AgfZt3DUuhjVCgvYDhK','nti4ndHewxbSEKW','mtqXmtmXnhn4rLDJCa','l3nLyxnVBI8','BwfUDwfS','mZiWmJy4nhHYB2vRvq','mMrjEKrJAa','ANnVBG','zw51BwvYywjSzq','Bg9JyxrPB24','Ag9ZDa','mJKZmZbfA0LkBMC','w0rVB0zSAxHDiezLDgnOAw5Nihn0CMvHBxmGzM9YifrnreiGsuq6ia','z2v0t3DUuhjVCgvYDhLezxnJCMLWDg9Y','l2vWAxnVzguV','Ahr0Chm6lY9Wyw5LBc53yxrJAgTHCM9HyMHPlMnVBq'];_0x356d=function(){return _0x594af4;};return _0x356d();}var __defProp=Object['defineProperty'],__getOwnPropDesc=Object[_0x11dac7(0x123)],__getOwnPropNames=Object[_0x11dac7(0x12e)],__hasOwnProp=Object[_0x11dac7(0x126)][_0x11dac7(0x116)],__export=(_0x30dfd2,_0x2defd7)=>{for(var _0x2a744a in _0x2defd7)__defProp(_0x30dfd2,_0x2a744a,{'get':_0x2defd7[_0x2a744a],'enumerable':!![]});},__copyProps=(_0x599d71,_0x355933,_0x5f08bd,_0x364e9b)=>{var _0x3c3b88=_0x11dac7;if(_0x355933&&typeof _0x355933===_0x3c3b88(0x128)||typeof _0x355933===_0x3c3b88(0x115)){for(let _0x146172 of __getOwnPropNames(_0x355933))if(!__hasOwnProp[_0x3c3b88(0x114)](_0x599d71,_0x146172)&&_0x146172!==_0x5f08bd)__defProp(_0x599d71,_0x146172,{'get':()=>_0x355933[_0x146172],'enumerable':!(_0x364e9b=__getOwnPropDesc(_0x355933,_0x146172))||_0x364e9b[_0x3c3b88(0x11e)]});}return _0x599d71;},__toCommonJS=_0x4ea6ad=>__copyProps(__defProp({},_0x11dac7(0x134),{'value':!![]}),_0x4ea6ad),__async=(_0x556b42,_0x2554fa,_0x3f930d)=>{return new Promise((_0x3e1d23,_0x194ff4)=>{var _0x34241e=_0xe5ff,_0x48cf60=_0x1c05c4=>{var _0x1c91a5=_0xe5ff;try{_0x525665(_0x3f930d[_0x1c91a5(0x129)](_0x1c05c4));}catch(_0x84a9da){_0x194ff4(_0x84a9da);}},_0x2fff47=_0x3b61bb=>{var _0x40d00b=_0xe5ff;try{_0x525665(_0x3f930d[_0x40d00b(0x10b)](_0x3b61bb));}catch(_0x365145){_0x194ff4(_0x365145);}},_0x525665=_0x21972c=>_0x21972c[_0x34241e(0x10e)]?_0x3e1d23(_0x21972c[_0x34241e(0x109)]):Promise[_0x34241e(0x12a)](_0x21972c[_0x34241e(0x109)])[_0x34241e(0x12f)](_0x48cf60,_0x2fff47);_0x525665((_0x3f930d=_0x3f930d['apply'](_0x556b42,_0x2554fa))[_0x34241e(0x129)]());});},dooflix_exports={};function _0xe5ff(_0x584065,_0x7de4fe){_0x584065=_0x584065-0x108;var _0x356dd0=_0x356d();var _0xe5ff14=_0x356dd0[_0x584065];if(_0xe5ff['IGPOdl']===undefined){var _0x1b41fe=function(_0x278343){var _0x2051fd='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';var _0x30dfd2='',_0x2defd7='';for(var _0x2a744a=0x0,_0x599d71,_0x355933,_0x5f08bd=0x0;_0x355933=_0x278343['charAt'](_0x5f08bd++);~_0x355933&&(_0x599d71=_0x2a744a%0x4?_0x599d71*0x40+_0x355933:_0x355933,_0x2a744a++%0x4)?_0x30dfd2+=String['fromCharCode'](0xff&_0x599d71>>(-0x2*_0x2a744a&0x6)):0x0){_0x355933=_0x2051fd['indexOf'](_0x355933);}for(var _0x364e9b=0x0,_0x146172=_0x30dfd2['length'];_0x364e9b<_0x146172;_0x364e9b++){_0x2defd7+='%'+('00'+_0x30dfd2['charCodeAt'](_0x364e9b)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x2defd7);};_0xe5ff['BmusHh']=_0x1b41fe,_0xe5ff['jzeCTb']={},_0xe5ff['IGPOdl']=!![];}var _0x3c042a=_0x356dd0[0x0],_0x29c881=_0x584065+_0x3c042a,_0x40dc28=_0xe5ff['jzeCTb'][_0x29c881];return!_0x40dc28?(_0xe5ff14=_0xe5ff['BmusHh'](_0xe5ff14),_0xe5ff['jzeCTb'][_0x29c881]=_0xe5ff14):_0xe5ff14=_0x40dc28,_0xe5ff14;}__export(dooflix_exports,{'getStreams':()=>getStreams}),module['exports']=__toCommonJS(dooflix_exports);var BASE_API=_0x11dac7(0x125),API_KEY=_0x11dac7(0x111),HEADERS={'X-Package-Name':'com.king.moja','User-Agent':_0x11dac7(0x135),'X-App-Version':_0x11dac7(0x133)},STREAM_REFERER=_0x11dac7(0x13b);function getStreams(_0x421279,_0x588383=_0x11dac7(0x130),_0x4d7743=null,_0xc410b3=null){return __async(this,null,function*(){var _0x51ce3d=_0xe5ff;console['log'](_0x51ce3d(0x122)+_0x421279+_0x51ce3d(0x113)+_0x588383);try{let _0x1f301c;if(_0x588383===_0x51ce3d(0x130))_0x1f301c=BASE_API+'/api/3/movie/'+_0x421279+_0x51ce3d(0x10a)+API_KEY;else{if(!_0x4d7743||!_0xc410b3)return console[_0x51ce3d(0x12b)](_0x51ce3d(0x13a)),[];_0x1f301c=BASE_API+_0x51ce3d(0x13c)+_0x421279+_0x51ce3d(0x119)+_0x4d7743+_0x51ce3d(0x124)+_0xc410b3+_0x51ce3d(0x10a)+API_KEY;}const _0x267192=yield fetch(_0x1f301c,{'headers':HEADERS});if(!_0x267192['ok'])return console['log']('[DooFlix]\x20API\x20error:\x20'+_0x267192['status']),[];const _0x50eb08=yield _0x267192[_0x51ce3d(0x11d)](),_0x58477c=_0x50eb08[_0x51ce3d(0x137)]||[],_0x5d71cc=[];for(const _0x5c8478 of _0x58477c){try{const _0x556f38=yield fetch(_0x5c8478[_0x51ce3d(0x139)],{'method':'GET','headers':{'Referer':STREAM_REFERER,'User-Agent':HEADERS[_0x51ce3d(0x12d)]},'redirect':_0x51ce3d(0x11a)});let _0xfa14f7=_0x556f38['headers'][_0x51ce3d(0x108)](_0x51ce3d(0x11f))||_0x556f38[_0x51ce3d(0x139)];_0xfa14f7&&_0xfa14f7!==_0x5c8478[_0x51ce3d(0x139)]&&_0x5d71cc[_0x51ce3d(0x110)]({'name':'DooFlix','title':_0x51ce3d(0x127)+(_0x5c8478[_0x51ce3d(0x120)]||'Server'),'url':_0xfa14f7,'quality':_0x51ce3d(0x10c),'headers':{'Referer':STREAM_REFERER,'User-Agent':HEADERS[_0x51ce3d(0x12d)]},'provider':_0x51ce3d(0x135)});}catch(_0x4d1b70){console['log'](_0x51ce3d(0x10d)+_0x5c8478[_0x51ce3d(0x139)]+':\x20'+_0x4d1b70['message']);}}return _0x5d71cc;}catch(_0x2be428){return console[_0x51ce3d(0x12b)](_0x51ce3d(0x132)+_0x2be428[_0x51ce3d(0x10f)]),[];}});}
/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "dooflix", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
