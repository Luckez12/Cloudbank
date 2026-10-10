// Imported provider: videasy; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0xa7424a=_0x4a66;(function(_0x589b66,_0x59d20c){const _0x4878ef={_0x38b690:0x1f7,_0x4e863a:0x1ce,_0x30b9de:0x201,_0x455218:0x1e4,_0x59bb01:0x1c3,_0x4d4d1a:0x1f6},_0x301657=_0x4a66,_0x375cd2=_0x589b66();while(!![]){try{const _0x5c5cc4=parseInt(_0x301657(_0x4878ef._0x38b690))/0x1+-parseInt(_0x301657(_0x4878ef._0x4e863a))/0x2*(parseInt(_0x301657(_0x4878ef._0x30b9de))/0x3)+-parseInt(_0x301657(0x1ff))/0x4+-parseInt(_0x301657(0x1c0))/0x5*(-parseInt(_0x301657(0x20e))/0x6)+parseInt(_0x301657(0x212))/0x7+parseInt(_0x301657(0x21f))/0x8*(parseInt(_0x301657(_0x4878ef._0x455218))/0x9)+parseInt(_0x301657(_0x4878ef._0x59bb01))/0xa*(-parseInt(_0x301657(_0x4878ef._0x4d4d1a))/0xb);if(_0x5c5cc4===_0x59d20c)break;else _0x375cd2['push'](_0x375cd2['shift']());}catch(_0x21e459){_0x375cd2['push'](_0x375cd2['shift']());}}}(_0x429a,0x97807));var __async=(_0xd0c07d,_0x340765,_0x2fa615)=>{return new Promise((_0x5f3661,_0x15e11c)=>{const _0x119019=_0x4a66;var _0x24bf8e=_0x52b38a=>{const _0x267aa3=_0x4a66;try{_0x27eb35(_0x2fa615[_0x267aa3(0x1f5)](_0x52b38a));}catch(_0x275c10){_0x15e11c(_0x275c10);}},_0x3d784d=_0x436a1f=>{try{_0x27eb35(_0x2fa615['throw'](_0x436a1f));}catch(_0x5dca38){_0x15e11c(_0x5dca38);}},_0x27eb35=_0x516626=>_0x516626[_0x119019(0x1c5)]?_0x5f3661(_0x516626[_0x119019(0x1ed)]):Promise[_0x119019(0x1c1)](_0x516626[_0x119019(0x1ed)])[_0x119019(0x1c7)](_0x24bf8e,_0x3d784d);_0x27eb35((_0x2fa615=_0x2fa615['apply'](_0xd0c07d,_0x340765))[_0x119019(0x1f5)]());});},TMDB_API_KEY=_0xa7424a(0x213),TMDB_BASE_URL=_0xa7424a(0x211),WINGS_API_BASE=_0xa7424a(0x1c4),USER_AGENT=_0xa7424a(0x20d),REQUEST_HEADERS={'User-Agent':USER_AGENT,'Accept':_0xa7424a(0x1eb),'Origin':_0xa7424a(0x224),'Referer':_0xa7424a(0x220),'Cache-Control':'no-cache,\x20no-store,\x20must-revalidate','Pragma':'no-cache','Expires':'0'},SERVERS={'Hydrogen':{'path':_0xa7424a(0x223)},'Titanium':{'path':_0xa7424a(0x208)},'Oxygen':{'path':_0xa7424a(0x1ef)},'Lithium':{'path':'downloader2/sources-with-title'},'Krypton':{'path':_0xa7424a(0x1d9)},'Carbon':{'path':_0xa7424a(0x1f1)},'Aluminium':{'path':'lamovie/sources-with-title'},'Nitrogen':{'path':_0xa7424a(0x21b)},'Neon':{'path':'superflix/sources-with-title'},'Helium':{'path':_0xa7424a(0x1e1)}},jl=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174],Tf=[0x67452301,0xefcdab89,0x98badcfe,0x10325476],Js=0x3d,_f=0x8,ms=0x9e3779b9,Ys=[0x6d,0x76,0x6d,0x31],Sf=_0x37e181=>(_0x37e181*(_0x37e181+0x1)&0x1)===0x0,bf=_0x391c9f=>(_0x391c9f*(_0x391c9f+0x1)&0x1)===0x1;function ui(_0x55d008){const _0x59f141=_0xa7424a;return _0x55d008>>>=0x0,_0x55d008^=_0x55d008>>>0x10,_0x55d008=Math['imul'](_0x55d008,0x85ebca6b)>>>0x0,_0x55d008^=_0x55d008>>>0xd,_0x55d008=Math[_0x59f141(0x221)](_0x55d008,0xc2b2ae35)>>>0x0,_0x55d008^=_0x55d008>>>0x10,_0x55d008>>>0x0;}function ps(_0x347f79,_0x7edf3f){return _0x347f79>>>=0x0,_0x7edf3f&=0x1f,_0x7edf3f===0x0?_0x347f79>>>0x0:(_0x347f79<<_0x7edf3f|_0x347f79>>>0x20-_0x7edf3f)>>>0x0;}function If(_0x1f22c0){const _0x287fb3={_0x298dcc:0x221,_0x363fe6:0x1fe},_0x7e3be0=_0xa7424a;let _0xe6f21=Tf[0x0]>>>0x0;for(let _0x271667=0x0;_0x271667<_0x1f22c0['length'];_0x271667++){_0xe6f21=ps((_0xe6f21^Math[_0x7e3be0(_0x287fb3._0x298dcc)](_0x1f22c0[_0x7e3be0(_0x287fb3._0x363fe6)](_0x271667),jl[_0x271667&0xf]))>>>0x0,0x5);}return ui(_0xe6f21);}function Af(_0x343e78){const _0x1e8b40=_0xa7424a,_0x462795=new Array(0x100);for(let _0x2202f5=0x0;_0x2202f5<0x100;_0x2202f5++)_0x462795[_0x2202f5]=_0x2202f5;let _0x3654f8=0x0;for(let _0x1593a5=0x0;_0x1593a5<0x100;_0x1593a5++){_0x3654f8=_0x3654f8+_0x462795[_0x1593a5]+_0x343e78[_0x1e8b40(0x1fe)](_0x1593a5%_0x343e78[_0x1e8b40(0x1bf)])&0xff;const _0x393c75=_0x462795[_0x1593a5];_0x462795[_0x1593a5]=_0x462795[_0x3654f8],_0x462795[_0x3654f8]=_0x393c75;}return _0x462795;}function wf(_0x302fd9){const _0x3063e2={_0x324930:0x221},_0x58f133=_0xa7424a;let _0x37b6da=0x811c9dc5;for(let _0x4f989f=0x0;_0x4f989f<_0x302fd9['length'];_0x4f989f++){_0x37b6da=Math[_0x58f133(_0x3063e2._0x324930)](_0x37b6da^_0x302fd9['charCodeAt'](_0x4f989f),0x1000193)>>>0x0;}return ui(_0x37b6da);}function vf(_0xc8001c,_0x4b2aa1,_0x41cdd8){return((_0xc8001c^_0x4b2aa1)>>>0x0|(_0xc8001c&_0x4b2aa1&_0x41cdd8)>>>0x0)>>>0x0;}function Nf(_0x631558,_0x42b3cc){if(bf(_0x631558['length']))return{'S':Af(_0x631558),'acc':If(_0x631558)};const _0x2cbc01=new Array(Js);let _0x2bb9da=ui(wf(_0x631558)^ui(_0x42b3cc>>>0x0^ms))>>>0x0;for(let _0xfb5e8d=0x0;_0xfb5e8d<_f;_0xfb5e8d++){if(Sf(_0xfb5e8d)){const _0x1a78ae=_0x2bb9da%Js;_0x2bb9da=ps(_0x2bb9da+ms>>>0x0,0x7+(_0xfb5e8d&0x7)),_0x2cbc01[_0x1a78ae]=(_0x2bb9da^ui(_0x2bb9da))>>>0x0,_0x2bb9da=ui(_0x2bb9da+_0x1a78ae>>>0x0);}else _0x2cbc01[_0xfb5e8d]=jl[_0xfb5e8d&0xf];}return{'S':_0x2cbc01,'acc':ui(_0x2bb9da^0xa5a5a5a5)>>>0x0};}function Rf(_0xea83ed,_0x405e02){const _0xf4349d={_0x24af3b:0x203},_0x11d34e=_0xa7424a,_0x15d800=_0xea83ed['S'];let _0x4ac929=_0xea83ed[_0x11d34e(_0xf4349d._0x24af3b)];const _0x1a9656=_0x4ac929%Js,_0x188ab4=0x0-+(_0x1a9656 in _0x15d800),_0x1d77d1=_0x15d800[_0x1a9656]>>>0x0,_0x3b743f=Math['imul'](ms,_0x405e02+0x1)>>>0x0;let _0x57c0b2=vf(_0x4ac929,(_0x1d77d1^_0x3b743f)>>>0x0,_0x188ab4);return _0x57c0b2=(ps(_0x57c0b2+_0x4ac929>>>0x0,_0x1a9656&0x1f)^ps(_0x4ac929,Math['imul'](_0x1a9656,0x7)&0x1f))>>>0x0,_0x4ac929=ui(_0x57c0b2+ms>>>0x0),_0x15d800[_0x1a9656]=_0x4ac929>>>0x0,_0xea83ed['acc']=_0x4ac929,_0x4ac929>>>0x0;}function Cf(_0x121578,_0x2c5249,_0x17eb78){const _0x3ddc8a=Nf(_0x121578,_0x2c5249),_0x442b0e=new Uint8Array(_0x17eb78);let _0x396470=0x0;for(let _0x2f7e65=0x0;_0x2f7e65<_0x17eb78;){const _0x402e74=Rf(_0x3ddc8a,_0x396470++);_0x442b0e[_0x2f7e65++]=_0x402e74&0xff,_0x2f7e65<_0x17eb78&&(_0x442b0e[_0x2f7e65++]=_0x402e74>>>0x8&0xff),_0x2f7e65<_0x17eb78&&(_0x442b0e[_0x2f7e65++]=_0x402e74>>>0x10&0xff),_0x2f7e65<_0x17eb78&&(_0x442b0e[_0x2f7e65++]=_0x402e74>>>0x18&0xff);}return _0x442b0e;}function decodeBase64(_0x110a95){const _0x4e0652={_0x2dac4a:0x222,_0x51522a:0x227},_0x1233dc=_0xa7424a,_0x470eb7='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',_0x2666c3=_0x110a95[_0x1233dc(_0x4e0652._0x2dac4a)](/-/g,'+')[_0x1233dc(0x222)](/_/g,'/')[_0x1233dc(0x222)](/=+$/,''),_0x202116=_0x2666c3['length'],_0x2bfde0=new Uint8Array(Math['floor'](_0x202116*0.75));let _0x5ac383=0x0;for(let _0x38cd70=0x0;_0x38cd70<_0x202116;_0x38cd70+=0x4){const _0xce8190=_0x470eb7[_0x1233dc(0x227)](_0x2666c3[_0x38cd70]),_0x245cc4=_0x470eb7[_0x1233dc(_0x4e0652._0x51522a)](_0x2666c3[_0x38cd70+0x1]||'A'),_0x4163a0=_0x470eb7['indexOf'](_0x2666c3[_0x38cd70+0x2]||'A'),_0x33022f=_0x470eb7[_0x1233dc(0x227)](_0x2666c3[_0x38cd70+0x3]||'A');_0x2bfde0[_0x5ac383++]=_0xce8190<<0x2|_0x245cc4>>0x4;if(_0x38cd70+0x2<_0x202116)_0x2bfde0[_0x5ac383++]=(_0x245cc4&0xf)<<0x4|_0x4163a0>>0x2;if(_0x38cd70+0x3<_0x202116)_0x2bfde0[_0x5ac383++]=(_0x4163a0&0x3)<<0x6|_0x33022f;}return _0x2bfde0;}function xf(_0x158e23){return decodeBase64(_0x158e23);}function decryptWingsDatabase(_0x122b4d,_0x55054e,_0x55103e){const _0x5942c9={_0x5b2ddf:0x1bf,_0x3d5209:0x1e8},_0x48f50b=_0xa7424a,_0x450fdb=xf(_0x122b4d),_0x5ae58b=Cf(_0x55054e,_0x55103e,_0x450fdb['length']);for(let _0x29cd02=0x0;_0x29cd02<_0x450fdb[_0x48f50b(0x1bf)];_0x29cd02++)_0x450fdb[_0x29cd02]^=_0x5ae58b[_0x29cd02];for(let _0x2d4c0d=0x0;_0x2d4c0d<Ys[_0x48f50b(_0x5942c9._0x5b2ddf)];_0x2d4c0d++){if(_0x450fdb[_0x2d4c0d]!==Ys[_0x2d4c0d])throw new Error('decrypt\x20failed:\x20bad\x20seed\x20or\x20tampered\x20payload');}let _0x5eaced='';const _0x4ae975=_0x450fdb['subarray'](Ys['length']);for(let _0x339204=0x0;_0x339204<_0x4ae975['length'];){const _0x677c7e=_0x4ae975[_0x339204++];if(_0x677c7e<0x80)_0x5eaced+=String[_0x48f50b(_0x5942c9._0x3d5209)](_0x677c7e);else{if(_0x677c7e>0xbf&&_0x677c7e<0xe0)_0x5eaced+=String['fromCharCode']((_0x677c7e&0x1f)<<0x6|_0x4ae975[_0x339204++]&0x3f);else _0x677c7e>0xdf&&_0x677c7e<0xf0?_0x5eaced+=String['fromCharCode']((_0x677c7e&0xf)<<0xc|(_0x4ae975[_0x339204++]&0x3f)<<0x6|_0x4ae975[_0x339204++]&0x3f):_0x5eaced+=String['fromCharCode']((_0x677c7e&0x7)<<0x12|(_0x4ae975[_0x339204++]&0x3f)<<0xc|(_0x4ae975[_0x339204++]&0x3f)<<0x6|_0x4ae975[_0x339204++]&0x3f);}}return _0x5eaced;}function fetchMediaDetails(_0x5c8a2b,_0x4694a3,_0x3947bd,_0x42bb6e){const _0x4dd6a5={_0x5865a6:0x20f,_0x470cf7:0x222,_0x59c357:0x1c8,_0x2fb6e1:0x1f8,_0x372a14:0x206,_0x7fdfa2:0x1d8,_0x300906:0x1d7,_0x570a71:0x202,_0x2888fe:0x1e2};return __async(this,null,function*(){const _0x14b013=_0x4a66;var _0x2e90ea;let _0x821299=_0x4694a3==='tv'?_0x14b013(_0x4dd6a5._0x5865a6):'90\x20min';try{const _0x15806e=_0x4694a3==='tv'?'tv':'movie',_0x2b71a6=String(_0x5c8a2b)[_0x14b013(_0x4dd6a5._0x470cf7)](/\D/g,''),_0x5d776e=TMDB_BASE_URL+'/'+_0x15806e+'/'+_0x2b71a6+_0x14b013(_0x4dd6a5._0x59c357)+TMDB_API_KEY+_0x14b013(_0x4dd6a5._0x2fb6e1),_0x2fbf32=yield fetch(_0x5d776e,{'headers':{'User-Agent':REQUEST_HEADERS['User-Agent'],'Accept':_0x14b013(0x1fa)}});if(!_0x2fbf32['ok'])throw new Error(_0x14b013(_0x4dd6a5._0x372a14)+_0x2fbf32['status']);const _0x12de86=yield _0x2fbf32['json']();let _0x4cebc4=_0x821299;if(_0x4694a3===_0x14b013(0x1f9)&&_0x12de86['runtime'])_0x4cebc4=_0x12de86['runtime']+_0x14b013(0x21d);else{if(_0x4694a3==='tv'&&_0x3947bd!=null&&_0x42bb6e!=null){const _0x6695aa=TMDB_BASE_URL+'/tv/'+_0x2b71a6+_0x14b013(0x1f3)+_0x3947bd+'/episode/'+_0x42bb6e+'?api_key='+TMDB_API_KEY,_0x538a32=yield fetch(_0x6695aa);if(_0x538a32['ok']){const _0x4fbdb1=yield _0x538a32[_0x14b013(0x204)]();if(_0x4fbdb1&&_0x4fbdb1['runtime'])_0x4cebc4=_0x4fbdb1[_0x14b013(_0x4dd6a5._0x7fdfa2)]+_0x14b013(0x21d);else _0x12de86[_0x14b013(0x1d7)]&&_0x12de86[_0x14b013(_0x4dd6a5._0x300906)][_0x14b013(0x1bf)]>0x0&&(_0x4cebc4=_0x12de86['episode_run_time'][0x0]+'\x20min');}}}return{'title':_0x4694a3==='tv'?_0x12de86[_0x14b013(0x215)]:_0x12de86['title'],'year':(_0x4694a3==='tv'?_0x12de86['first_air_date']:_0x12de86[_0x14b013(_0x4dd6a5._0x570a71)]||'')[_0x14b013(_0x4dd6a5._0x2888fe)](0x0,0x4),'imdbId':((_0x2e90ea=_0x12de86['external_ids'])==null?void 0x0:_0x2e90ea['imdb_id'])||null,'mediaType':_0x4694a3,'duration':_0x4cebc4};}catch(_0xd5dfc6){return console['error']('[VidEasy]\x20TMDB\x20details\x20fetch\x20error:\x20'+_0xd5dfc6['message']),{'title':_0x4694a3==='tv'?_0x14b013(0x1d0):'Unknown\x20Movie','year':'N/A','imdbId':null,'mediaType':_0x4694a3,'duration':_0x821299};}});}function _0x4a66(_0x4f41e2,_0x418fb1){_0x4f41e2=_0x4f41e2-0x1be;const _0x429a76=_0x429a();let _0x4a6607=_0x429a76[_0x4f41e2];if(_0x4a66['TDSDIZ']===undefined){var _0x546b1b=function(_0x458c00){const _0x764488='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0xd0c07d='',_0x340765='';for(let _0x2fa615=0x0,_0x5f3661,_0x15e11c,_0x24bf8e=0x0;_0x15e11c=_0x458c00['charAt'](_0x24bf8e++);~_0x15e11c&&(_0x5f3661=_0x2fa615%0x4?_0x5f3661*0x40+_0x15e11c:_0x15e11c,_0x2fa615++%0x4)?_0xd0c07d+=String['fromCharCode'](0xff&_0x5f3661>>(-0x2*_0x2fa615&0x6)):0x0){_0x15e11c=_0x764488['indexOf'](_0x15e11c);}for(let _0x3d784d=0x0,_0x27eb35=_0xd0c07d['length'];_0x3d784d<_0x27eb35;_0x3d784d++){_0x340765+='%'+('00'+_0xd0c07d['charCodeAt'](_0x3d784d)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x340765);};_0x4a66['sGoAhR']=_0x546b1b,_0x4a66['YDcjRA']={},_0x4a66['TDSDIZ']=!![];}const _0x154d35=_0x429a76[0x0],_0xf0f180=_0x4f41e2+_0x154d35,_0x372f30=_0x4a66['YDcjRA'][_0xf0f180];return!_0x372f30?(_0x4a6607=_0x4a66['sGoAhR'](_0x4a6607),_0x4a66['YDcjRA'][_0xf0f180]=_0x4a6607):_0x4a6607=_0x372f30,_0x4a6607;}function getLangCode(_0x1c41f4){const _0x1035f1={_0x312150:0x1e9},_0x125771=_0xa7424a;if(!_0x1c41f4)return'en';const _0x4718de={'english':'en','spanish':'es','french':'fr','german':'de','italian':'it','portuguese':'pt','portuguese\x20(br)':'pt-br','arabic':'ar','japanese':'ja','korean':'ko','tamil':'ta','telugu':'te','malayalam':'ml','kannada':'kn','hindi':'hi','polish':'pl','greek':'el','croatian':'hr','ukrainian':'uk','lithuanian':'lt','thai':'th','estonian':'et','czech':'cs','zh-tw':_0x125771(0x1d2),'bokmål':'no','dutch':'nl','indonesian':'id','sinhala':'si','swedish':'sv','romanian':'ro','malay':'ms','persian':'fa','slovak':'sk','bulgarian':'bg','turkish':'tr','danish':'da','hebrew':'he','serbian':'sr','vietnamese':'vi','hungarian':'hu','icelandic':'is','albanian':'sq','bosnian':'bs','slovenian':'sl','bengali':'bn','macedonian':'mk'};return _0x4718de[_0x1c41f4[_0x125771(0x1e6)]()[_0x125771(_0x1035f1._0x312150)]()]||'en';}function formatStreamsForNuvio(_0x3fc9fd,_0x15041e,_0x35c64d,_0x515578,_0x1cd419){const _0x3a35d5={_0x26297e:0x1dc,_0x136f9b:0x1db},_0x11abbe={_0x4aad31:0x21a,_0x5219db:0x222,_0x466535:0x210,_0x4240ec:0x229,_0x16fab3:0x200,_0x21b3fe:0x1d4,_0x496661:0x1da,_0x1276cf:0x214,_0x2f48a6:0x219,_0x3fd1d6:0x1df,_0x2c58a6:0x209,_0xa8a3c:0x200,_0x1de014:0x207,_0x5bb290:0x200,_0x48b6a6:0x1ee,_0x1fe6da:0x216,_0x2a0df1:0x1fc,_0x1b73b4:0x1c6,_0x5a2ae2:0x1c2,_0x4afbe1:0x20b},_0x1a87a3=_0xa7424a;try{const _0x5abbc2=JSON['parse'](_0x3fc9fd);if(!_0x5abbc2||typeof _0x5abbc2!=='object')return[];const _0x32061f={'Referer':'https://www.vidking.net/','Origin':'https://www.vidking.net','User-Agent':USER_AGENT},_0x4282e5=(_0x5abbc2['subtitles']||[])[_0x1a87a3(0x1de)](_0x59e79b=>({'url':_0x59e79b['url'],'language':getLangCode(_0x59e79b['language']||_0x59e79b['lang']),'name':_0x59e79b[_0x1a87a3(0x1fd)]||_0x59e79b['lang']||'English','headers':_0x32061f})),_0x2a4d52={'Carbon':'💎','Helium':'🎈','Lithium':'🔋','Oxygen':'💨','Krypton':'🦸','Titanium':'🛡️','Hydrogen':'💧','Nitrogen':'🌿','Neon':'💡','Aluminium':'💿'},_0x18ccdd=_0x2a4d52[_0x15041e]||'🎬',_0x4273d5={'Hydrogen':'CDN','Titanium':_0x1a87a3(0x217),'Oxygen':'Neon2','Lithium':_0x1a87a3(0x205),'Krypton':'YM','Carbon':'MB-Flix','Aluminium':'LaMovie','Nitrogen':_0x1a87a3(0x1d3),'Neon':'SuperFlix','Helium':'1Movies'},_0x2840da=_0x4273d5[_0x15041e]||_0x15041e,_0x42db41=[];return(_0x5abbc2['sources']||[])['forEach'](_0x255fe5=>{const _0x5c4c28=_0x1a87a3;if(!_0x255fe5['url'])return;let _0x23cb3c=_0x255fe5[_0x5c4c28(_0x11abbe._0x4aad31)]||'1080p',_0x2ab764=_0x23cb3c[_0x5c4c28(_0x11abbe._0x5219db)](/\s*server\s*2\s*$/gi,'')['trim']();_0x15041e===_0x5c4c28(_0x11abbe._0x466535)&&(_0x2ab764=_0x5c4c28(0x1d5));let _0x102aff=_0x2ab764['toLowerCase'](),_0x4dd8b6='⚡\x20'+_0x2ab764;if(_0x102aff[_0x5c4c28(0x200)](_0x5c4c28(_0x11abbe._0x4240ec))||_0x102aff[_0x5c4c28(_0x11abbe._0x16fab3)]('4k'))_0x4dd8b6=_0x5c4c28(0x20a);else{if(_0x102aff[_0x5c4c28(0x200)]('1080'))_0x4dd8b6='🔥\x201080p';else{if(_0x102aff['includes']('720'))_0x4dd8b6=_0x5c4c28(_0x11abbe._0x21b3fe);else _0x102aff==='auto'&&(_0x4dd8b6=_0x5c4c28(_0x11abbe._0x496661));}}let _0x4c1264='Original\x20Audio',_0x16acb9=_0x5c4c28(0x1c9);if(_0x15041e===_0x5c4c28(_0x11abbe._0x1276cf)||_0x15041e==='Krypton')_0x4c1264='Original\x20Audio',_0x16acb9='🌍\x20Original\x20Audio';else{if(_0x15041e==='Oxygen')_0x4c1264=_0x5c4c28(0x1f4),_0x16acb9=_0x5c4c28(0x218);else{if(_0x15041e==='Aluminium')_0x4c1264='Dual-Audio',_0x16acb9=_0x5c4c28(_0x11abbe._0x2f48a6);else{if(_0x15041e===_0x5c4c28(_0x11abbe._0x3fd1d6)){const _0x5193be=(_0x255fe5[_0x5c4c28(_0x11abbe._0x2c58a6)]||'')['toLowerCase']();_0x5193be[_0x5c4c28(0x200)]('bengali')||_0x5193be[_0x5c4c28(_0x11abbe._0xa8a3c)](_0x5c4c28(_0x11abbe._0x1de014))?(_0x4c1264=_0x5c4c28(0x228),_0x16acb9='🇧🇩\x20Bengali'):(_0x4c1264='Normal\x20Hindi',_0x16acb9='🇮🇳\x20Hindi');}}}}const _0x47296f=_0x255fe5[_0x5c4c28(0x216)][_0x5c4c28(_0x11abbe._0x5bb290)](_0x5c4c28(_0x11abbe._0x48b6a6))?'M3U8':_0x255fe5[_0x5c4c28(_0x11abbe._0x1fe6da)][_0x5c4c28(0x200)]('.mp4')?'MP4':_0x5c4c28(_0x11abbe._0x2a0df1),_0x54570b=_0x35c64d[_0x5c4c28(0x209)]+(_0x35c64d['mediaType']==='tv'?'\x20S'+_0x515578+'E'+_0x1cd419:'');let _0x3f5fa9=_0x15041e;_0x3f5fa9==='Krypton'&&(_0x3f5fa9=_0x3f5fa9['replace'](/\s*(1080p\s+)?server\s*2\s*$/gi,'')[_0x5c4c28(0x1e9)]());const _0x196bb9=_0x5c4c28(_0x11abbe._0x1b73b4)+_0x54570b+_0x5c4c28(0x21c)+_0x35c64d['year']+')\x0a'+_0x4dd8b6+'\x20|\x20'+_0x16acb9+'\x20|\x20🎧\x20AAC\x0a🎞️\x20'+_0x47296f+'\x20|\x20⏱️\x20'+_0x35c64d[_0x5c4c28(_0x11abbe._0x5a2ae2)]+'\x0a'+_0x18ccdd+'\x20'+_0x3f5fa9+_0x5c4c28(0x1f0)+_0x2840da;_0x42db41['push']({'name':_0x5c4c28(_0x11abbe._0x4afbe1)+_0x2ab764+'\x20|\x20'+_0x4c1264,'title':_0x196bb9,'size':_0x196bb9,'description':_0x196bb9,'url':_0x255fe5[_0x5c4c28(_0x11abbe._0x1fe6da)],'quality':'','language':'','headers':_0x32061f,'subtitles':_0x4282e5,'provider':'videasy','_is4k':_0x102aff[_0x5c4c28(0x200)]('2160')||_0x102aff['includes']('4k'),'_serverName':_0x15041e});}),_0x42db41;}catch(_0x17e4e6){return console[_0x1a87a3(_0x3a35d5._0x26297e)]('[VidEasy]\x20Formatting\x20error:\x20'+_0x17e4e6[_0x1a87a3(_0x3a35d5._0x136f9b)]),[];}}function fetchFromWingsServer(_0x190fbc,_0x4fe0d1,_0x10593a,_0x53363a,_0xcee714,_0x5e2379,_0x120cb2,_0xc54b2e){const _0x51a429={_0x461d50:0x1cd,_0x350d8e:0x1e0,_0x30a9dc:0x20c,_0x652486:0x1cf};return __async(this,null,function*(){const _0x386b64=_0x4a66,_0x332b00={'title':_0xcee714['title'],'mediaType':_0x10593a,'year':String(_0xcee714['year']),'episodeId':String(_0xc54b2e||0x1),'seasonId':String(_0x120cb2||0x1),'tmdbId':String(_0x53363a),'imdbId':_0xcee714['imdbId']||'','enc':'2','seed':_0x5e2379},_0xa9ede1=Object[_0x386b64(_0x51a429._0x461d50)](_0x332b00)['map'](_0x4831c7=>encodeURIComponent(_0x4831c7)+'='+encodeURIComponent(_0x332b00[_0x4831c7]))[_0x386b64(0x1cc)]('&'),_0x1d9945=WINGS_API_BASE+'/'+_0x4fe0d1[_0x386b64(_0x51a429._0x350d8e)]+'?'+_0xa9ede1;console[_0x386b64(0x1d1)](_0x386b64(0x225)+_0x190fbc+':\x20'+_0x1d9945);try{const _0x147fb6=yield fetch(_0x1d9945,{'headers':REQUEST_HEADERS});if(!_0x147fb6['ok'])throw new Error('HTTP\x20'+_0x147fb6[_0x386b64(_0x51a429._0x30a9dc)]);const _0x1f1261=yield _0x147fb6[_0x386b64(0x1cb)]();if(!_0x1f1261||_0x1f1261[_0x386b64(0x1e9)]()==='')throw new Error(_0x386b64(_0x51a429._0x652486));const _0x355fcb=decryptWingsDatabase(_0x1f1261,_0x5e2379,Number(_0x53363a));if(!_0x355fcb)return[];const _0x3d8ccb=formatStreamsForNuvio(_0x355fcb,_0x190fbc,_0xcee714,_0x120cb2,_0xc54b2e);return console['log']('[VidEasy]\x20✅\x20Found\x20'+_0x3d8ccb['length']+'\x20stream(s)\x20from\x20'+_0x190fbc),_0x3d8ccb;}catch(_0x27e3ce){return console['warn']('[VidEasy]\x20❌\x20Error\x20from\x20'+_0x190fbc+':\x20'+_0x27e3ce['message']),[];}});}function _0x429a(){const _0x2337fd=['mw1VDMLLCY9ZB3vYy2vZlxDPDgGTDgL0Bgu','C3vIC3rYAw5N','zM9YrwfJAa','otK5mZK2r1v2EgX0','w1zPzevHC3LDifn0yxj0Aw5Nigv4DhjHy3rPB24GzM9YifrnreiGsuq6ia','Dg9mB3DLCKnHC2u','zxHWB3j0CW','zNjVBunOyxjdB2rL','DhjPBq','C29YDa','kI8Q','x3nLCNzLCK5HBwu','DMfSDwu','lM0ZDtG','BMvVBJiVC291CMnLCY13AxrOlxrPDgXL','ihWG8j+uLYbqCM92AwrLCJOG','BwiTzMXPEc9ZB3vYy2vZlxDPDgGTDgL0Bgu','w1zPzevHC3LDie1LzgLHierLDgfPBhm6ici','l3nLyxnVBI8','txvSDgKTqxvKAw8','BMv4Da','mJm0m3fotuvmtW','nJeWmJC1ruLHqKzi','jMfWCgvUzf90B19YzxnWB25Zzt1LEhrLCM5HBf9Pzhm','Bw92Awu','yxbWBgLJyxrPB24VANnVBG','x2LZngS','tuTw','BgfUz3vHz2u','y2HHCKnVzgvbDa','mJuYodi1mNHPsg9hwa','Aw5JBhvKzxm','mte3nZGZwvPfANfb','CMvSzwfZzv9KyxrL','ywnJ','ANnVBG','rg93BMXVywrLCJi','ve1eqIbivfrqia','yMfUz2XH','DgvQBY9ZB3vYy2vZlxDPDgGTDgL0Bgu','DgL0Bgu','8j+mNYaYmtyWCa','vMLKrwfZEsb8ia','C3rHDhvZ','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmI4WlJaUmcbtywzHCMKVntm3lJm2','ndCYmJaWwhrnEw5z','nduGBwLU','t3H5z2vU','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmW','mtu4mZy3m2vlr0TjqG','ndm5yZq3oge3nZfMmZvJmduWmJjMowzLywjJy2eWmwm','shLKCM9Nzw4','BMfTzq','DxjS','vgvQBW','8j+mJsbnDwX0As1bDwrPBW','8j+mJsbeDwfSluf1zgLV','CxvHBgL0Eq','Btr1AgqVC291CMnLCY13AxrOlxrPDgXL','ic0Gka','ig1PBG','iIaO','ogPLs25TDa','Ahr0Chm6lY93D3CUDMLKA2LUzY5UzxqV','Aw11Ba','CMvWBgfJzq','y2rUl3nVDxjJzxmTD2L0Ac10AxrSzq','Ahr0Chm6lY93D3CUDMLKA2LUzY5Uzxq','w1zPzevHC3LDiff1zxj5Aw5NihnLCNzLCIa','w1zPzevHC3LDifnLzwqGC3vJy2vZC2z1BgX5ihjLDhjPzxzLzdOG','Aw5KzxHpzG','qMvUz2fSAq','mJe2ma','w1zPzevHC3LDiezHAwXLzcb0BYbMzxrJAcbTzwrPysbKzxrHAwXZigzYB20Gve1eqI4','BgvUz3rO','ntblEg9eBM0','CMvZB2X2zq','zhvYyxrPB24','mtG5ndbdrKLkrgC','Ahr0Chm6lY9HCgKUC3bLzwrYywnLBgLNAhqUy29T','zg9Uzq','8j+oRca','DgHLBG','p2fWAv9RzxK9','8j+mJsbpCMLNAw5HBcbbDwrPBW','ChvZAa','Dgv4Da','AM9PBG','A2v5CW','ngTcyKvxCG','rw1WDhKGCMvZCg9UC2u','vw5RBM93BIbuvIbtAg93','Bg9N','EMGTDhC','ttrvseq','4PQHidCYmha','qxv0BW','w1zPzevHC3LDifrVDgfSihvUAxf1zsbZDhjLyw1ZigzVDw5KoIa','zxbPC29Kzv9YDw5FDgLTzq','CNvUDgLTzq','Ew0VC291CMnLCY13AxrOlxrPDgXL','4PQHief1Dg8','BwvZC2fNzq','zxjYB3i','EwvHCG','BwfW','twfNBMvZAxvT','Cgf0Aa'];_0x429a=function(){return _0x2337fd;};return _0x429a();}function getStreams(_0x4163e4,_0x4a8f82,_0x57a54f=null,_0x2338cf=null){const _0x2bfda2={_0x373f56:0x1dc,_0xb39988:0x1d1,_0x1a3da3:0x21e,_0x460243:0x1cd,_0x36c6d4:0x1ea,_0x5a6d02:0x1db},_0x4cb223={_0x403fa2:0x1fb,_0x2b2115:0x1ec,_0x3c7db6:0x227};return __async(this,null,function*(){const _0x48a053={_0x521a04:0x216,_0x48d69e:0x1ca},_0x29c729=_0x4a66;console[_0x29c729(0x1d1)](_0x29c729(0x1e5)+_0x4163e4+',\x20Type:\x20'+_0x4a8f82+(_0x4a8f82==='tv'?',\x20S:'+_0x57a54f+'E:'+_0x2338cf:''));try{const _0x3a5953=yield fetchMediaDetails(_0x4163e4,_0x4a8f82,_0x57a54f,_0x2338cf);if(!_0x3a5953)return console[_0x29c729(_0x2bfda2._0x373f56)](_0x29c729(0x1be)),[];console[_0x29c729(_0x2bfda2._0xb39988)](_0x29c729(0x1f2)+_0x3a5953['title']+_0x29c729(_0x2bfda2._0x1a3da3)+_0x3a5953[_0x29c729(0x1dd)]+')\x20|\x20Duration:\x20'+_0x3a5953[_0x29c729(0x1c2)]);const _0x17212a=WINGS_API_BASE+'/seed?mediaId='+_0x4163e4;console['log']('[VidEasy]\x20Fetching\x20seed\x20from:\x20'+_0x17212a);const _0x484d76=yield fetch(_0x17212a,{'headers':REQUEST_HEADERS});if(!_0x484d76['ok'])throw new Error('Seed\x20HTTP\x20'+_0x484d76['status']);const _0x4d5914=yield _0x484d76[_0x29c729(0x204)](),_0x4046c7=_0x4d5914['seed'];if(!_0x4046c7)throw new Error('No\x20seed\x20returned\x20from\x20API');console[_0x29c729(0x1d1)](_0x29c729(0x226)+_0x4046c7);const _0x62a48c=Object[_0x29c729(0x1cd)](SERVERS)['map'](_0x1a6008=>{const _0x174b87=SERVERS[_0x1a6008];return fetchFromWingsServer(_0x1a6008,_0x174b87,_0x4a8f82,_0x4163e4,_0x3a5953,_0x4046c7,_0x57a54f,_0x2338cf);}),_0x278a77=yield Promise['all'](_0x62a48c),_0x1f3c41=[];_0x278a77['forEach'](_0x9bb440=>{const _0x4860b5=_0x29c729;_0x1f3c41[_0x4860b5(0x1ca)](..._0x9bb440);});const _0x415d71=[],_0x2984c0=new Set();_0x1f3c41[_0x29c729(0x1e3)](_0x553aeb=>{const _0x25c223=_0x29c729;!_0x2984c0['has'](_0x553aeb[_0x25c223(_0x48a053._0x521a04)])&&(_0x2984c0['add'](_0x553aeb['url']),_0x415d71[_0x25c223(_0x48a053._0x48d69e)](_0x553aeb));});const _0x4daff2=Object[_0x29c729(_0x2bfda2._0x460243)](SERVERS);return _0x415d71[_0x29c729(_0x2bfda2._0x36c6d4)]((_0x5eece5,_0x1f4583)=>{const _0x46db9e=_0x29c729;if(_0x5eece5['_is4k']&&!_0x1f4583[_0x46db9e(_0x4cb223._0x403fa2)])return-0x1;if(!_0x5eece5['_is4k']&&_0x1f4583[_0x46db9e(0x1fb)])return 0x1;const _0x21bcd3=_0x4daff2[_0x46db9e(0x227)](_0x5eece5[_0x46db9e(_0x4cb223._0x2b2115)]),_0x55b90c=_0x4daff2[_0x46db9e(_0x4cb223._0x3c7db6)](_0x1f4583[_0x46db9e(0x1ec)]);return _0x21bcd3-_0x55b90c;}),console['log'](_0x29c729(0x1d6)+_0x415d71[_0x29c729(0x1bf)]),_0x415d71;}catch(_0x38985a){return console[_0x29c729(0x1dc)]('[VidEasy]\x20Error\x20in\x20getStreams:\x20'+_0x38985a[_0x29c729(_0x2bfda2._0x5a6d02)]),[];}});}module[_0xa7424a(0x1e7)]={'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "videasy", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "VidEasy", "videasy");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
