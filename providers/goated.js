// Imported provider: goated; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x1b33ca=_0x4039;(function(_0x3dd877,_0x49a873){const _0x32bbaf={_0x12a099:0xcb,_0x5253e2:0x104,_0x3cf4d7:0xde,_0x227641:0xdc,_0x4e2eff:0xf2,_0x35dc53:0xe3,_0x2d4fbe:0x101,_0x50643b:0xd2,_0x534f41:0x105},_0x2ff16f=_0x4039,_0x5375df=_0x3dd877();while(!![]){try{const _0x4d4a69=-parseInt(_0x2ff16f(_0x32bbaf._0x12a099))/0x1+parseInt(_0x2ff16f(_0x32bbaf._0x5253e2))/0x2*(parseInt(_0x2ff16f(_0x32bbaf._0x3cf4d7))/0x3)+-parseInt(_0x2ff16f(_0x32bbaf._0x227641))/0x4*(parseInt(_0x2ff16f(_0x32bbaf._0x4e2eff))/0x5)+-parseInt(_0x2ff16f(0xe6))/0x6+-parseInt(_0x2ff16f(0xc3))/0x7+-parseInt(_0x2ff16f(_0x32bbaf._0x35dc53))/0x8*(-parseInt(_0x2ff16f(_0x32bbaf._0x2d4fbe))/0x9)+-parseInt(_0x2ff16f(_0x32bbaf._0x50643b))/0xa*(-parseInt(_0x2ff16f(_0x32bbaf._0x534f41))/0xb);if(_0x4d4a69===_0x49a873)break;else _0x5375df['push'](_0x5375df['shift']());}catch(_0xca14bb){_0x5375df['push'](_0x5375df['shift']());}}}(_0x3353,0xb6d00));var __async=(_0x2da762,_0x229052,_0x21c18c)=>{return new Promise((_0x1ec922,_0x4f0593)=>{const _0x5d0142=_0x4039;var _0x1ee395=_0x163801=>{const _0x150794=_0x4039;try{_0xa01c7b(_0x21c18c[_0x150794(0xe1)](_0x163801));}catch(_0x2e6d1e){_0x4f0593(_0x2e6d1e);}},_0x998c48=_0x4a5ad3=>{const _0x4c4277=_0x4039;try{_0xa01c7b(_0x21c18c[_0x4c4277(0x108)](_0x4a5ad3));}catch(_0x16da00){_0x4f0593(_0x16da00);}},_0xa01c7b=_0x409b2f=>_0x409b2f['done']?_0x1ec922(_0x409b2f[_0x5d0142(0xea)]):Promise[_0x5d0142(0xfd)](_0x409b2f['value'])['then'](_0x1ee395,_0x998c48);_0xa01c7b((_0x21c18c=_0x21c18c['apply'](_0x2da762,_0x229052))['next']());});},TMDB_API_KEY='1865f43a0549ca50d341dd9ab8b29f49',DOMAINS_URL='https://raw.githubusercontent.com/sapariyaneel/nuvio-plugin/refs/heads/main/domains.json',FALLBACK_API_HOST='https://api.reallyfast.xyz',HEADERS={'User-Agent':'Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/131.0.0.0\x20Safari/537.36','Referer':'https://goated.cx/','Origin':'https://goated.cx'},cachedDomains=null;function getDomains(){return __async(this,null,function*(){if(cachedDomains)return cachedDomains;try{const _0x3aaf18=yield fetch(DOMAINS_URL,{'skipSizeCheck':!![]});cachedDomains=yield _0x3aaf18['json']();}catch(_0x1c0510){cachedDomains={};}return cachedDomains;});}function _0x3353(){const _0x46ed35=['Bg9N','zMXVB3i','Dgv4Da','mZiXmJm1CuzpCLLX','Dw5KzwzPBMvK','ndGW','Bw92Awu','ANnVBG','DhjPBq','DhzFCMvZDwX0CW','8j+oRca','mZyW','zMHK','Bw92AwvFCMvZDwX0CW','CMvZB2X2zq','C2XPy2u','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','8j+oNU+4JYbns1yGFcdINkGGsevwqYb8ipcFJQCGqufd','otLAz0Hbzvq','zMfPBgvKihrVigzLDgnOifbVvYbJAgfSBgvUz2u','vfLqrt1bvurjtW','ngHltKrezG','mJqYAePxEvPJ','p2fWAv9RzxK9','ChvZAa','DgHYB3C','CMvWzwf0','8j+mKcbhB2f0zwqGFcdWN5oLifDfqI1eta','C3vIDgL0BgvZ','zMLSDgvY','ndy2mdCXoxLzvgriuW','yxbWBgLJyxrPB24VANnVBG','i0vyvc1ylu1freLb','mJe2ma','z2v0u3rYzwfTCW','BgfIzwW','zxbPC29Kzq','CMvWBgfJzq','mtq3ntq3m2Thu2vtBa','C3rYAw5N','yxbPlNjLywXSEwzHC3qUEhL6','8j+sJIa3mJbW','y2HHCKnVzgvbDa','i0vyvc1ylvnuuKvbts1jtKy','CNvUDgLTzq','mtC5nda3mg10t1jgyq','Bwf0y2G','C3bSAxq','y2HHBgXLBMDL','DgL0Bgu','Dg9mB3DLCKnHC2u','vw5RBM93BG','BM9Uy2u','Bwf4','DxjS','otjpDhvTAwe','Aw5JBhvKzxm','mteWntyYtMjzBKDR','C3rHCNrZv2L0Aa','AgvPz2H0','BMv4Da','ihWGuW','mZG1nteYv21sAKf2','C3rYAw5NAwz5','8j+uPsaXmdGWCa','mta5nZGYmg9HwvbOrq','y2f0y2G','CgfKu3rHCNq','Dg9tDhjPBMC','DMfSDwu','mta4ma','DwHK','BgvUz3rO','iokaOIbnDwX0As1bDwrPBW'];_0x3353=function(){return _0x46ed35;};return _0x3353();}function _0x4039(_0xdc138f,_0x1a5cb5){_0xdc138f=_0xdc138f-0xc1;const _0x3353f2=_0x3353();let _0x403954=_0x3353f2[_0xdc138f];if(_0x4039['NScrCo']===undefined){var _0x46de1d=function(_0x5e5c91){const _0x18c7fd='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x2da762='',_0x229052='';for(let _0x21c18c=0x0,_0x1ec922,_0x4f0593,_0x1ee395=0x0;_0x4f0593=_0x5e5c91['charAt'](_0x1ee395++);~_0x4f0593&&(_0x1ec922=_0x21c18c%0x4?_0x1ec922*0x40+_0x4f0593:_0x4f0593,_0x21c18c++%0x4)?_0x2da762+=String['fromCharCode'](0xff&_0x1ec922>>(-0x2*_0x21c18c&0x6)):0x0){_0x4f0593=_0x18c7fd['indexOf'](_0x4f0593);}for(let _0x998c48=0x0,_0xa01c7b=_0x2da762['length'];_0x998c48<_0xa01c7b;_0x998c48++){_0x229052+='%'+('00'+_0x2da762['charCodeAt'](_0x998c48)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x229052);};_0x4039['HThdYZ']=_0x46de1d,_0x4039['VFFEba']={},_0x4039['NScrCo']=!![];}const _0x49525d=_0x3353f2[0x0],_0x2d3419=_0xdc138f+_0x49525d,_0x5c4292=_0x4039['VFFEba'][_0x2d3419];return!_0x5c4292?(_0x403954=_0x4039['HThdYZ'](_0x403954),_0x4039['VFFEba'][_0x2d3419]=_0x403954):_0x403954=_0x5c4292,_0x403954;}function getApiHost(){const _0x44c4f4={_0x58f4bf:0xca};return __async(this,null,function*(){const _0x36fead=_0x4039,_0x222abf=yield getDomains();return(_0x222abf['reallyfast']||_0x222abf[_0x36fead(0xcd)]||FALLBACK_API_HOST)[_0x36fead(_0x44c4f4._0x58f4bf)](/\/+$/,'');});}function getInvertedSortTag(_0x2a2c91,_0x474312=0xf423f){const _0x4fa28c={_0xb00424:0xda,_0x19ef76:0xd4},_0x2c6692=_0x4039,_0x131907=Math['max'](0x0,parseInt(_0x2a2c91,0xa)||0x0),_0x1eb81b=Math[_0x2c6692(_0x4fa28c._0xb00424)](0x0,_0x474312-_0x131907),_0x5f3333=_0x1eb81b['toString'](0x2)['padStart'](0x14,'0');return _0x5f3333[_0x2c6692(_0x4fa28c._0x19ef76)]('')['map'](_0x42e6ed=>_0x42e6ed==='1'?'\ufeff':'​')['join']('');}function getQualityRank(_0xf6dfe4){const _0x643af9={_0x569d45:0xdd,_0x4bb9e5:0xf4},_0x41ec4b=_0x4039,_0x3c0b13=String(_0xf6dfe4||'')['toLowerCase']();if(_0x3c0b13[_0x41ec4b(_0x643af9._0x569d45)](_0x41ec4b(0xc6))||_0x3c0b13[_0x41ec4b(0xdd)]('4k')||_0x3c0b13['includes']('uhd'))return 0x4;if(_0x3c0b13[_0x41ec4b(_0x643af9._0x569d45)](_0x41ec4b(0xeb))||_0x3c0b13[_0x41ec4b(0xdd)]('fhd')||_0x3c0b13['includes']('fullhd'))return 0x3;if(_0x3c0b13['includes']('720')||_0x3c0b13['includes']('hd'))return 0x2;if(_0x3c0b13['includes'](_0x41ec4b(_0x643af9._0x4bb9e5))||_0x3c0b13['includes']('sd')||_0x3c0b13['includes'](_0x41ec4b(0xfa)))return 0x1;return 0x0;}function parseSizeToMB(_0x25ae4f){const _0x59827d=_0x4039;if(!_0x25ae4f||_0x25ae4f==='N/A'||_0x25ae4f==='Unknown')return 0x0;const _0x32acbe=String(_0x25ae4f)['match'](/([\d.]+)\s*(GB|MB)/i);if(!_0x32acbe)return 0x0;const _0x8091d1=parseFloat(_0x32acbe[0x1]),_0xc67f30=_0x32acbe[0x2]['toUpperCase']();if(_0xc67f30==='GB')return Math[_0x59827d(0xf0)](_0x8091d1*0x400);if(_0xc67f30==='MB')return Math[_0x59827d(0xf0)](_0x8091d1);return 0x0;}function getResolutionEmoji(_0xa59730){const _0x8d1527={_0xa8c647:0xc6,_0x5731f2:0xdd,_0x5a5a2f:0xec,_0x5317b2:0xfb},_0x192cec=_0x4039,_0x10cc83=String(_0xa59730||'')[_0x192cec(0xd7)]();if(_0x10cc83['includes'](_0x192cec(_0x8d1527._0xa8c647))||_0x10cc83['includes']('4k')||_0x10cc83[_0x192cec(_0x8d1527._0x5731f2)](_0x192cec(_0x8d1527._0x5a5a2f)))return'🌟\x204K';if(_0x10cc83['includes']('1080')||_0x10cc83[_0x192cec(_0x8d1527._0x5731f2)](_0x192cec(_0x8d1527._0x5317b2)))return _0x192cec(0xe5);if(_0x10cc83['includes']('720')||_0x10cc83['includes']('hd'))return _0x192cec(0xce);if(_0x10cc83['includes'](_0x192cec(0xf4))||_0x10cc83['includes']('sd'))return'📱\x20480p';return'📺\x20'+(_0xa59730||'1080p');}var SHA256_K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0xfc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x6ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];function utf8Bytes(_0x28d05d){const _0x20ea15={_0x2e56a1:0xcf,_0x1a1f23:0x107,_0x55250b:0x107},_0x43fca=_0x4039,_0x293749=[];for(let _0x138b53=0x0;_0x138b53<_0x28d05d['length'];_0x138b53++){const _0x582021=_0x28d05d[_0x43fca(_0x20ea15._0x2e56a1)](_0x138b53);if(_0x582021<0x80)_0x293749[_0x43fca(0x107)](_0x582021);else{if(_0x582021<0x800)_0x293749['push'](0xc0|_0x582021>>0x6,0x80|_0x582021&0x3f);else{if(_0x582021>=0xd800&&_0x582021<=0xdbff&&_0x138b53+0x1<_0x28d05d[_0x43fca(0xed)]){const _0x3b1f48=_0x28d05d['charCodeAt'](_0x138b53+0x1);if(_0x3b1f48>=0xdc00&&_0x3b1f48<=0xdfff){const _0x53401b=0x10000+(_0x582021-0xd800<<0xa)+(_0x3b1f48-0xdc00);_0x293749[_0x43fca(_0x20ea15._0x1a1f23)](0xf0|_0x53401b>>0x12,0x80|_0x53401b>>0xc&0x3f,0x80|_0x53401b>>0x6&0x3f,0x80|_0x53401b&0x3f),_0x138b53++;}else _0x293749[_0x43fca(0x107)](0xe0|_0x582021>>0xc,0x80|_0x582021>>0x6&0x3f,0x80|_0x582021&0x3f);}else _0x293749[_0x43fca(_0x20ea15._0x55250b)](0xe0|_0x582021>>0xc,0x80|_0x582021>>0x6&0x3f,0x80|_0x582021&0x3f);}}}return _0x293749;}function sha256Hex(_0x29450a){const _0x27f4b7={_0x17f783:0xed,_0xb86f67:0x107,_0x3efde0:0xf0},_0x4d4751=_0x4039,_0x203c83=utf8Bytes(_0x29450a),_0x49e7b4=_0x203c83[_0x4d4751(_0x27f4b7._0x17f783)]*0x8;_0x203c83[_0x4d4751(0x107)](0x80);while(_0x203c83[_0x4d4751(_0x27f4b7._0x17f783)]%0x40!==0x38)_0x203c83[_0x4d4751(_0x27f4b7._0xb86f67)](0x0);const _0x4ec930=Math[_0x4d4751(_0x27f4b7._0x3efde0)](_0x49e7b4/0x100000000);_0x203c83['push'](_0x4ec930>>>0x18&0xff,_0x4ec930>>>0x10&0xff,_0x4ec930>>>0x8&0xff,_0x4ec930&0xff),_0x203c83[_0x4d4751(0x107)](_0x49e7b4>>>0x18&0xff,_0x49e7b4>>>0x10&0xff,_0x49e7b4>>>0x8&0xff,_0x49e7b4&0xff);let _0x309b64=0x6a09e667,_0x4a1cc5=0xbb67ae85,_0x5937e2=0x3c6ef372,_0x35a6e7=0xa54ff53a,_0x2cdec8=0x510e527f,_0x45c5b4=0x9b05688c,_0x4b573b=0x1f83d9ab,_0x43dc07=0x5be0cd19;const _0x43a875=new Array(0x40);for(let _0x441e87=0x0;_0x441e87<_0x203c83[_0x4d4751(0xed)];_0x441e87+=0x40){for(let _0x29b79a=0x0;_0x29b79a<0x10;_0x29b79a++){const _0x3d1336=_0x441e87+_0x29b79a*0x4;_0x43a875[_0x29b79a]=(_0x203c83[_0x3d1336]<<0x18|_0x203c83[_0x3d1336+0x1]<<0x10|_0x203c83[_0x3d1336+0x2]<<0x8|_0x203c83[_0x3d1336+0x3])>>>0x0;}for(let _0x5c542e=0x10;_0x5c542e<0x40;_0x5c542e++){const _0x260146=_0x43a875[_0x5c542e-0xf],_0x4ab913=_0x43a875[_0x5c542e-0x2],_0x3b8a79=((_0x260146>>>0x7|_0x260146<<0x19)^(_0x260146>>>0x12|_0x260146<<0xe)^_0x260146>>>0x3)>>>0x0,_0x569a36=((_0x4ab913>>>0x11|_0x4ab913<<0xf)^(_0x4ab913>>>0x13|_0x4ab913<<0xd)^_0x4ab913>>>0xa)>>>0x0;_0x43a875[_0x5c542e]=(_0x43a875[_0x5c542e-0x10]+_0x3b8a79>>>0x0)+(_0x43a875[_0x5c542e-0x7]+_0x569a36>>>0x0)>>>0x0;}let _0x18c026=_0x309b64,_0x14b527=_0x4a1cc5,_0x571622=_0x5937e2,_0xd74bdd=_0x35a6e7,_0x25b40c=_0x2cdec8,_0x4778b4=_0x45c5b4,_0x4b108b=_0x4b573b,_0x3df590=_0x43dc07;for(let _0x3d409c=0x0;_0x3d409c<0x40;_0x3d409c++){const _0x79b514=((_0x25b40c>>>0x6|_0x25b40c<<0x1a)^(_0x25b40c>>>0xb|_0x25b40c<<0x15)^(_0x25b40c>>>0x19|_0x25b40c<<0x7))>>>0x0,_0x24fef=(_0x25b40c&_0x4778b4^~_0x25b40c&_0x4b108b)>>>0x0,_0x1e38b3=((_0x3df590+_0x79b514>>>0x0)+_0x24fef>>>0x0)+(SHA256_K[_0x3d409c]+_0x43a875[_0x3d409c]>>>0x0)>>>0x0,_0x37f98d=((_0x18c026>>>0x2|_0x18c026<<0x1e)^(_0x18c026>>>0xd|_0x18c026<<0x13)^(_0x18c026>>>0x16|_0x18c026<<0xa))>>>0x0,_0x18659c=(_0x18c026&_0x14b527^_0x18c026&_0x571622^_0x14b527&_0x571622)>>>0x0,_0x2cf4e5=_0x37f98d+_0x18659c>>>0x0;_0x3df590=_0x4b108b,_0x4b108b=_0x4778b4,_0x4778b4=_0x25b40c,_0x25b40c=_0xd74bdd+_0x1e38b3>>>0x0,_0xd74bdd=_0x571622,_0x571622=_0x14b527,_0x14b527=_0x18c026,_0x18c026=_0x1e38b3+_0x2cf4e5>>>0x0;}_0x309b64=_0x309b64+_0x18c026>>>0x0,_0x4a1cc5=_0x4a1cc5+_0x14b527>>>0x0,_0x5937e2=_0x5937e2+_0x571622>>>0x0,_0x35a6e7=_0x35a6e7+_0xd74bdd>>>0x0,_0x2cdec8=_0x2cdec8+_0x25b40c>>>0x0,_0x45c5b4=_0x45c5b4+_0x4778b4>>>0x0,_0x4b573b=_0x4b573b+_0x4b108b>>>0x0,_0x43dc07=_0x43dc07+_0x3df590>>>0x0;}const _0x34e985=[_0x309b64,_0x4a1cc5,_0x5937e2,_0x35a6e7,_0x2cdec8,_0x45c5b4,_0x4b573b,_0x43dc07];let _0x17cb7d='';for(const _0x7d5b4b of _0x34e985)_0x17cb7d+=('00000000'+_0x7d5b4b[_0x4d4751(0xe9)](0x10))[_0x4d4751(0xfe)](-0x8);return _0x17cb7d;}function solveProofOfWork(_0x22aa33){const _0x51daec={_0x20e18e:0xf6,_0x11a15f:0xdf};return __async(this,null,function*(){const _0x5c2dab=_0x4039,_0x3a9590=yield fetch(_0x22aa33+'/api/challenge',{'skipSizeCheck':!![]});if(!_0x3a9590['ok'])throw new Error(_0x5c2dab(0x102));const {challenge:_0x41f147,difficulty:_0x31b6cd}=yield _0x3a9590[_0x5c2dab(_0x51daec._0x20e18e)](),_0xd9180a='0'[_0x5c2dab(0x109)](_0x31b6cd);for(let _0x430bbb=0x0;_0x430bbb<0x4c4b40;_0x430bbb++){const _0x81efe5=sha256Hex(_0x41f147+_0x430bbb);if(_0x81efe5[_0x5c2dab(_0x51daec._0x11a15f)](_0xd9180a))return{'challenge':_0x41f147,'nonce':String(_0x430bbb)};}throw new Error('PoW\x20solve\x20timed\x20out');});}function getTmdbRuntimeSeconds(_0x56d92a,_0x41d176,_0x56c288,_0x39bda7){const _0x536991={_0x4d9a4d:0x106};return __async(this,null,function*(){const _0x375f30=_0x4039;var _0x19086a;try{const _0x4048fc=_0x41d176==='tv'?'https://api.themoviedb.org/3/tv/'+_0x56d92a+'/season/'+(_0x56c288||0x1)+'/episode/'+(_0x39bda7||0x1)+'?api_key='+TMDB_API_KEY:'https://api.themoviedb.org/3/movie/'+_0x56d92a+_0x375f30(_0x536991._0x4d9a4d)+TMDB_API_KEY,_0xc2ef09=yield fetch(_0x4048fc,{'skipSizeCheck':!![]});if(!_0xc2ef09['ok'])return null;const _0x368457=yield _0xc2ef09[_0x375f30(0xf6)](),_0xb02698=_0x368457[_0x375f30(0xd1)]||((_0x19086a=_0x368457['episode_run_time'])==null?void 0x0:_0x19086a[0x0]);return _0xb02698?_0xb02698*0x3c:null;}catch(_0x3c1c06){return null;}});}function getTmdbMetadata(_0x153468,_0x1d02d5){const _0x2d445b={_0x1bfb95:0xf5};return __async(this,null,function*(){const _0x9d440b=_0x4039;try{const _0x5c723b=_0x1d02d5==='tv'?'tv':_0x9d440b(_0x2d445b._0x1bfb95),_0x5a60be=yield fetch(_0x9d440b(0xff)+_0x5c723b+'/'+_0x153468+'?api_key='+TMDB_API_KEY,{'skipSizeCheck':!![]}),_0x59fa4a=yield _0x5a60be['json'](),_0x15f145=_0x5c723b==='tv'?_0x59fa4a['name']:_0x59fa4a[_0x9d440b(0xd6)],_0x4c001a=_0x5c723b==='tv'?_0x59fa4a['first_air_date']:_0x59fa4a['release_date'],_0x362030=_0x4c001a?_0x4c001a['split']('-')[0x0]:'';return{'title':_0x15f145,'year':_0x362030};}catch(_0x1ba5a8){return{'title':'','year':''};}});}function formatBytes(_0x34a642){const _0x2b746e={_0x15f47a:0xf0},_0x36ccad=_0x4039;if(!_0x34a642)return'Unknown';const _0x1d08ce=0x400,_0x37a350=['Bytes','KB','MB','GB','TB'],_0xe08084=Math[_0x36ccad(_0x2b746e._0x15f47a)](Math['log'](_0x34a642)/Math[_0x36ccad(0xef)](_0x1d08ce));return parseFloat((_0x34a642/Math['pow'](_0x1d08ce,_0xe08084))['toFixed'](0x2))+'\x20'+_0x37a350[_0xe08084];}function resolveUrl(_0x5332c2,_0x7ad0a5){try{return new URL(_0x5332c2,_0x7ad0a5)['toString']();}catch(_0x13094f){return _0x5332c2;}}function parseMasterPlaylist(_0x1b89b7,_0x2666ba){const _0x3448c7={_0x271b9c:0xd4,_0x3a128b:0xed,_0x498692:0xdf,_0x217acc:0xc5,_0x3bb16b:0xdf,_0x4dbde8:0xd0},_0x757f44=_0x4039,_0x44ad1c=_0x1b89b7[_0x757f44(_0x3448c7._0x271b9c)]('\x0a')['map'](_0x34c335=>_0x34c335['trim']()),_0x12c380=[];let _0x16deba=null;for(let _0x4adb57=0x0;_0x4adb57<_0x44ad1c[_0x757f44(_0x3448c7._0x3a128b)];_0x4adb57++){if(_0x44ad1c[_0x4adb57][_0x757f44(_0x3448c7._0x498692)](_0x757f44(_0x3448c7._0x217acc))&&_0x44ad1c[_0x4adb57]['includes'](_0x757f44(0x103))&&!_0x16deba){const _0x21bb41=_0x44ad1c[_0x4adb57][_0x757f44(0xd3)](/URI="([^"]+)"/),_0x2c75c8=/DEFAULT=YES/['test'](_0x44ad1c[_0x4adb57]);if(_0x21bb41&&(_0x2c75c8||!_0x16deba))_0x16deba=resolveUrl(_0x21bb41[0x1],_0x2666ba);continue;}if(!_0x44ad1c[_0x4adb57][_0x757f44(_0x3448c7._0x3bb16b)](_0x757f44(_0x3448c7._0x4dbde8)))continue;const _0xfcb2eb=_0x44ad1c[_0x4adb57],_0x563f1c=_0x44ad1c[_0x4adb57+0x1];if(!_0x563f1c||_0x563f1c['startsWith']('#'))continue;const _0x50c42f=_0xfcb2eb['match'](/BANDWIDTH=(\d+)/),_0x356750=_0xfcb2eb['match'](/RESOLUTION=(\d+)x(\d+)/),_0x306c0b=_0x50c42f?parseInt(_0x50c42f[0x1],0xa):0x0,_0x5596d2=_0x356750?parseInt(_0x356750[0x2],0xa):0x0;_0x12c380[_0x757f44(0x107)]({'url':resolveUrl(_0x563f1c,_0x2666ba),'bandwidth':_0x306c0b,'height':_0x5596d2});}return{'variants':_0x12c380,'defaultAudioUrl':_0x16deba};}function getAudioBitrateBps(_0x38a0a4){return __async(this,null,function*(){const _0x598107=_0x4039;if(!_0x38a0a4)return 0x0;try{const _0x408456=yield(yield fetch(_0x38a0a4,{'skipSizeCheck':!![]}))[_0x598107(0xf1)](),_0x1480cf=_0x408456[_0x598107(0xd3)](/#EXT-X-BITRATE:(\d+)/);return _0x1480cf?parseInt(_0x1480cf[0x1],0xa)*0x3e8:0x0;}catch(_0x53942d){return 0x0;}});}function qualityLabelFromHeight(_0x1ce66f){const _0x3dbffd={_0x584090:0xd8},_0x143545=_0x4039;if(_0x1ce66f>=0x7d0)return'4K';if(_0x1ce66f<=0x0)return _0x143545(_0x3dbffd._0x584090);return _0x1ce66f+'p';}function makeStream(_0x1c3be6,_0x1709c4,_0x49a2b6,_0x175c9f,_0x5677d7,_0x4d1a90,_0x20c0aa,_0x3f5d3b,_0x1b7b38){const _0x1b24b6={_0xa61978:0xe2,_0x2c4a2c:0x100,_0xf2e5b4:0xee},_0x4b978f=_0x4039,_0x246b8f=getQualityRank(_0x1709c4),_0x1e97fa=parseSizeToMB(_0x49a2b6),_0x58de96=getInvertedSortTag(_0x246b8f*0x186a0+_0x1e97fa,0xf423f),_0x10ab98=getResolutionEmoji(_0x1709c4),_0x2012d9=(_0x175c9f||'')['replace'](/[^a-zA-Z0-9]/g,'.'),_0x12ce7c=_0x4d1a90==='tv',_0x3e4a6c=_0x20c0aa||0x1,_0x1d95a3=_0x3f5d3b||0x1,_0x5b5af4=_0x12ce7c?_0x2012d9+'.S'+String(_0x3e4a6c)[_0x4b978f(0xe8)](0x2,'0')+'E'+String(_0x1d95a3)[_0x4b978f(0xe8)](0x2,'0')+'.'+_0x1709c4+'.WEB-DL.Multi-Audio.HEVC.AAC.MKV.MSubs':_0x2012d9+'.'+(_0x5677d7||'2026')+'.'+_0x1709c4+'.WEB-DL.Multi-Audio.HEVC.AAC.MKV.MSubs',_0x4ecb79=_0x12ce7c?_0x4b978f(0xf9)+_0x175c9f+(_0x5677d7?'\x20('+_0x5677d7+')':'')+_0x4b978f(_0x1b24b6._0xa61978)+_0x3e4a6c+'E'+_0x1d95a3:'🎬\x20'+_0x175c9f+(_0x5677d7?'\x20('+_0x5677d7+')':''),_0x12b1ea=_0x10ab98+'\x20|\x20🗣️\x20Multi-Audio\x20|\x20💾\x20'+_0x49a2b6,_0x477f1f=_0x4b978f(_0x1b24b6._0x2c4a2c),_0x5094b8=_0x4b978f(0x10a),_0x515db0=_0x5b5af4,_0x48dc65=_0x58de96+'Goated\x20•\x20'+_0x1709c4+_0x4b978f(_0x1b24b6._0xf2e5b4),_0x4b15e1=[_0x4ecb79,_0x12b1ea,_0x477f1f,_0x5094b8,_0x515db0]['join']('\x0a');return{'qualityRank':_0x246b8f,'sizeInMB':_0x1e97fa,'data':{'name':_0x48dc65,'title':_0x4b15e1,'size':_0x4b15e1,'description':_0x4b15e1,'url':_0x1c3be6,'headers':HEADERS,'subtitles':_0x1b7b38,'behaviorHints':{'notWebReady':!![],'proxyHeaders':{'request':HEADERS}}}};}function getStreams(_0x2803da,_0x170db3,_0x40fb51,_0x166df6){const _0x4908a4={_0x144f4e:0xcc,_0x406212:0x106,_0x53cc0c:0xd9,_0x35ca18:0xe7,_0x45f55b:0xdb,_0x4ac7c4:0xc4,_0x3d31bc:0xf6,_0x16621d:0xc1};return __async(this,null,function*(){const _0x2fb004=_0x4039;try{let _0xb5d15a=_0x2803da;if(typeof _0x2803da===_0x2fb004(_0x4908a4._0x144f4e)&&_0x2803da[_0x2fb004(0xf7)]()['toLowerCase']()['startsWith']('tt')){const _0x25b574='https://api.themoviedb.org/3/find/'+_0x2803da+_0x2fb004(_0x4908a4._0x406212)+TMDB_API_KEY+'&external_source=imdb_id',_0x585cf4=yield(yield fetch(_0x25b574,{'skipSizeCheck':!![]}))['json'](),_0x4161c3=_0x170db3==='tv'?_0x585cf4[_0x2fb004(0xf8)]:_0x585cf4[_0x2fb004(0xfc)];_0xb5d15a=_0x4161c3&&_0x4161c3['length']?_0x4161c3[0x0]['id']:null;if(!_0xb5d15a)return[];}_0xb5d15a=parseInt(_0xb5d15a,0xa);if(!_0xb5d15a)return[];const {title:_0x50243c,year:_0x43c633}=yield getTmdbMetadata(_0xb5d15a,_0x170db3),_0x551964=yield getApiHost(),_0x3441f0=_0x170db3==='tv',_0xba2656=yield solveProofOfWork(_0x551964),_0x29bf91={'mediaType':_0x3441f0?'tv':_0x2fb004(0xf5),'id':String(_0xb5d15a),'challenge':_0xba2656[_0x2fb004(0xd5)],'nonce':_0xba2656[_0x2fb004(_0x4908a4._0x53cc0c)]};_0x3441f0&&(_0x29bf91['season']=_0x40fb51||0x1,_0x29bf91[_0x2fb004(0xc9)]=_0x166df6||0x1);const _0x18f532=yield fetch(_0x551964+'/api/resolve',{'method':'POST','headers':{'Content-Type':_0x2fb004(0xc4)},'body':JSON['stringify'](_0x29bf91),'skipSizeCheck':!![]});if(!_0x18f532['ok'])return[];const _0x3b8073=yield _0x18f532[_0x2fb004(0xf6)]()[_0x2fb004(_0x4908a4._0x35ca18)](()=>null);if(!_0x3b8073||!_0x3b8073[_0x2fb004(_0x4908a4._0x45f55b)])return[];const _0x48487b=yield fetch(_0x3b8073[_0x2fb004(0xdb)],{'skipSizeCheck':!![]});if(!_0x48487b['ok'])return[];const _0x521b11=yield _0x48487b[_0x2fb004(0xf1)](),{variants:_0x61ce58,defaultAudioUrl:_0x492a71}=parseMasterPlaylist(_0x521b11,_0x3b8073['url']);if(!_0x61ce58['length'])return[];const _0x38d4ad=_0x61ce58['slice']()['sort']((_0x27f93a,_0x1253e0)=>_0x1253e0['height']-_0x27f93a[_0x2fb004(0xe0)])[0x0],[_0x294a70,_0x5820c6]=yield Promise['all']([getTmdbRuntimeSeconds(_0xb5d15a,_0x170db3,_0x40fb51,_0x166df6),getAudioBitrateBps(_0x492a71)]);let _0x5c2976=[];try{const _0x11b244=yield solveProofOfWork(_0x551964),_0x39e5fc={'mediaType':_0x3441f0?'tv':'movie','id':String(_0xb5d15a),'challenge':_0x11b244['challenge'],'nonce':_0x11b244['nonce']};_0x3441f0&&(_0x39e5fc['season']=_0x40fb51||0x1,_0x39e5fc['episode']=_0x166df6||0x1);const _0x2e770c=yield fetch(_0x551964+'/api/subtitles',{'method':'POST','headers':{'Content-Type':_0x2fb004(_0x4908a4._0x4ac7c4)},'body':JSON[_0x2fb004(0xe4)](_0x39e5fc),'skipSizeCheck':!![]});if(_0x2e770c['ok']){const _0x49bd95=yield _0x2e770c[_0x2fb004(_0x4908a4._0x3d31bc)]()['catch'](()=>null);_0x5c2976=(_0x49bd95&&_0x49bd95[_0x2fb004(_0x4908a4._0x16621d)]||[])[_0x2fb004(0xc2)](_0x2f036c=>_0x2f036c&&_0x2f036c['url'])['map'](_0x524a68=>({'url':_0x524a68['url'],'lang':_0x524a68[_0x2fb004(0xc8)]||_0x524a68['language']||_0x2fb004(0xd8)}));}}catch(_0x195de1){}const _0x2b8227=_0x38d4ad['bandwidth']+_0x5820c6,_0x352221=qualityLabelFromHeight(_0x38d4ad[_0x2fb004(0xe0)]),_0x44b834=_0x294a70?formatBytes(_0x2b8227*_0x294a70/0x8):'Unknown',_0x2851b0=makeStream(_0x3b8073['url'],_0x352221,_0x44b834,_0x50243c||'Unknown\x20Title',_0x43c633||'2026',_0x170db3,_0x40fb51,_0x166df6,_0x5c2976);return[_0x2851b0['data']];}catch(_0x1f702a){return console['error']('[Goated]',_0x1f702a),[];}});}typeof module!==_0x1b33ca(0xf3)&&module['exports']?module['exports']={'getStreams':getStreams}:global[_0x1b33ca(0xc7)]=getStreams;

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "goated", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "🐐 Goated", "goated");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
