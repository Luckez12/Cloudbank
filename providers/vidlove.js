// Imported provider: vidlove; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
'use strict';const _0x4d63e8=_0x8990;(function(_0x136d77,_0x25a558){const _0x29fa25={_0x48d8a1:0x1a0,_0x4b8bfb:0x1af,_0x5ce59a:0x1ca,_0x299ca0:0x1a5,_0x120ec3:0x1d6},_0x534c9d=_0x8990,_0x270b03=_0x136d77();while(!![]){try{const _0x31b7f4=-parseInt(_0x534c9d(_0x29fa25._0x48d8a1))/0x1*(-parseInt(_0x534c9d(0x1db))/0x2)+-parseInt(_0x534c9d(0x1d4))/0x3+parseInt(_0x534c9d(0x1cf))/0x4*(-parseInt(_0x534c9d(0x1dc))/0x5)+parseInt(_0x534c9d(_0x29fa25._0x4b8bfb))/0x6+parseInt(_0x534c9d(0x1a9))/0x7*(-parseInt(_0x534c9d(0x1b1))/0x8)+-parseInt(_0x534c9d(_0x29fa25._0x5ce59a))/0x9+-parseInt(_0x534c9d(_0x29fa25._0x299ca0))/0xa*(-parseInt(_0x534c9d(_0x29fa25._0x120ec3))/0xb);if(_0x31b7f4===_0x25a558)break;else _0x270b03['push'](_0x270b03['shift']());}catch(_0x355748){_0x270b03['push'](_0x270b03['shift']());}}}(_0x4992,0xd51f7));var __async=(_0x472eda,_0xf1b654,_0x439816)=>{const _0x238894={_0x825e05:0x1d2};return new Promise((_0x3b160d,_0xa6b417)=>{const _0x2fcce1={_0x34a812:0x1ce},_0xaff2ff=_0x8990;var _0x4c7ba1=_0x25ad8a=>{const _0x3dd6ee=_0x8990;try{_0x58a3dc(_0x439816[_0x3dd6ee(_0x2fcce1._0x34a812)](_0x25ad8a));}catch(_0x4b583e){_0xa6b417(_0x4b583e);}},_0x1fb517=_0x3a4c28=>{try{_0x58a3dc(_0x439816['throw'](_0x3a4c28));}catch(_0x138e93){_0xa6b417(_0x138e93);}},_0x58a3dc=_0x2d940c=>_0x2d940c['done']?_0x3b160d(_0x2d940c[_0xaff2ff(0x1a4)]):Promise[_0xaff2ff(0x1ae)](_0x2d940c[_0xaff2ff(0x1a4)])[_0xaff2ff(0x1c5)](_0x4c7ba1,_0x1fb517);_0x58a3dc((_0x439816=_0x439816[_0xaff2ff(_0x238894._0x825e05)](_0x472eda,_0xf1b654))['next']());});},BASE_URL='https://ballerinacappuccinalovestungtungtungsahur.com',REFERER=_0x4d63e8(0x199),TMDB_BASE='https://api.themoviedb.org/3',TMDB_KEY=_0x4d63e8(0x1b7),MIN_QUALITY=0x438,DEFAULT_QUALITY='1080p',USER_AGENT=_0x4d63e8(0x1a6),PROVIDERS=[_0x4d63e8(0x1a2),'ipcloud','tcloud','vidapi',_0x4d63e8(0x1be),_0x4d63e8(0x197),'xpass','vidrift','lookmovie','vidnest'],DEFAULT_HEADERS={'accept':'application/json','accept-language':_0x4d63e8(0x1b0),'sec-ch-ua':'\x22Not;A=Brand\x22;v=\x228\x22,\x20\x22Chromium\x22;v=\x22150\x22,\x20\x22Google\x20Chrome\x22;v=\x22150\x22','Referer':REFERER,'User-Agent':USER_AGENT};function getInvertedSortTag(_0x41e68d,_0x1b718f=0xf423f){const _0x5fb71c={_0x43edde:0x1c4,_0x318e3a:0x1ab},_0x4f8f3d=_0x4d63e8,_0x2c787e=Math['max'](0x0,parseInt(_0x41e68d,0xa)||0x0),_0x56ffd7=Math[_0x4f8f3d(_0x5fb71c._0x43edde)](0x0,_0x1b718f-_0x2c787e),_0x1430c9=_0x56ffd7[_0x4f8f3d(_0x5fb71c._0x318e3a)](0x2)[_0x4f8f3d(0x1a1)](0x14,'0');return _0x1430c9[_0x4f8f3d(0x1c9)]('')['map'](_0x36aa60=>_0x36aa60==='1'?'\ufeff':'​')['join']('');}function _0x4992(){const _0xd65133=['Ahr0Chm6lY9WBgf5zxiUDMLKBg92zs5JyY8','ihWG8j+tPsbxruiTreW','BwfW','DhjPBq','8j+sJIa3mJbW','8j+uPsaXmdGWCa','zxbPC29KzvrPDgXL','nJnyC3n5tMu','CgfKu3rHCNq','Bw92AwvIB3G','8j+tIYbt','DMfSDwu','mtbWz3HuD1O','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeZms4WlJaUmcbtywzHCMKVntm3lJm2','Dg9mB3DLCKnHC2u','zMLSDgvY','n0HpBvrwrG','DxjS','Dg9tDhjPBMC','C2XPy2u','mta4ma','CMvZB2X2zq','odGZodK0mKfry2z1Cq','BMWTtKWSBMW7Ct0WlJKSzw4Tvvm7Ct0WlJGSzw47Ct0WlJC','nZG5mti4oeLkC25PtW','ANnVBG','l3nLyxnVBI8','B3jPz2LUywXFDgL0Bgu','Aw5JBhvKzxm','zMHK','mZa3yJDIogvMmdm1yZzHytmZnJKWmgfLzJrLmJaZyMq','DgvZDa','C2vHC29U','vw5RBM93BG','8j+tUIa','CxvHBgL0AwvZ','zxbPC29Kzxm','DML4C3jJ','BMfTzq','8j+oRca','zxHWB3j0CW','mJe2ma','BgfIzwW','Bwf4','DgHLBG','zxbPC29Kzq','C2v0','8j+oNU+4JYbns1yGFcdIMQeGsevwqYb8ipcFJQCGqufd','C3bSAxq','mteXmdCYmZn3q0T0u3O','DwHK','l3r2lW','DgL0Bgu','BMv4Da','mZu1mJeXmKreu29IqW','AgfZ','yxbWBgLJyxrPB24VANnVBG','yxbWBhK','CMvSzwfZzv9KyxrL','mZuYndi2nvvqCvLiAG','BgvUz3rO','mJi5oty3mJfwCxfLB1m','CxvHBgL0Eq','EwvHCG','vMLKBg92zsdIGkiG','BwvKAwfuExbL','nta1ntzftMDSvu0','nxf4wwzlyq','DhzZAg93','Bw92Awu','mwvTyMvK','ndGW'];_0x4992=function(){return _0xd65133;};return _0x4992();}function getResolutionEmoji(_0x5ab27d){const _0x8c76e8={_0x3d33cf:0x1c2,_0xb527c7:0x1b5,_0x3a1013:0x1cb,_0x2090a9:0x1ad,_0x59ce78:0x1b5,_0x316c46:0x1b6,_0x5436cf:0x19e,_0x3ec92d:0x19d,_0x526ec6:0x1b5,_0x695a62:0x198,_0x3369a6:0x1bb},_0x22c162=_0x4d63e8,_0x2912d4=String(_0x5ab27d||'')['toLowerCase']();if(_0x2912d4[_0x22c162(0x1b5)](_0x22c162(_0x8c76e8._0x3d33cf))||_0x2912d4[_0x22c162(_0x8c76e8._0xb527c7)]('4k')||_0x2912d4['includes'](_0x22c162(_0x8c76e8._0x3a1013)))return'🌟\x204K';if(_0x2912d4['includes'](_0x22c162(_0x8c76e8._0x2090a9))||_0x2912d4[_0x22c162(_0x8c76e8._0x59ce78)](_0x22c162(_0x8c76e8._0x316c46)))return _0x22c162(_0x8c76e8._0x5436cf);if(_0x2912d4['includes']('720')||_0x2912d4[_0x22c162(0x1b5)]('hd'))return _0x22c162(_0x8c76e8._0x3ec92d);if(_0x2912d4[_0x22c162(_0x8c76e8._0x526ec6)](_0x22c162(_0x8c76e8._0x695a62))||_0x2912d4['includes']('sd'))return'📱\x20480p';return _0x22c162(_0x8c76e8._0x3369a6)+(_0x5ab27d||'1080p');}function qualityRank(_0x2120a3){const _0x356471={_0x473ce1:0x1b8},_0x2db853=_0x4d63e8;if(/2160p|4k/i['test'](_0x2120a3))return 0x4;if(/1080p/i['test'](_0x2120a3))return 0x3;if(/720p/i[_0x2db853(_0x356471._0x473ce1)](_0x2120a3))return 0x2;if(/480p/i[_0x2db853(0x1b8)](_0x2120a3))return 0x1;return 0x0;}function _0x8990(_0x23bc86,_0x349230){_0x23bc86=_0x23bc86-0x195;const _0x4992f2=_0x4992();let _0x8990e8=_0x4992f2[_0x23bc86];if(_0x8990['tUkkjR']===undefined){var _0x1f8042=function(_0x1acca8){const _0x1d3b18='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x472eda='',_0xf1b654='';for(let _0x439816=0x0,_0x3b160d,_0xa6b417,_0x4c7ba1=0x0;_0xa6b417=_0x1acca8['charAt'](_0x4c7ba1++);~_0xa6b417&&(_0x3b160d=_0x439816%0x4?_0x3b160d*0x40+_0xa6b417:_0xa6b417,_0x439816++%0x4)?_0x472eda+=String['fromCharCode'](0xff&_0x3b160d>>(-0x2*_0x439816&0x6)):0x0){_0xa6b417=_0x1d3b18['indexOf'](_0xa6b417);}for(let _0x1fb517=0x0,_0x58a3dc=_0x472eda['length'];_0x1fb517<_0x58a3dc;_0x1fb517++){_0xf1b654+='%'+('00'+_0x472eda['charCodeAt'](_0x1fb517)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0xf1b654);};_0x8990['PGCnyu']=_0x1f8042,_0x8990['wLxgMy']={},_0x8990['tUkkjR']=!![];}const _0x16f026=_0x4992f2[0x0],_0x47c203=_0x23bc86+_0x16f026,_0x5f4d3b=_0x8990['wLxgMy'][_0x47c203];return!_0x5f4d3b?(_0x8990e8=_0x8990['PGCnyu'](_0x8990e8),_0x8990['wLxgMy'][_0x47c203]=_0x8990e8):_0x8990e8=_0x5f4d3b,_0x8990e8;}var parseQuality=_0x4045ac=>{const _0x1c893d=String(_0x4045ac||'')['match'](/(\d+)/);return _0x1c893d?parseInt(_0x1c893d[0x1],0xa):0x0;},normalizeQuality=_0x406c1e=>{const _0x27be66=String(_0x406c1e||'')['trim']();return _0x27be66?_0x27be66:DEFAULT_QUALITY;},isQualityAcceptable=_0x2f4790=>{return parseQuality(normalizeQuality(_0x2f4790))>=MIN_QUALITY;};function fetchTmdbMeta(_0x3d0213,_0x4cdac0,_0x22b507=null,_0x173f3a=null){const _0x657f0a={_0x30cb6e:0x1bf,_0x1b4a78:0x1b4,_0x32f3bb:0x1d3,_0x23e860:0x1ac,_0x181708:0x1cc,_0x2c9ee4:0x1d1,_0x128025:0x1bd,_0x2759a2:0x1bf,_0x14a8d3:0x1ba};return __async(this,null,function*(){const _0x180e6f=_0x8990;try{const _0x1de216=_0x4cdac0==='tv'?'tv':_0x180e6f(0x196),_0x854349=yield fetch(TMDB_BASE+'/'+_0x1de216+'/'+encodeURIComponent(_0x3d0213)+'?api_key='+TMDB_KEY,{'headers':{'Accept':'application/json','User-Agent':USER_AGENT}});if(!_0x854349['ok'])return{'title':'Unknown','year':null,'episodeTitle':''};const _0x5b9b0d=yield _0x854349['json'](),_0x41f141=_0x5b9b0d['title']||_0x5b9b0d[_0x180e6f(_0x657f0a._0x30cb6e)]||_0x5b9b0d[_0x180e6f(_0x657f0a._0x1b4a78)]||_0x5b9b0d['original_name']||'Unknown',_0x349c71=_0x5b9b0d[_0x180e6f(_0x657f0a._0x32f3bb)]||_0x5b9b0d['first_air_date']||'',_0x201edf=_0x349c71?parseInt(_0x349c71[_0x180e6f(_0x657f0a._0x23e860)](0x0,0x4)):null;let _0x1ff9f6='';if(_0x4cdac0==='tv'&&_0x22b507&&_0x173f3a)try{const _0x3f184d=yield fetch(TMDB_BASE+_0x180e6f(_0x657f0a._0x181708)+encodeURIComponent(_0x3d0213)+_0x180e6f(0x1b3)+_0x22b507+'?api_key='+TMDB_KEY,{'headers':{'Accept':_0x180e6f(_0x657f0a._0x2c9ee4),'User-Agent':USER_AGENT}});if(_0x3f184d['ok']){const _0x5ce59d=yield _0x3f184d[_0x180e6f(0x1b2)]();if(_0x5ce59d&&Array['isArray'](_0x5ce59d[_0x180e6f(_0x657f0a._0x128025)])){const _0x569ab7=parseInt(_0x173f3a),_0x5e496a=_0x5ce59d[_0x180e6f(0x1bd)]['find'](_0x261291=>_0x261291['episode_number']===_0x569ab7);_0x5e496a&&_0x5e496a[_0x180e6f(_0x657f0a._0x30cb6e)]&&(_0x1ff9f6=_0x5e496a[_0x180e6f(_0x657f0a._0x2759a2)]);}}}catch(_0x598159){}return{'title':_0x41f141,'year':_0x201edf,'episodeTitle':_0x1ff9f6};}catch(_0x292f74){return{'title':_0x180e6f(_0x657f0a._0x14a8d3),'year':null,'episodeTitle':''};}});}var buildEndpointUrl=(_0x40b773,_0x49cdf3,_0x1db82a,_0x18f942,_0x3406ff)=>{const _0x394a72={_0x26d9b0:0x1b2,_0x59abaa:0x1c7},_0x3f469d=_0x4d63e8,_0x4fd7ec=new URLSearchParams({'id':_0x49cdf3,'mode':_0x3f469d(_0x394a72._0x26d9b0),'sources':_0x1db82a,'hevc':'1'});if(_0x18f942!=null)_0x4fd7ec[_0x3f469d(_0x394a72._0x59abaa)](_0x3f469d(0x1b9),_0x18f942);if(_0x3406ff!=null)_0x4fd7ec['set']('episode',_0x3406ff);return BASE_URL+'/'+_0x40b773+'?'+_0x4fd7ec;},mapQualityToStream=(_0x380b5c,_0x347921,_0x20ee65,_0x95e6c)=>{const _0x37acdc={_0x56a3e1:0x1cd,_0x13f9fb:0x1d8,_0x4ae9c0:0x1da,_0x3cb567:0x1c6,_0x5095b0:0x1a3,_0x25f9eb:0x1c6,_0x1f5a7e:0x1c8},_0x5eb43b=_0x4d63e8,_0x2e01ae=normalizeQuality(_0x380b5c['quality']),_0x271211=getResolutionEmoji(_0x2e01ae),_0x19f1b0=qualityRank(_0x2e01ae),_0x14ecb0=getInvertedSortTag(_0x19f1b0*0x186a0+(0x64-_0x20ee65),0xf423f),_0x465d76=_0x14ecb0+_0x5eb43b(0x1d9)+_0x2e01ae+'\x20•\x20'+_0x347921,_0x5bf416=_0x5eb43b(0x1c0)+_0x95e6c[_0x5eb43b(_0x37acdc._0x56a3e1)]+(_0x95e6c[_0x5eb43b(_0x37acdc._0x13f9fb)]?'\x20('+_0x95e6c[_0x5eb43b(0x1d8)]+')':'');let _0x114db4=null;_0x95e6c[_0x5eb43b(_0x37acdc._0x4ae9c0)]==='tv'&&_0x95e6c['season']&&_0x95e6c[_0x5eb43b(_0x37acdc._0x3cb567)]&&(_0x114db4=_0x5eb43b(_0x37acdc._0x5095b0)+_0x95e6c['season']+'\x20E'+_0x95e6c[_0x5eb43b(_0x37acdc._0x25f9eb)]+(_0x95e6c[_0x5eb43b(0x19f)]?'\x20-\x20'+_0x95e6c['episodeTitle']:''));const _0x3a7f92=_0x271211+'\x20|\x20🗣️\x20Multi-Audio',_0x5e0246=_0x5eb43b(_0x37acdc._0x1f5a7e),_0x1c57cf='🔗\x20Vidlove\x20|\x20🌐\x20'+_0x347921+_0x5eb43b(0x19a),_0x38ef9e=[_0x5bf416,_0x114db4,_0x3a7f92,_0x5e0246,_0x1c57cf][_0x5eb43b(0x1a8)](Boolean)['join']('\x0a'),_0x150734={'Referer':REFERER,'Origin':'https://player.vidlove.cc','User-Agent':USER_AGENT};return{'name':_0x465d76,'title':_0x38ef9e,'size':_0x38ef9e,'description':_0x38ef9e,'url':_0x380b5c['url'],'quality':_0x2e01ae,'headers':_0x150734,'behaviorHints':{'notWebReady':!![],'proxyHeaders':{'request':_0x150734}}};};function fetchProviderStreams(_0x26141a,_0x5e4699,_0x5b47fa,_0x409aac,_0x375ba1,_0x4d7cb9){const _0x4cdea0={_0x3d2385:0x1bc,_0x1d8816:0x1c3,_0x3e977c:0x1d5,_0x30b6e9:0x1aa};return __async(this,null,function*(){const _0x5ba0ba=_0x8990;var _0x37edeb;try{const _0x5c8c05=yield fetch(buildEndpointUrl(_0x5b47fa,_0x5e4699,_0x26141a,_0x409aac,_0x375ba1),{'method':'GET','headers':DEFAULT_HEADERS});if(!_0x5c8c05['ok'])return[];const {source:_0x4fb42e}=yield _0x5c8c05['json']();if(!_0x4fb42e)return[];const _0x4de8a7=Array['isArray'](_0x4fb42e[_0x5ba0ba(_0x4cdea0._0x3d2385)])?_0x4fb42e[_0x5ba0ba(0x1bc)]:[],_0x402fbb=(_0x37edeb=_0x4fb42e[_0x5ba0ba(_0x4cdea0._0x1d8816)])!=null?_0x37edeb:_0x26141a;if(_0x4de8a7[_0x5ba0ba(_0x4cdea0._0x3e977c)]>0x0)return _0x4de8a7['filter'](_0x4c8dce=>(_0x4c8dce==null?void 0x0:_0x4c8dce[_0x5ba0ba(0x1aa)])&&isQualityAcceptable(_0x4c8dce['quality']))[_0x5ba0ba(0x19b)]((_0x2f9b37,_0x57f912)=>mapQualityToStream(_0x2f9b37,_0x402fbb,_0x57f912,_0x4d7cb9));if(_0x4fb42e[_0x5ba0ba(_0x4cdea0._0x30b6e9)]&&isQualityAcceptable(_0x4fb42e[_0x5ba0ba(0x1d7)]))return[mapQualityToStream({'url':_0x4fb42e['url'],'quality':_0x4fb42e['quality']},_0x402fbb,0x0,_0x4d7cb9)];return[];}catch(_0x52c73f){return[];}});}function getStreams(_0x59080d,_0x149a3f,_0x18ab50,_0x1bec07){const _0x270063={_0x1308a5:0x19c,_0x34a1e0:0x196,_0x2b222d:0x1c6};return __async(this,null,function*(){const _0x251b1b=_0x8990;try{const _0xd11de6=String(_0x149a3f||'')[_0x251b1b(0x1a7)]()[_0x251b1b(_0x270063._0x1308a5)](),_0x3f08d4=_0xd11de6==='series'||_0xd11de6==='show'||_0xd11de6===_0x251b1b(0x195)||_0xd11de6==='tv'?'tv':_0x251b1b(_0x270063._0x34a1e0);if(_0x3f08d4==='tv'&&(_0x18ab50==null||_0x1bec07==null))return[];const _0x52cca4=yield fetchTmdbMeta(_0x59080d,_0x3f08d4,_0x18ab50,_0x1bec07);_0x52cca4['mediaType']=_0x3f08d4,_0x52cca4['season']=_0x18ab50,_0x52cca4[_0x251b1b(_0x270063._0x2b222d)]=_0x1bec07;const _0x5ec104=yield Promise['all'](PROVIDERS['map'](_0x2bd823=>fetchProviderStreams(_0x2bd823,_0x59080d,_0x3f08d4,_0x18ab50,_0x1bec07,_0x52cca4))),_0x19c1ab=new Set();return _0x5ec104['flat']()[_0x251b1b(0x1a8)](_0x48012f=>_0x48012f['url']&&!_0x19c1ab[_0x251b1b(0x1d0)](_0x48012f[_0x251b1b(0x1aa)])&&_0x19c1ab['add'](_0x48012f['url']));}catch(_0x3b1cd2){return[];}});}module[_0x4d63e8(0x1c1)]={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidlove", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "❤️ VidLove", "vidlove");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
