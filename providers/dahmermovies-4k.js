// Imported provider: dahmermovies-tv; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x2d04b7=_0x496e;(function(_0x5076a3,_0x39fd72){const _0x12f68b=_0x496e,_0x39212e=_0x5076a3();while(!![]){try{const _0x403b05=-parseInt(_0x12f68b(0x176))/0x1+-parseInt(_0x12f68b(0x159))/0x2+parseInt(_0x12f68b(0x151))/0x3*(-parseInt(_0x12f68b(0x164))/0x4)+-parseInt(_0x12f68b(0x148))/0x5+parseInt(_0x12f68b(0x145))/0x6*(-parseInt(_0x12f68b(0x144))/0x7)+parseInt(_0x12f68b(0x177))/0x8+parseInt(_0x12f68b(0x170))/0x9;if(_0x403b05===_0x39fd72)break;else _0x39212e['push'](_0x39212e['shift']());}catch(_0x555243){_0x39212e['push'](_0x39212e['shift']());}}}(_0x39aa,0x286b8));var __async=(_0x3b000f,_0x6b952b,_0x285023)=>{return new Promise((_0x4983ee,_0xc561fb)=>{const _0x387399=_0x496e;var _0x51942c=_0x6d4c8c=>{const _0x4b04c8=_0x496e;try{_0x2ad414(_0x285023[_0x4b04c8(0x16f)](_0x6d4c8c));}catch(_0x203eba){_0xc561fb(_0x203eba);}},_0x18eb73=_0x383366=>{const _0x59aa14=_0x496e;try{_0x2ad414(_0x285023[_0x59aa14(0x158)](_0x383366));}catch(_0xe29812){_0xc561fb(_0xe29812);}},_0x2ad414=_0x291a99=>_0x291a99[_0x387399(0x14a)]?_0x4983ee(_0x291a99[_0x387399(0x153)]):Promise['resolve'](_0x291a99['value'])[_0x387399(0x15b)](_0x51942c,_0x18eb73);_0x2ad414((_0x285023=_0x285023[_0x387399(0x171)](_0x3b000f,_0x6b952b))[_0x387399(0x16f)]());});};console[_0x2d04b7(0x14d)](_0x2d04b7(0x15d));var TMDB_API_KEY=_0x2d04b7(0x14e),DAHMER_MOVIES_API=_0x2d04b7(0x165);function makeRequest(_0x30119a){return __async(this,null,function*(){const _0xa81022=_0x496e;try{return yield fetch(_0x30119a,{'headers':{'User-Agent':_0xa81022(0x163)}});}catch(_0x3c2474){return{'ok':![]};}});}function resolveFinalUrl(_0x627e34){return __async(this,null,function*(){const _0x6078ab=_0x496e;let _0x3fb108=_0x627e34;_0x627e34[_0x6078ab(0x149)](_0x6078ab(0x154))&&(_0x3fb108=decodeURIComponent(_0x627e34[_0x6078ab(0x16e)]('u=')[0x1]));try{const _0x3bf089=yield fetch(_0x3fb108,{'method':_0x6078ab(0x14c),'redirect':_0x6078ab(0x15e),'headers':{'User-Agent':_0x6078ab(0x174),'Referer':DAHMER_MOVIES_API+'/'}});return _0x3bf089[_0x6078ab(0x15c)];}catch(_0xb659b3){return _0x3fb108;}});}function parseLinks(_0x26f757){const _0x19ef35=_0x2d04b7,_0x5eb3f4=[],_0x51fc2a=new RegExp(_0x19ef35(0x152),'gis');let _0x169d05;while((_0x169d05=_0x51fc2a[_0x19ef35(0x16a)](_0x26f757))!==null){const _0x39826c=_0x169d05[0x1],_0x51945a=_0x39826c[_0x19ef35(0x17a)](/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);if(_0x51945a){const _0x3d7834=_0x51945a[0x1],_0x20c39e=_0x51945a[0x2][_0x19ef35(0x155)]();_0x20c39e&&_0x3d7834!==_0x19ef35(0x167)&&/\.(mkv|mp4|avi|webm)$/i['test'](_0x20c39e)&&_0x5eb3f4['push']({'text':_0x20c39e,'href':_0x3d7834});}}return _0x5eb3f4;}function invokeDahmerMovies(_0x192091,_0xd66db5,_0x494e3e=null,_0x5a3aa2=null){return __async(this,null,function*(){const _0x24af47=_0x496e,_0x1f47e4=_0x192091[_0x24af47(0x166)](/:/g,''),_0x337327=_0x494e3e!==null?[_0x24af47(0x15a)+encodeURIComponent(_0x1f47e4)+_0x24af47(0x15f)+(_0x494e3e<0xa?'0'+_0x494e3e:_0x494e3e)+'/','/tvs/'+encodeURIComponent(_0x1f47e4)+_0x24af47(0x15f)+_0x494e3e+'/']:['/movies/'+encodeURIComponent(_0x1f47e4+'\x20('+_0xd66db5+')')+'/'];let _0x515d71='',_0x664bb5='';for(const _0x132250 of _0x337327){const _0x2bb293=DAHMER_MOVIES_API+_0x132250,_0x397254=yield makeRequest(_0x2bb293);if(_0x397254['ok']){_0x515d71=yield _0x397254[_0x24af47(0x156)](),_0x664bb5=_0x2bb293;break;}}if(!_0x515d71)return[];const _0x11d018=parseLinks(_0x515d71);let _0x777c46=_0x11d018;if(_0x494e3e!==null&&_0x5a3aa2!==null){const _0x1cf256=_0x5a3aa2<0xa?'0'+_0x5a3aa2:_0x5a3aa2,_0x3bbd1a=new RegExp('E'+_0x1cf256+'|E'+_0x5a3aa2,'i');_0x777c46=_0x11d018[_0x24af47(0x16d)](_0x2f6fd5=>_0x3bbd1a['test'](_0x2f6fd5[_0x24af47(0x156)]));}const _0x26a508=_0x777c46['sort']((_0x419f63,_0x31c5b6)=>{const _0x1a5cad=_0x24af47,_0x40fb2c=/2160p|4k/i['test'](_0x419f63[_0x1a5cad(0x156)]),_0x342460=/2160p|4k/i[_0x1a5cad(0x169)](_0x31c5b6[_0x1a5cad(0x156)]);return _0x342460-_0x40fb2c;}),_0x9bc5c9=[];for(const _0x592ff6 of _0x26a508[_0x24af47(0x175)](0x0,0x5)){let _0x280393;if(_0x592ff6['href'][_0x24af47(0x168)]('http'))_0x280393=_0x592ff6[_0x24af47(0x14b)];else _0x592ff6[_0x24af47(0x14b)][_0x24af47(0x149)](_0x24af47(0x17b))||_0x592ff6[_0x24af47(0x14b)][_0x24af47(0x149)](_0x24af47(0x15a))?_0x280393=DAHMER_MOVIES_API+(_0x592ff6[_0x24af47(0x14b)][_0x24af47(0x168)]('/')?'':'/')+_0x592ff6[_0x24af47(0x14b)]:_0x280393=_0x664bb5+_0x592ff6['href'];_0x280393=_0x280393[_0x24af47(0x166)](/([^:]\/)\/+/g,'$1');const _0x46f628=yield resolveFinalUrl(_0x280393);_0x9bc5c9[_0x24af47(0x162)]({'name':_0x24af47(0x146),'title':_0x592ff6['text'],'url':_0x46f628,'quality':/2160p|4k/i[_0x24af47(0x169)](_0x592ff6['text'])?_0x24af47(0x17c):_0x24af47(0x147),'headers':{'User-Agent':_0x24af47(0x174),'Referer':DAHMER_MOVIES_API+'/','Range':_0x24af47(0x150)},'provider':_0x24af47(0x178)});}return _0x9bc5c9;});}function _0x496e(_0x50604e,_0xc1f6bb){_0x50604e=_0x50604e-0x144;const _0x39aa64=_0x39aa();let _0x496e7c=_0x39aa64[_0x50604e];if(_0x496e['DVuJgC']===undefined){var _0x5d39d7=function(_0x3663ff){const _0x1a3d11='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x3b000f='',_0x6b952b='';for(let _0x285023=0x0,_0x4983ee,_0xc561fb,_0x51942c=0x0;_0xc561fb=_0x3663ff['charAt'](_0x51942c++);~_0xc561fb&&(_0x4983ee=_0x285023%0x4?_0x4983ee*0x40+_0xc561fb:_0xc561fb,_0x285023++%0x4)?_0x3b000f+=String['fromCharCode'](0xff&_0x4983ee>>(-0x2*_0x285023&0x6)):0x0){_0xc561fb=_0x1a3d11['indexOf'](_0xc561fb);}for(let _0x18eb73=0x0,_0x2ad414=_0x3b000f['length'];_0x18eb73<_0x2ad414;_0x18eb73++){_0x6b952b+='%'+('00'+_0x3b000f['charCodeAt'](_0x18eb73)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x6b952b);};_0x496e['ModTYJ']=_0x5d39d7,_0x496e['OzmMUG']={},_0x496e['DVuJgC']=!![];}const _0x561694=_0x39aa64[0x0],_0x25d3ae=_0x50604e+_0x561694,_0x344d51=_0x496e['OzmMUG'][_0x25d3ae];return!_0x344d51?(_0x496e7c=_0x496e['ModTYJ'](_0x496e7c),_0x496e['OzmMUG'][_0x25d3ae]=_0x496e7c):_0x496e7c=_0x344d51,_0x496e7c;}function getStreams(_0x1e74c7,_0x4e7a14='movie',_0x479f09=null,_0x21c0c7=null){return __async(this,null,function*(){const _0x46a367=_0x496e;var _0x2ae1e9;try{const _0x2ce8eb=_0x4e7a14==='tv'?'tv':_0x46a367(0x172),_0x10adb0='https://api.themoviedb.org/3/'+_0x2ce8eb+'/'+_0x1e74c7+_0x46a367(0x16b)+TMDB_API_KEY,_0x55b796=yield makeRequest(_0x10adb0),_0x1fc166=yield _0x55b796[_0x46a367(0x14f)](),_0x4720c9=_0x4e7a14==='tv'?_0x1fc166['name']:_0x1fc166[_0x46a367(0x173)],_0x5989ac=(_0x2ae1e9=_0x4e7a14==='tv'?_0x1fc166[_0x46a367(0x157)]:_0x1fc166['release_date'])==null?void 0x0:_0x2ae1e9[_0x46a367(0x160)](0x0,0x4);if(!_0x4720c9)return[];return yield invokeDahmerMovies(_0x4720c9,_0x5989ac,_0x479f09,_0x21c0c7);}catch(_0x3e51b0){return[];}});}function _0x39aa(){const _0x5200e5=['Bwf0y2G','l21VDMLLCY8','mJe2mha','mtr5rhfHrhC','ndq4nJy4yKDNu1vt','rgfOBwvYtw92AwvZ','mta4mha','mti0nZu2me5izLDcAa','Aw5JBhvKzxm','zg9Uzq','AhjLzG','sevbra','Bg9N','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','ANnVBG','yNL0zxm9mc0','nJbtEgv2zuq','phrYw14+xsO+kc4QpYK8xc90CJ4','DMfSDwu','l2j1BgS/Dt0','DhjPBq','Dgv4Da','zMLYC3rFywLYx2rHDgu','DgHYB3C','ntuZntiYDNLoyvLm','l3r2CY8','DgHLBG','DxjS','w0rHAg1LCK1VDMLLC10Gsw5PDgLHBgL6Aw5NifnJCMfWzxi','zM9SBg93','l1nLyxnVBIuYma','C3vIC3rYAw5N','z2v0u3rYzwfTCW','ChvZAa','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2','mty0mJrwvNjHtwK','Ahr0Chm6lY9HlJeXmtq3nY54ExO','CMvWBgfJzq','lI4V','C3rHCNrZv2L0Aa','DgvZDa','zxHLyW','p2fWAv9RzxK9','Dw5KzwzPBMvK','zMLSDgvY','C3bSAxq','BMv4Da','odyYoty1mhHQvxvqCa','yxbWBhK','Bw92Awu','DgL0Bgu','tw96AwXSys81lJaGkefUzhjVAwqPiev4B1bSyxLLCG','C2XPy2u','mtu1otG5ru1fuwDR','oty1mtG0u3zfCMXK','zgfOBwvYBw92AwvZ','zxHWB3j0CW'];_0x39aa=function(){return _0x5200e5;};return _0x39aa();}if(typeof module!==_0x2d04b7(0x16c))module[_0x2d04b7(0x179)]={'getStreams':getStreams};else global[_0x2d04b7(0x161)]=getStreams;
/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "dahmermovies-tv", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
