// Imported provider: castle; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
'use strict';const _0x476166=_0x44e1;(function(_0x67a31b,_0x2c404f){const _0x36a05f=_0x44e1,_0x470649=_0x67a31b();while(!![]){try{const _0x5137c2=-parseInt(_0x36a05f(0x1ec))/0x1+parseInt(_0x36a05f(0x214))/0x2+parseInt(_0x36a05f(0x228))/0x3+-parseInt(_0x36a05f(0x20a))/0x4+parseInt(_0x36a05f(0x1f1))/0x5*(-parseInt(_0x36a05f(0x1f4))/0x6)+parseInt(_0x36a05f(0x254))/0x7*(parseInt(_0x36a05f(0x211))/0x8)+parseInt(_0x36a05f(0x269))/0x9;if(_0x5137c2===_0x2c404f)break;else _0x470649['push'](_0x470649['shift']());}catch(_0xc250f2){_0x470649['push'](_0x470649['shift']());}}}(_0x576f,0x6b5c1));function _0x44e1(_0x5972df,_0x46299a){_0x5972df=_0x5972df-0x1e0;const _0x576fb9=_0x576f();let _0x44e170=_0x576fb9[_0x5972df];if(_0x44e1['WPBLul']===undefined){var _0x3b63c2=function(_0x5c6f09){const _0x445c29='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x1bd8fe='',_0x43a10c='';for(let _0x256223=0x0,_0x82eee6,_0x25a6e1,_0xf7c831=0x0;_0x25a6e1=_0x5c6f09['charAt'](_0xf7c831++);~_0x25a6e1&&(_0x82eee6=_0x256223%0x4?_0x82eee6*0x40+_0x25a6e1:_0x25a6e1,_0x256223++%0x4)?_0x1bd8fe+=String['fromCharCode'](0xff&_0x82eee6>>(-0x2*_0x256223&0x6)):0x0){_0x25a6e1=_0x445c29['indexOf'](_0x25a6e1);}for(let _0x56dc30=0x0,_0x4ed561=_0x1bd8fe['length'];_0x56dc30<_0x4ed561;_0x56dc30++){_0x43a10c+='%'+('00'+_0x1bd8fe['charCodeAt'](_0x56dc30)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x43a10c);};_0x44e1['OchpKJ']=_0x3b63c2,_0x44e1['yHtRii']={},_0x44e1['WPBLul']=!![];}const _0x1e8776=_0x576fb9[0x0],_0x555aab=_0x5972df+_0x1e8776,_0x17a6f3=_0x44e1['yHtRii'][_0x555aab];return!_0x17a6f3?(_0x44e170=_0x44e1['OchpKJ'](_0x44e170),_0x44e1['yHtRii'][_0x555aab]=_0x44e170):_0x44e170=_0x17a6f3,_0x44e170;}var __defProp=Object['defineProperty'],__getOwnPropSymbols=Object['getOwnPropertySymbols'],__hasOwnProp=Object['prototype'][_0x476166(0x201)],__propIsEnum=Object[_0x476166(0x1e0)][_0x476166(0x224)],__defNormalProp=(_0x1bd8fe,_0x43a10c,_0x256223)=>_0x43a10c in _0x1bd8fe?__defProp(_0x1bd8fe,_0x43a10c,{'enumerable':!![],'configurable':!![],'writable':!![],'value':_0x256223}):_0x1bd8fe[_0x43a10c]=_0x256223,__spreadValues=(_0x82eee6,_0x25a6e1)=>{const _0x57b9b7=_0x476166;for(var _0xf7c831 in _0x25a6e1||(_0x25a6e1={}))if(__hasOwnProp['call'](_0x25a6e1,_0xf7c831))__defNormalProp(_0x82eee6,_0xf7c831,_0x25a6e1[_0xf7c831]);if(__getOwnPropSymbols)for(var _0xf7c831 of __getOwnPropSymbols(_0x25a6e1)){if(__propIsEnum[_0x57b9b7(0x1fb)](_0x25a6e1,_0xf7c831))__defNormalProp(_0x82eee6,_0xf7c831,_0x25a6e1[_0xf7c831]);}return _0x82eee6;},__async=(_0x56dc30,_0x4ed561,_0x267797)=>{return new Promise((_0x170526,_0x13dda8)=>{const _0x2a7b44=_0x44e1;var _0x5e18b1=_0x51d46c=>{const _0x3e6ab5=_0x44e1;try{_0x4b0257(_0x267797[_0x3e6ab5(0x250)](_0x51d46c));}catch(_0x478a26){_0x13dda8(_0x478a26);}},_0x5c517a=_0x4da371=>{const _0xddfc2a=_0x44e1;try{_0x4b0257(_0x267797[_0xddfc2a(0x20e)](_0x4da371));}catch(_0x2893a0){_0x13dda8(_0x2893a0);}},_0x4b0257=_0x29e7e7=>_0x29e7e7['done']?_0x170526(_0x29e7e7[_0x2a7b44(0x252)]):Promise[_0x2a7b44(0x21c)](_0x29e7e7['value'])[_0x2a7b44(0x25c)](_0x5e18b1,_0x5c517a);_0x4b0257((_0x267797=_0x267797[_0x2a7b44(0x25a)](_0x56dc30,_0x4ed561))[_0x2a7b44(0x250)]());});},TMDB_API_KEY='439c478a771f35c05022f9feabcca01c',TMDB_BASE_URL=_0x476166(0x27a),CASTLE_BASE='https://api.hlowb.com',PKG=_0x476166(0x233),CHANNEL=_0x476166(0x21f),CLIENT='1',LANG='en-US',API_HEADERS={'User-Agent':_0x476166(0x1ef),'Accept':_0x476166(0x212),'Accept-Language':_0x476166(0x236),'Connection':_0x476166(0x24e),'Referer':CASTLE_BASE},PLAYBACK_HEADERS={'User-Agent':'Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/137.0.0.0\x20Safari/537.36','Accept':'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5','Accept-Language':_0x476166(0x236),'Accept-Encoding':_0x476166(0x1ed),'Connection':_0x476166(0x273),'Sec-Fetch-Dest':'video','Sec-Fetch-Mode':_0x476166(0x22a),'Sec-Fetch-Site':_0x476166(0x268),'DNT':'1'};function makeRequest(_0x1b363e){return __async(this,arguments,function*(_0x3d5cba,_0x27b3ee={}){const _0x455f3a=_0x44e1;try{const _0x1c6c59=yield fetch(_0x3d5cba,{'method':_0x27b3ee[_0x455f3a(0x266)]||_0x455f3a(0x275),'headers':__spreadValues(__spreadValues({},API_HEADERS),_0x27b3ee['headers']),'body':_0x27b3ee['body']});if(!_0x1c6c59['ok'])throw new Error(_0x455f3a(0x279)+_0x1c6c59[_0x455f3a(0x20d)]+':\x20'+_0x1c6c59[_0x455f3a(0x230)]);return _0x1c6c59;}catch(_0x1cd416){console[_0x455f3a(0x1f0)](_0x455f3a(0x22c)+_0x3d5cba+':\x20'+_0x1cd416[_0x455f3a(0x213)]);throw _0x1cd416;}});}function extractCipherFromResponse(_0x409352){return __async(this,null,function*(){const _0x3ad6ed=_0x44e1,_0x3f740d=yield _0x409352[_0x3ad6ed(0x259)](),_0x4fa311=_0x3f740d[_0x3ad6ed(0x26a)]();if(!_0x4fa311)throw new Error(_0x3ad6ed(0x271));try{const _0x2dc537=JSON[_0x3ad6ed(0x1f2)](_0x4fa311);if(_0x2dc537&&_0x2dc537[_0x3ad6ed(0x24b)]&&typeof _0x2dc537['data']==='string')return _0x2dc537[_0x3ad6ed(0x24b)][_0x3ad6ed(0x26a)]();}catch(_0x49255b){}return _0x4fa311;});}function extractDataBlock(_0x5c1776){const _0x20a912=_0x476166;if(_0x5c1776&&_0x5c1776[_0x20a912(0x24b)]&&typeof _0x5c1776['data']===_0x20a912(0x1ee))return _0x5c1776[_0x20a912(0x24b)];return _0x5c1776||{};}function getTMDBDetails(_0x45bec2,_0xd6d16b){return __async(this,null,function*(){const _0x44aa1b=_0x44e1,_0x1fa830=_0xd6d16b==='tv'?'tv':_0x44aa1b(0x1e5),_0x4e7160=TMDB_BASE_URL+'/'+_0x1fa830+'/'+_0x45bec2+_0x44aa1b(0x202)+TMDB_API_KEY+_0x44aa1b(0x226),_0x220bdb=yield makeRequest(_0x4e7160),_0x2565cd=yield _0x220bdb[_0x44aa1b(0x265)](),_0xfa7224=_0xd6d16b==='tv'?_0x2565cd[_0x44aa1b(0x26f)]:_0x2565cd[_0x44aa1b(0x225)],_0x23eea7=_0xd6d16b==='tv'?_0x2565cd[_0x44aa1b(0x1e3)]:_0x2565cd[_0x44aa1b(0x267)],_0x451860=_0x23eea7?parseInt(_0x23eea7['split']('-')[0x0]):null;return{'title':_0xfa7224,'year':_0x451860,'tmdbId':_0x45bec2};});}function decryptCastle(_0xc6ebf1,_0x4830a9){return __async(this,null,function*(){const _0x32c1f5=_0x44e1;console['log'](_0x32c1f5(0x21b));try{const _0x124330=require(_0x32c1f5(0x264));if(typeof __crypto_aes_decrypt_raw!=='undefined'){const _0x23174d=_0x124330[_0x32c1f5(0x1f7)][_0x32c1f5(0x209)];_0x124330['AES'][_0x32c1f5(0x209)]=function(_0xee5ebe,_0xdc47ba,_0x350562){const _0x5d9219=_0x32c1f5;try{const _0xe2ca99=_0x56fed0=>{const _0x4dd3f1=_0x44e1,_0x4f63a2=new Uint8Array(_0x56fed0['sigBytes']);for(let _0x3866bd=0x0;_0x3866bd<_0x56fed0[_0x4dd3f1(0x203)];_0x3866bd++){_0x4f63a2[_0x3866bd]=_0x56fed0[_0x4dd3f1(0x1f8)][_0x3866bd>>>0x2]>>>0x18-_0x3866bd%0x4*0x8&0xff;}return _0x4f63a2;},_0x2a1521=_0x36e655=>{const _0x144bda=_0x44e1;if(_0x36e655 instanceof Uint8Array)return _0x36e655;if(_0x36e655 instanceof ArrayBuffer)return new Uint8Array(_0x36e655);if(_0x36e655&&typeof _0x36e655[_0x144bda(0x25f)]===_0x144bda(0x245))return new Uint8Array(Array[_0x144bda(0x1e0)]['slice'][_0x144bda(0x1fb)](_0x36e655));return new Uint8Array(0x0);},_0x5d8830=typeof _0xee5ebe==='string'?new Uint8Array(Array[_0x5d9219(0x204)](atob(_0xee5ebe),_0x42cb6d=>_0x42cb6d[_0x5d9219(0x261)](0x0))):_0xee5ebe[_0x5d9219(0x1fe)]?_0xe2ca99(_0xee5ebe[_0x5d9219(0x1fe)]):_0x2a1521(_0xee5ebe),_0x300d1d=_0xe2ca99(_0xdc47ba),_0x25e833=_0x350562&&_0x350562['iv']?_0xe2ca99(_0x350562['iv']):new Uint8Array(0x0),_0x37b488=_0x350562&&_0x350562[_0x5d9219(0x24c)]||_0x5d9219(0x24f),_0x155c77=typeof Int8Array!==_0x5d9219(0x255)?new Int8Array(_0x300d1d[_0x5d9219(0x26b)]):_0x300d1d,_0x579db0=typeof Int8Array!=='undefined'?new Int8Array(_0x25e833['buffer']):_0x25e833,_0x2d2b32=typeof Int8Array!==_0x5d9219(0x255)?new Int8Array(_0x5d8830['buffer']):_0x5d8830,_0x5ba30d=__crypto_aes_decrypt_raw(_0x37b488,_0x155c77,_0x579db0,_0x2d2b32),_0xd18d9e=new TextDecoder()[_0x5d9219(0x1f9)](_0x5ba30d);return{'toString':function(){return _0xd18d9e;}};}catch(_0xe309ac){return console[_0x5d9219(0x1f0)](_0x5d9219(0x1ea),_0xe309ac),_0x23174d[_0x5d9219(0x1fb)](_0x124330['AES'],_0xee5ebe,_0xdc47ba,_0x350562);}};}const _0x227260='T!BgJB',_0x482d9c=_0x124330['enc'][_0x32c1f5(0x216)][_0x32c1f5(0x1f2)](_0x4830a9),_0x1339d3=_0x124330[_0x32c1f5(0x242)][_0x32c1f5(0x218)]['parse'](_0x227260),_0xd52821=_0x482d9c['concat'](_0x1339d3);let _0x59f612;if(_0xd52821[_0x32c1f5(0x203)]<0x10){const _0x129518=_0x124330[_0x32c1f5(0x229)][_0x32c1f5(0x1f5)][_0x32c1f5(0x22d)](new Array(0x10-_0xd52821['sigBytes'])[_0x32c1f5(0x223)](0x0));_0x59f612=_0xd52821['concat'](_0x129518);}else _0xd52821[_0x32c1f5(0x203)]>0x10?_0x59f612=_0x124330['lib']['WordArray'][_0x32c1f5(0x22d)](_0xd52821[_0x32c1f5(0x1f8)][_0x32c1f5(0x23f)](0x0,0x4),0x10):_0x59f612=_0xd52821;const _0x305fbb=_0x59f612,_0x165e51=_0x124330[_0x32c1f5(0x1f7)][_0x32c1f5(0x209)](_0xc6ebf1,_0x59f612,{'iv':_0x305fbb,'mode':_0x124330[_0x32c1f5(0x24c)]['CBC'],'padding':_0x124330['pad'][_0x32c1f5(0x246)]}),_0x3adb8e=_0x165e51[_0x32c1f5(0x220)](_0x124330['enc'][_0x32c1f5(0x218)]);if(!_0x3adb8e)throw new Error(_0x32c1f5(0x1fd));return console[_0x32c1f5(0x210)]('[Castle]\x20Local\x20decryption\x20successful'),_0x3adb8e;}catch(_0x282f45){console[_0x32c1f5(0x1f0)]('[Castle]\x20Local\x20decryption\x20failed:\x20'+_0x282f45['message']);throw _0x282f45;}});}function getSecurityKey(){return __async(this,null,function*(){const _0x436439=_0x44e1;console['log']('[Castle]\x20Fetching\x20security\x20key...');const _0xcc4799=CASTLE_BASE+_0x436439(0x1fa)+CHANNEL+_0x436439(0x235)+CLIENT+_0x436439(0x26e)+LANG,_0x25d0a0=yield makeRequest(_0xcc4799),_0x5985bc=yield _0x25d0a0['json']();if(_0x5985bc[_0x436439(0x222)]!==0xc8||!_0x5985bc[_0x436439(0x24b)])throw new Error(_0x436439(0x1e1)+JSON[_0x436439(0x272)](_0x5985bc));return console[_0x436439(0x210)](_0x436439(0x208)),_0x5985bc[_0x436439(0x24b)];});}function searchCastle(_0x1a0a07,_0x15b1e2,_0x560f28=0x1,_0x208034=0x1e){return __async(this,null,function*(){const _0x3a4973=_0x44e1;console[_0x3a4973(0x210)]('[Castle]\x20Searching\x20for:\x20'+_0x15b1e2);const _0x4a939a=new URLSearchParams({'channel':CHANNEL,'clientType':CLIENT,'keyword':_0x15b1e2,'lang':LANG,'mode':'1','packageName':PKG,'page':_0x560f28[_0x3a4973(0x220)](),'size':_0x208034['toString']()}),_0x1cc3db=CASTLE_BASE+_0x3a4973(0x262)+_0x4a939a[_0x3a4973(0x220)](),_0x20be66=yield makeRequest(_0x1cc3db),_0xd7a2bd=yield extractCipherFromResponse(_0x20be66),_0x703ccd=yield decryptCastle(_0xd7a2bd,_0x1a0a07);return JSON[_0x3a4973(0x1f2)](_0x703ccd);});}function getDetails(_0x1b40c9,_0x33dbe1){return __async(this,null,function*(){const _0x743ebf=_0x44e1;console[_0x743ebf(0x210)](_0x743ebf(0x23e)+_0x33dbe1);const _0x588fee=CASTLE_BASE+_0x743ebf(0x21d)+CHANNEL+'&clientType='+CLIENT+_0x743ebf(0x26e)+LANG+'&movieId='+_0x33dbe1+_0x743ebf(0x1e9)+PKG,_0x2289e0=yield makeRequest(_0x588fee),_0x2865b4=yield extractCipherFromResponse(_0x2289e0),_0x217860=yield decryptCastle(_0x2865b4,_0x1b40c9);return JSON[_0x743ebf(0x1f2)](_0x217860);});}function getVideoV1(_0x5db07e,_0x5e010,_0x5b503c,_0x39cb02,_0x52da17=0x2){return __async(this,null,function*(){const _0x3beb02=_0x44e1;console[_0x3beb02(0x210)](_0x3beb02(0x253)+_0x5e010+_0x3beb02(0x25e)+_0x39cb02);const _0x4153b9=CASTLE_BASE+_0x3beb02(0x1e6)+CLIENT+_0x3beb02(0x1e9)+PKG+_0x3beb02(0x227)+CHANNEL+'&lang='+LANG,_0x1eb498={'mode':'1','appMarket':_0x3beb02(0x21a),'clientType':CLIENT,'woolUser':_0x3beb02(0x206),'apkSignKey':_0x3beb02(0x22f),'androidVersion':'13','movieId':_0x5e010[_0x3beb02(0x220)](),'episodeId':_0x5b503c[_0x3beb02(0x220)](),'languageId':_0x39cb02[_0x3beb02(0x220)](),'isNewUser':_0x3beb02(0x23a),'resolution':_0x52da17['toString'](),'packageName':PKG},_0x10b03a=yield makeRequest(_0x4153b9,{'method':_0x3beb02(0x1f3),'headers':{'Content-Type':_0x3beb02(0x212)},'body':JSON[_0x3beb02(0x272)](_0x1eb498)}),_0x3b5806=yield extractCipherFromResponse(_0x10b03a),_0x3545cc=yield decryptCastle(_0x3b5806,_0x5db07e);return JSON['parse'](_0x3545cc);});}function getVideo2(_0x13e2e0,_0x4e860c,_0x1b29ed,_0x12b2eb=0x2){return __async(this,null,function*(){const _0x46256f=_0x44e1;console[_0x46256f(0x210)](_0x46256f(0x22b)+_0x4e860c+_0x46256f(0x1e7)+_0x1b29ed);const _0x492b01=CASTLE_BASE+_0x46256f(0x1e6)+CLIENT+_0x46256f(0x1e9)+PKG+_0x46256f(0x227)+CHANNEL+_0x46256f(0x26e)+LANG,_0x2bbf47={'mode':'1','appMarket':_0x46256f(0x21a),'clientType':CLIENT,'woolUser':_0x46256f(0x206),'apkSignKey':_0x46256f(0x22f),'androidVersion':'13','movieId':_0x4e860c[_0x46256f(0x220)](),'episodeId':_0x1b29ed[_0x46256f(0x220)](),'isNewUser':_0x46256f(0x23a),'resolution':_0x12b2eb[_0x46256f(0x220)](),'packageName':PKG},_0x334736=yield makeRequest(_0x492b01,{'method':_0x46256f(0x1f3),'headers':{'Content-Type':_0x46256f(0x212)},'body':JSON[_0x46256f(0x272)](_0x2bbf47)}),_0x891bc9=yield extractCipherFromResponse(_0x334736),_0x33520e=yield decryptCastle(_0x891bc9,_0x13e2e0);return JSON[_0x46256f(0x1f2)](_0x33520e);});}function findCastleMovieId(_0x57fcd6,_0x4f8418){return __async(this,null,function*(){const _0x1728f4=_0x44e1,_0x26af00=_0x4f8418['year']?_0x4f8418[_0x1728f4(0x225)]+'\x20'+_0x4f8418[_0x1728f4(0x239)]:_0x4f8418['title'],_0x4d704e=yield searchCastle(_0x57fcd6,_0x26af00),_0x59afbd=extractDataBlock(_0x4d704e),_0x8a8050=_0x59afbd[_0x1728f4(0x238)]||[];if(_0x8a8050[_0x1728f4(0x25f)]===0x0)throw new Error('No\x20search\x20results\x20found');for(const _0x255a56 of _0x8a8050){const _0x20be27=(_0x255a56[_0x1728f4(0x225)]||_0x255a56[_0x1728f4(0x26f)]||'')[_0x1728f4(0x258)](),_0x4f2b66=_0x4f8418['title'][_0x1728f4(0x258)]();if(_0x20be27[_0x1728f4(0x20b)](_0x4f2b66)||_0x4f2b66[_0x1728f4(0x20b)](_0x20be27)){const _0x38ac5b=_0x255a56['id']||_0x255a56[_0x1728f4(0x249)]||_0x255a56[_0x1728f4(0x200)];if(_0x38ac5b)return console[_0x1728f4(0x210)]('[Castle]\x20Found\x20match:\x20'+(_0x255a56['title']||_0x255a56[_0x1728f4(0x26f)])+_0x1728f4(0x234)+_0x38ac5b+')'),_0x38ac5b[_0x1728f4(0x220)]();}}const _0x4d2a6e=_0x8a8050[0x0],_0x3a963b=_0x4d2a6e['id']||_0x4d2a6e[_0x1728f4(0x249)]||_0x4d2a6e['redirectIdStr'];if(_0x3a963b)return console['log'](_0x1728f4(0x243)+(_0x4d2a6e['title']||_0x4d2a6e[_0x1728f4(0x26f)])+_0x1728f4(0x234)+_0x3a963b+')'),_0x3a963b['toString']();throw new Error(_0x1728f4(0x24a));});}function _0x576f(){const _0x56b7ed=['lcbLCgLZB2rLswq6ia','q291BgqGBM90igzPBMqGzxbPC29Kzsbjra','jNbHy2THz2voyw1Lpq','w0nHC3rSzsbktKKGugf0y2HDierLy3j5ChqGzMfPBgvKlcbMywXSAw5NigjHy2S6','vw5RBM93BG','ntCXmtqWtgXlC3bY','AwrLBNrPDhK','B2jQzwn0','B2TODhrWlZqUos4Z','zxjYB3i','mJaXnxDzB3PLEG','CgfYC2u','ue9tva','nJK3ogHyDLvUuG','v29YzefYCMf5','zM9YrwfJAa','quvt','D29Yzhm','zgvJB2rL','l3yWlJeVC3LZDgvTl2DLDfnLy3vYAxr5s2v5lZe/y2HHBM5LBd0','y2fSBa','w0nHC3rSzv0Gvg90ywWGC3rYzwfTCYbMB3vUzdOG','rgvJCNLWDgLVBIbYzxn1BhrLzcbPBIbLBxb0EsbZDhjPBMCGkhbVC3nPyMXLigTLEs9jvIbTAxnTyxrJAcK','y2LWAgvYDgv4Da','zxHPC3rjBMrPDMLKDwfSvMLKzw8','CMvKAxjLy3rjzfn0CG','AgfZt3DUuhjVCgvYDhK','p2fWAv9RzxK9','C2LNqNL0zxm','zNjVBq','DxjS','zMfSC2u','oIbgB3vUzca','w0nHC3rSzv0Gu2vJDxjPDhKGA2v5ig9IDgfPBMvK','zgvJCNLWDa','mJqWndiYnejsBen2CG','Aw5JBhvKzxm','q2fZDgXLic0G','C3rHDhvZ','DgHYB3C','ChvZAa','Bg9N','mZK2odbjtKL0teK','yxbWBgLJyxrPB24VANnVBG','BwvZC2fNzq','nty2otC2zM9kCMTs','y2fZDgXL','qMfZzty0','w0nHC3rSzv0Gve1eqIbjBMzVoIaI','vxrMoa','BgfUz3vHz2voyw1L','r3vHBLDHBMC','w0nHC3rSzv0Gu3rHCNrPBMCGBg9JywWGquvtluncqYbKzwnYExb0Aw9UlI4U','CMvZB2X2zq','l2zPBg0TyxbPl3yXlJKUos9TB3zPzt9JAgfUBMvSpq','w0nHC3rSzv0GtM8GDMLKzw9vCMWGzM91BMqGAw4GCMvZCg9UC2u','sw5KAwfb','Dg9tDhjPBMC','C2vHC29UCW','y29Kzq','zMLSBa','ChjVCgvYDhLjC0vUDw1LCMfIBgu','DgL0Bgu','jMfWCgvUzf90B19YzxnWB25Zzt1LEhrLCM5HBf9Pzhm','jMnOyw5UzwW9','nZy4mta1swTKDwzO','BgLI','BM8Ty29YCW','w0nHC3rSzv0GrMv0y2HPBMCGDMLKzw8GkhyYksbMB3iGBw92AwvjzdOG','w0nHC3rSzv0GuMvXDwvZDcbMywLSzwqGzM9Yia','y3jLyxrL','C2L6zq','ruqWotu1ruiWneu2n0eXrdLgmZmWnui5ntq1nezfrdq4nti2mtq3nq','C3rHDhvZvgv4Da','Bw92Awvjza','w0nHC3rSzv0G4PQG77Ipia','y29TlMv4DgvYBMfSlMnHC3rSzq','icHPzdOG','jMnSAwvUDfr5Cgu9','zw4TvvmSzw47Ct0WlJK','ie1c','CM93CW','EwvHCG','Dhj1zq','mta4mha','ic0G','CxvHBgL0Eq','w0nHC3rSzv0GrMv0y2HPBMCGzgv0ywLSCYbMB3iGBw92AwvjzdOG','C2XPy2u','DMLKzw9Z','ieDc','zw5J','w0nHC3rSzv0GvxnPBMCGzMLYC3qGCMvZDwX0oIa','CMvWBgfJzq','BNvTyMvY','ugTJCZC','ndGWCa','zxbPC29Kzxm','CMvKAxjLy3rjza','q291BgqGBM90igv4DhjHy3qGBw92AwuGsuqGzNjVBsbZzwfYy2GGCMvZDwX0CW','zgf0yq','Bw9Kzq','zMLUza','s2vLCc1bBgL2zq','quvtluncqW','BMv4Da','w0nHC3rSzv0G4PYfia','DMfSDwu','w0nHC3rSzv0GrMv0y2HPBMCGDMLKzw8GkhyXksbMB3iGBw92AwvjzdOG','mta3ogfZuvLNAq','Dw5KzwzPBMvK','ywjICMv2Awf0zq','CgfKu3rHCNq','Dg9mB3DLCKnHC2u','Dgv4Da','yxbWBhK','DhjHy2TZ','DgHLBG','w0nHC3rSzv0GrMv0y2HPBMCG','lcbSyw5NDwfNzuLKoIa','BgvUz3rO','AxnbCNjHEq','y2HHCKnVzgvbDa','l2zPBg0TyxbPl3yXlJeUmc9TB3zPzs9ZzwfYy2HcEuTLExDVCMq/','C3vIDgL0BgvZ','y3j5ChrVlwPZ','ANnVBG','Bwv0Ag9K','CMvSzwfZzv9KyxrL','y3jVC3mTC2L0zq','nJK5ntqWm3fSrw9TzG','DhjPBq','yNvMzMvY','q2fZDgXLia','w0nHC3rSzv0GrMfSBgLUzYbIywnRihrVihnOyxjLzcbZDhjLyw0GkhyYkq','jMXHBMC9','BMfTzq','BgfUz3vHz2vjza','rw1WDhKGCMvZCg9UC2u','C3rYAw5NAwz5','A2vLCc1HBgL2zq','C29YDa','r0vu','zxHWB3j0CW','Dg9gAxHLza','igrLDgfPBhmUlI4','sfruuca','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmW','ChjVDg90ExbL','u2vJDxjPDhKGA2v5iefqssbLCNjVCJOG','lcbtoG','zMLYC3rFywLYx2rHDgu','oIbgywLSzwqGlsa','Bw92Awu','l2zPBg0TyxbPl3yYlJaUms9TB3zPzs9NzxrwAwrLBZi/y2XPzw50vhLWzt0'];_0x576f=function(){return _0x56b7ed;};return _0x576f();}function getQualityValue(_0x2ea31c){const _0x5bcb63=_0x476166;if(!_0x2ea31c)return 0x0;const _0x4f5e3d=_0x2ea31c[_0x5bcb63(0x220)]()['toLowerCase']()[_0x5bcb63(0x244)](/^(sd|hd|fhd|uhd|4k)\s*/i,'')[_0x5bcb63(0x244)](/p$/,'')[_0x5bcb63(0x26a)](),_0x28cc18={'4k':0x870,'2160':0x870,'1440':0x5a0,'1080':0x438,'720':0x2d0,'480':0x1e0,'360':0x168,'240':0xf0};if(_0x28cc18[_0x4f5e3d])return _0x28cc18[_0x4f5e3d];const _0x3c9cf9=parseInt(_0x4f5e3d);if(!isNaN(_0x3c9cf9)&&_0x3c9cf9>0x0)return _0x3c9cf9;return 0x0;}function formatSize(_0x2ca7d8){const _0x282182=_0x476166;if(typeof _0x2ca7d8!==_0x282182(0x245)||_0x2ca7d8<=0x0)return _0x282182(0x1eb);if(_0x2ca7d8>0x3b9aca00)return(_0x2ca7d8/0x3b9aca00)['toFixed'](0x2)+_0x282182(0x241);return(_0x2ca7d8/0xf4240)[_0x282182(0x277)](0x0)+_0x282182(0x237);}function resolutionToQuality(_0x4bfeef){const _0x3385b4=_0x476166,_0x2d7fe4={0x1:_0x3385b4(0x247),0x2:'720p',0x3:_0x3385b4(0x23b)};return _0x2d7fe4[_0x4bfeef]||_0x4bfeef+'p';}function processVideoResponse(_0x51d20f,_0x73c86a,_0x29525d,_0x2a9997,_0xc0905c,_0x463154){const _0x4ac61c=_0x476166,_0x4a3539=[],_0x5df573=extractDataBlock(_0x51d20f),_0x4355a9=_0x5df573['videoUrl'];if(!_0x4355a9)return console[_0x4ac61c(0x210)](_0x4ac61c(0x21e)),_0x4a3539;const _0x18d63b=[];_0x5df573[_0x4ac61c(0x263)]&&Array[_0x4ac61c(0x260)](_0x5df573[_0x4ac61c(0x263)])&&_0x5df573['subtitles'][_0x4ac61c(0x1f6)](_0x6fb016=>{const _0x3030ee=_0x4ac61c;_0x6fb016[_0x3030ee(0x205)]&&_0x18d63b[_0x3030ee(0x20f)]({'url':_0x6fb016['url'],'language':_0x6fb016['abbreviate']||_0x3030ee(0x1eb),'name':_0x6fb016[_0x3030ee(0x225)]||_0x6fb016[_0x3030ee(0x256)]||_0x3030ee(0x1eb),'headers':PLAYBACK_HEADERS});});let _0x1e4135=_0x73c86a['title']||_0x4ac61c(0x1eb);_0x73c86a['year']&&(_0x1e4135+='\x20('+_0x73c86a[_0x4ac61c(0x239)]+')');_0x29525d&&_0x2a9997&&(_0x1e4135=_0x73c86a[_0x4ac61c(0x225)]+'\x20S'+String(_0x29525d)[_0x4ac61c(0x257)](0x2,'0')+'E'+String(_0x2a9997)['padStart'](0x2,'0'));const _0x36522a=resolutionToQuality(_0xc0905c);if(_0x5df573['videos']&&Array[_0x4ac61c(0x260)](_0x5df573[_0x4ac61c(0x240)]))for(const _0x2adc37 of _0x5df573['videos']){let _0x40004a=_0x2adc37['resolutionDescription']||_0x2adc37['resolution']||_0x36522a;_0x40004a=_0x40004a[_0x4ac61c(0x244)](/^(SD|HD|FHD)\s+/i,'');const _0x57d84b=_0x463154?_0x4ac61c(0x26c)+_0x463154+_0x4ac61c(0x23c)+_0x40004a:_0x4ac61c(0x20c)+_0x40004a;_0x4a3539['push']({'name':_0x57d84b,'title':_0x1e4135,'url':_0x2adc37[_0x4ac61c(0x205)]||_0x4355a9,'quality':_0x40004a,'size':formatSize(_0x2adc37['size']),'headers':PLAYBACK_HEADERS,'provider':_0x4ac61c(0x215),'subtitles':_0x18d63b});}else{const _0x23119a=_0x463154?_0x4ac61c(0x26c)+_0x463154+_0x4ac61c(0x23c)+_0x36522a:'Castle\x20-\x20'+_0x36522a;_0x4a3539[_0x4ac61c(0x20f)]({'name':_0x23119a,'title':_0x1e4135,'url':_0x4355a9,'quality':_0x36522a,'size':formatSize(_0x5df573[_0x4ac61c(0x22e)]),'headers':PLAYBACK_HEADERS,'provider':_0x4ac61c(0x215),'subtitles':_0x18d63b});}return _0x4a3539;}function getStreams(_0x4e2678,_0x308ce5,_0x4360e6,_0x3a120a){return __async(this,null,function*(){const _0x40c17b=_0x44e1;console[_0x40c17b(0x210)]('[Castle]\x20Starting\x20extraction\x20for\x20TMDB\x20ID:\x20'+_0x4e2678+',\x20Type:\x20'+_0x308ce5+(_0x308ce5==='tv'?_0x40c17b(0x1e2)+_0x4360e6+'E:'+_0x3a120a:''));try{const _0x49acb1=yield getTMDBDetails(_0x4e2678,_0x308ce5);console['log'](_0x40c17b(0x217)+_0x49acb1[_0x40c17b(0x225)]+'\x22\x20('+(_0x49acb1[_0x40c17b(0x239)]||'N/A')+')');const _0x3a9a82=yield getSecurityKey(),_0xc7ae78=yield findCastleMovieId(_0x3a9a82,_0x49acb1);let _0x581633=yield getDetails(_0x3a9a82,_0xc7ae78),_0x53456a=_0xc7ae78;if(_0x308ce5==='tv'&&_0x4360e6&&_0x3a120a){const _0x31bf4c=extractDataBlock(_0x581633),_0x49de5f=_0x31bf4c[_0x40c17b(0x221)]||[],_0x28e6b7=_0x49de5f[_0x40c17b(0x24d)](_0x2fba64=>_0x2fba64[_0x40c17b(0x245)]===_0x4360e6);_0x28e6b7&&_0x28e6b7[_0x40c17b(0x231)]&&_0x28e6b7[_0x40c17b(0x231)]!==_0xc7ae78&&(console[_0x40c17b(0x210)]('[Castle]\x20Fetching\x20season\x20'+_0x4360e6+_0x40c17b(0x278)),_0x581633=yield getDetails(_0x3a9a82,_0x28e6b7[_0x40c17b(0x231)]['toString']()),_0x53456a=_0x28e6b7[_0x40c17b(0x231)][_0x40c17b(0x220)]());}const _0x28285a=extractDataBlock(_0x581633),_0x5a3185=_0x28285a[_0x40c17b(0x248)]||[];let _0x278ae7=null;if(_0x308ce5==='tv'&&_0x4360e6&&_0x3a120a){const _0x3a26a4=_0x5a3185[_0x40c17b(0x24d)](_0x40594b=>_0x40594b[_0x40c17b(0x245)]===_0x3a120a);_0x3a26a4&&_0x3a26a4['id']&&(_0x278ae7=_0x3a26a4['id'][_0x40c17b(0x220)]());}else _0x5a3185[_0x40c17b(0x25f)]>0x0&&(_0x278ae7=_0x5a3185[0x0]['id'][_0x40c17b(0x220)]());if(!_0x278ae7)throw new Error(_0x40c17b(0x1e8));const _0x32e04c=_0x5a3185[_0x40c17b(0x24d)](_0x5b0c72=>_0x5b0c72['id']['toString']()===_0x278ae7),_0x568af5=_0x32e04c&&_0x32e04c[_0x40c17b(0x25b)]||[],_0x5e477c=0x2,_0xcfb5e5=[];for(const _0x26219c of _0x568af5){const _0x47f944=_0x26219c[_0x40c17b(0x219)]||_0x26219c[_0x40c17b(0x256)]||_0x40c17b(0x1eb);if(_0x26219c[_0x40c17b(0x1ff)]&&_0x26219c[_0x40c17b(0x270)])try{console[_0x40c17b(0x210)](_0x40c17b(0x25d)+_0x47f944+'\x20(languageId:\x20'+_0x26219c[_0x40c17b(0x270)]+')');const _0x133c6=yield getVideoV1(_0x3a9a82,_0x53456a,_0x278ae7,_0x26219c['languageId'],_0x5e477c),_0x31a517=processVideoResponse(_0x133c6,_0x49acb1,_0x4360e6,_0x3a120a,_0x5e477c,'['+_0x47f944+']');_0x31a517[_0x40c17b(0x25f)]>0x0&&(console[_0x40c17b(0x210)](_0x40c17b(0x251)+_0x47f944+_0x40c17b(0x207)+_0x31a517[_0x40c17b(0x25f)]+'\x20streams'),_0xcfb5e5[_0x40c17b(0x20f)](..._0x31a517));}catch(_0x524520){console[_0x40c17b(0x210)](_0x40c17b(0x232)+_0x47f944+_0x40c17b(0x1e4)+_0x524520[_0x40c17b(0x213)]);}}if(_0xcfb5e5['length']===0x0){console[_0x40c17b(0x210)](_0x40c17b(0x26d));const _0x4916cb=yield getVideo2(_0x3a9a82,_0x53456a,_0x278ae7,_0x5e477c),_0x5306a6=processVideoResponse(_0x4916cb,_0x49acb1,_0x4360e6,_0x3a120a,_0x5e477c,'[Shared]');_0xcfb5e5[_0x40c17b(0x20f)](..._0x5306a6);}return _0xcfb5e5[_0x40c17b(0x274)]((_0x10ef39,_0x38ac31)=>getQualityValue(_0x38ac31[_0x40c17b(0x23d)])-getQualityValue(_0x10ef39[_0x40c17b(0x23d)])),console[_0x40c17b(0x210)](_0x40c17b(0x1fc)+_0xcfb5e5[_0x40c17b(0x25f)]),_0xcfb5e5;}catch(_0x90f7a8){return console[_0x40c17b(0x1f0)]('[Castle]\x20Error:\x20'+_0x90f7a8[_0x40c17b(0x213)]),[];}});}module[_0x476166(0x276)]={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "castle", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "🏰 Castle", "castle");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
