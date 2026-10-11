// Imported provider: animetsu; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x1b3810=_0x1ae2;(function(_0x436904,_0x9a348d){const _0x2d2060={_0x1faa75:0x1db,_0x5a4589:0x1be,_0x483280:0x1fc,_0x4b1f95:0x1e9,_0x526cf3:0x210,_0x2ee1fa:0x1ae},_0x1acc7f=_0x1ae2,_0x31731f=_0x436904();while(!![]){try{const _0x42f9df=parseInt(_0x1acc7f(_0x2d2060._0x1faa75))/0x1*(parseInt(_0x1acc7f(_0x2d2060._0x5a4589))/0x2)+parseInt(_0x1acc7f(_0x2d2060._0x483280))/0x3*(-parseInt(_0x1acc7f(_0x2d2060._0x4b1f95))/0x4)+parseInt(_0x1acc7f(0x1f2))/0x5*(parseInt(_0x1acc7f(0x1c3))/0x6)+parseInt(_0x1acc7f(0x1d9))/0x7*(parseInt(_0x1acc7f(0x1d5))/0x8)+parseInt(_0x1acc7f(0x1f5))/0x9*(parseInt(_0x1acc7f(0x1b9))/0xa)+parseInt(_0x1acc7f(0x1e2))/0xb*(-parseInt(_0x1acc7f(_0x2d2060._0x526cf3))/0xc)+-parseInt(_0x1acc7f(_0x2d2060._0x2ee1fa))/0xd*(parseInt(_0x1acc7f(0x1b6))/0xe);if(_0x42f9df===_0x9a348d)break;else _0x31731f['push'](_0x31731f['shift']());}catch(_0x54ecec){_0x31731f['push'](_0x31731f['shift']());}}}(_0x56cd,0xb25de));var __async=(_0x2ea7d8,_0x3c67f6,_0x542a7f)=>{return new Promise((_0x5c99ff,_0x163440)=>{const _0x6f7606={_0x44cd62:0x1bd},_0x583aee={_0x4977a0:0x1dd},_0x1ff76b=_0x1ae2;var _0x19a76d=_0x78eaf2=>{const _0x257f7b=_0x1ae2;try{_0x3698bc(_0x542a7f[_0x257f7b(_0x583aee._0x4977a0)](_0x78eaf2));}catch(_0x504a09){_0x163440(_0x504a09);}},_0x40c560=_0x1526d5=>{const _0x9249e=_0x1ae2;try{_0x3698bc(_0x542a7f[_0x9249e(_0x6f7606._0x44cd62)](_0x1526d5));}catch(_0x211bd8){_0x163440(_0x211bd8);}},_0x3698bc=_0x2a44c0=>_0x2a44c0['done']?_0x5c99ff(_0x2a44c0['value']):Promise[_0x1ff76b(0x215)](_0x2a44c0['value'])['then'](_0x19a76d,_0x40c560);_0x3698bc((_0x542a7f=_0x542a7f['apply'](_0x2ea7d8,_0x3c67f6))['next']());});},PROVIDER_NAME='Animetsu',TMDB_API_KEY='439c478a771f35c05022f9feabcca01c',BASE_URL='https://animetsu.live/v2/api',PROXY_URL=_0x1b3810(0x1d2),MOBILE_UAS=['Mozilla/5.0\x20(Linux;\x20Android\x2014;\x20Pixel\x208\x20Pro)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/124.0.0.0\x20Mobile\x20Safari/537.36',_0x1b3810(0x20f),'Mozilla/5.0\x20(Linux;\x20Android\x2012;\x20Pixel\x206)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/115.0.0.0\x20Mobile\x20Safari/537.36',_0x1b3810(0x1cb)];function getHeaders(_0x160481=null){const _0x5c25dd={_0x52692d:0x1f1},_0x41dcac=_0x1b3810,_0xed24f2=_0x160481||MOBILE_UAS[Math['floor'](Math[_0x41dcac(0x217)]()*MOBILE_UAS['length'])];return{'User-Agent':_0xed24f2,'Referer':_0x41dcac(_0x5c25dd._0x52692d),'Origin':_0x41dcac(0x1f1),'Accept-Language':_0x41dcac(0x1f8)};}var DOMAINS_JSON_URL=_0x1b3810(0x1e3),cachedDomains=null,domainCacheTime=0x0,DOMAIN_CACHE_TTL=0x4*0x3c*0x3c*0x3e8;function refreshDomains(){const _0x3fa51f={_0x2e3524:0x1c2};return __async(this,null,function*(){const _0x23c754=_0x1ae2,_0x19d3eb=Date['now']();if(cachedDomains&&_0x19d3eb-domainCacheTime<DOMAIN_CACHE_TTL)return cachedDomains;try{const _0x1908ea=yield fetch(DOMAINS_JSON_URL);if(_0x1908ea['ok']){const _0x48f10a=yield _0x1908ea[_0x23c754(0x1df)]();if(_0x48f10a){cachedDomains=_0x48f10a,domainCacheTime=_0x19d3eb;if(_0x48f10a['gojo_base'])BASE_URL=_0x48f10a['gojo_base']+_0x23c754(0x201);console['log']('['+PROVIDER_NAME+']\x20Domains\x20updated:\x20BASE_URL='+BASE_URL);}}}catch(_0x4b0a80){console['log']('['+PROVIDER_NAME+_0x23c754(_0x3fa51f._0x2e3524)+BASE_URL);}return cachedDomains||{};});}function manifest(){const _0x65c03d={_0x5e6e2e:0x1f3,_0x1e41ad:0x1bc},_0x454c2f=_0x1b3810;return{'id':'animetsu','name':_0x454c2f(0x1f7),'description':_0x454c2f(0x1b8),'version':'1.0.1','logo':'https://animetsu.live/favicon.ico','background':'https://animetsu.live/favicon.ico','types':['tv',_0x454c2f(_0x65c03d._0x5e6e2e),_0x454c2f(0x1cd)],'resources':['stream'],'idPrefixes':['tt',_0x454c2f(_0x65c03d._0x1e41ad)]};}function extractM3u8Qualities(_0x1cda90,_0x2e224b){const _0x4f5cdb={_0x4480c1:0x216,_0x380c2b:0x1f4,_0x30f4c0:0x202,_0x28187e:0x1d7,_0x53506f:0x1d8};return __async(this,null,function*(){const _0x50dd87=_0x1ae2;try{const _0x478bab=yield fetch(_0x1cda90,{'headers':_0x2e224b});if(!_0x478bab['ok'])return null;const _0x3ea20c=yield _0x478bab['text'](),_0x5cf4fb=_0x3ea20c[_0x50dd87(0x1e4)]('\x0a');let _0x2e1fa9=[],_0x4fc3a1=null;const _0x269fc6=_0x1cda90[_0x50dd87(_0x4f5cdb._0x4480c1)]('?'),_0x3c7c8f=_0x269fc6>-0x1?_0x1cda90['substring'](_0x269fc6):'',_0x4f11cc=_0x269fc6>-0x1?_0x1cda90[_0x50dd87(0x1e6)](0x0,_0x269fc6):_0x1cda90,_0x3d4849=_0x4f11cc[_0x50dd87(0x1e6)](0x0,_0x4f11cc[_0x50dd87(_0x4f5cdb._0x380c2b)]('/'));for(let _0x2a8ea6=0x0;_0x2a8ea6<_0x5cf4fb[_0x50dd87(0x207)];_0x2a8ea6++){let _0x7e314e=_0x5cf4fb[_0x2a8ea6]['trim']();if(_0x7e314e['startsWith']('#EXT-X-STREAM-INF')){const _0x63c484=_0x7e314e[_0x50dd87(_0x4f5cdb._0x30f4c0)](/RESOLUTION=\d+x(\d+)/);_0x4fc3a1=_0x63c484?_0x63c484[0x1]+'p':'Unknown';}else{if(_0x7e314e&&!_0x7e314e['startsWith']('#')&&_0x4fc3a1){let _0x4add9=_0x7e314e[_0x50dd87(0x213)]('http')?_0x7e314e:_0x3d4849+'/'+_0x7e314e;_0x3c7c8f&&!_0x4add9['includes']('?')&&(_0x4add9+=_0x3c7c8f),_0x2e1fa9[_0x50dd87(_0x4f5cdb._0x28187e)]({'quality':_0x4fc3a1,'url':_0x4add9}),_0x4fc3a1=null;}}}return _0x2e1fa9['length']>0x0?_0x2e1fa9:null;}catch(_0x40176f){return console['log']('['+PROVIDER_NAME+_0x50dd87(_0x4f5cdb._0x53506f)+_0x40176f['message']),null;}});}function search(_0xed2861,_0x3e6e91){return __async(this,null,function*(){return[];});}function makeStream(_0x3d2c51,_0x12805a,_0x67cc5d,_0x57b336,_0x2b500a,_0x193449,_0x1b2d8e,_0x1942b6){const _0x516b2f={_0x3510ac:0x211,_0xca2dcd:0x1c4,_0x143367:0x1bb,_0x4f560a:0x1de};return __async(this,null,function*(){const _0x56b543=_0x1ae2;let _0x3c01a7=_0x2b500a,_0x31ab21=!_0x2b500a[_0x56b543(_0x516b2f._0x3510ac)]('.mp4'),_0xdbe312=_0x57b336[_0x56b543(0x1dc)](),_0x2d67fb=getHeaders(_0x1942b6);const _0x1a7819={'name':''+_0x3d2c51+_0x67cc5d+'\x20('+_0xdbe312+')','title':''+_0x12805a+_0x67cc5d+'\x20('+_0xdbe312+')','size':''+_0x12805a+_0x67cc5d+'\x20('+_0xdbe312+')','url':_0x3c01a7,'quality':_0x193449,'behaviorHints':{'proxyHeaders':{'request':_0x2d67fb},'notWebReady':!![]}};if(_0x31ab21){_0x1a7819[_0x56b543(_0x516b2f._0xca2dcd)]=_0x2d67fb;const _0x201f2d=yield extractM3u8Qualities(_0x3c01a7,_0x2d67fb);if(_0x201f2d){const _0x2817c0=_0x201f2d['find'](_0x3a3fb1=>_0x3a3fb1['quality']==='1080p')||_0x201f2d[_0x56b543(_0x516b2f._0x143367)](_0x294ec9=>_0x294ec9[_0x56b543(0x1de)]==='720p')||_0x201f2d[0x0];_0x1a7819['url']=_0x2817c0['url']+'#ext=.m3u8',_0x1a7819['quality']=_0x2817c0['quality'],console['log']('['+PROVIDER_NAME+_0x56b543(0x1da)+_0x2817c0[_0x56b543(_0x516b2f._0x4f560a)]);}else _0x1a7819[_0x56b543(0x1c9)]=_0x3c01a7+'#ext=.m3u8';}return _0x1a7819;});}function _0x56cd(){const _0x5643b8=['zMXVB3i','C3vIC3rYAw5N','l2v4DgvYBMfSx2LKCZ9HCgLFA2v5pq','BMfTzq','odqZnJyWvwnys3Hf','yw5Pswq','xsbtzwfYy2HPBMCGvfzeqIbMB3iGC2vYAwvZoIa','C2vHC29UtNvTyMvY','xsboBYbYzxn1BhrZigzVDw5KigzVCIbXDwvYEs4','y292zxjFAw1Hz2u','Ahr0Chm6lY9HCgK0lNrOzxr2zgiUy29Tl3y0l3nLyxjJAd9XDwvYEt0','twvKAwe','Ahr0Chm6lY9HBMLTzxrZDs5SAxzLlW','nurqDMXwtq','Bw92Awu','BgfZDeLUzgv4t2y','mtaZndaYmJz5qwn5qwm','Dg9Rzw4','qw5PBwv0C3u','zw4TvvmSzw47Ct0WlJK','zgf0yq','xsbbDhrLBxb0Aw5NifrnreiGBwf0AcbMB3iGve1eqIbjrdOG','xsbtzwfYy2HPBMCGzM9YoIa','mtjZCg1suNC','yMfUBMvY','lMPZB24','zhvI','ieu9','l3yYl2fWAq','Bwf0y2G','ksb8ievWoIa','xsbtA2LWCgLUzYbUB24Tyw5PBwuGBwvKAweGkeDLBNjLCZOG','CMvWBgfJzq','xsbuturcienHBgn1Bgf0zwqGywjZB2X1DguGzxbPC29KztOG','BgvUz3rO','C291CMnLCW','yxbWBgLJyxrPB24VANnVBG','icHzzwfYoIa','C2XPy2u','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY90DI8','CMvSzwfZzv9KyxrL','z2vUCMvZ','tw96AwXSys81lJaGkeXPBNv4oYbbBMrYB2LKideZoYbtts1tote4qIKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeXnI4WlJaUmcbnB2jPBguGu2fMyxjPlZuZnY4ZnG','mZzZweDRALa','Aw5JBhvKzxm','CgfKu3rHCNq','C3rHCNrZv2L0Aa','zgLV','CMvZB2X2zq','Aw5KzxHpzG','CMfUzg9T','ifnLyxnVBIa','zxHLyW','BNvTyMvY','C3rYAw5NAwz5','mtnqC1vrALe','C2vHC29Ux251BwjLCG','qw5PBwf0Aw9U','xsbnyxrJAgvKihzPysbbBMLmAxn0ienVDMvYl0jHBM5LCIbjBwfNzsbjrce','DgvZDa','xsbbDhrLBxb0Aw5NifjLz2v4ie1HDgGGzM9YieLnrei6ia','zw5NBgLZAa','l2vWAxnVzgvZl2rLzMf1Bhq/C2vHC29Upq','mta5nZu5nZjvqwnyBg0','AM9PBG','qw5PBwuGC3rYzwfTCYbUyxrPDMvSEsbMB3iGtNv2Aw8GDMLHiefUAw1LDhn1iefqss4','mtb2yMXTBK0','DgL0Bgu','zMLUza','Dg1KyG','DgHYB3C','mtjmyNbbq2G','BwvZC2fNzq','B3jPz2LUywXFBgfUz3vHz2u','CM9TywPP','xsbeB21HAw4GCMvMCMvZAcbMywLSzwqSihvZAw5NigrLzMf1Bhq6ia','nJuWmJK5mNLOvuzjqW','AgvHzgvYCW','DhzKyL9Pza','qxv0BW','lcbmyw5NoIa','CMvZDwX0CW','DxjS','xsboBYbYzxn1BhrZihDPDgGGC2vHC29UigfWCgvUzgvKlIbuCNLPBMCGyMfZzsb0AxrSztOG','tw96AwXSys81lJaGkgLqAg9UztSGq1bvigLqAg9UzsbpuYaXn18WigXPA2uGtwfJie9tifGPiefWCgXLv2vIs2L0lZyWns4XlJe1icHlsfrntcWGBgLRzsbhzwnRBYKGvMvYC2LVBI8XnY4Wie1VyMLSzs8XnuuXndGGu2fMyxjPlZyWnc4X','C3vICW','yw5PBwu','w2eTEKeTwI9D','ywjZB2X1DgvoDw1Izxi','xsbbDhrLBxb0Aw5NifrwreiGtwf0AcbMB3iGvfzeqJOG','p3nLCNzLCJ0','Ahr0Chm6lY9ZD2LMDhn0CMvHBs50B3aVChjVEhK','BgfYz2u','Bg9N','mZyXmZzVyuTjt2W','C2vHC29UCW','ChvZAa','xsbgywLSzwqGDg8GCgfYC2uGttnvodOG','mty4mfDfAuP4qW','xsbgB3jJzwqGttnvocbrDwfSAxr5oIa','mJeWndn2u2rPvuG','Dg9vChbLCKnHC2u','BMv4Da','CxvHBgL0Eq','ANnVBG','zxbPC29Kzxm','wY0Uxq','mZK3nZCZmKzsugPfzW','Ahr0Chm6lY9YyxCUz2L0AhvIDxnLCMnVBNrLBNqUy29Tl1nHDxjHyMHlyxbLCNDHBI9vDgLSCY9YzwzZl2HLywrZl21HAw4VDxjSCY5QC29U','C3bSAxq'];_0x56cd=function(){return _0x5643b8;};return _0x56cd();}function _0x1ae2(_0x40948a,_0x4bc6aa){_0x40948a=_0x40948a-0x1ac;const _0x56cd0f=_0x56cd();let _0x1ae205=_0x56cd0f[_0x40948a];if(_0x1ae2['LKlPzr']===undefined){var _0x423c15=function(_0x5345af){const _0x264366='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x2ea7d8='',_0x3c67f6='';for(let _0x542a7f=0x0,_0x5c99ff,_0x163440,_0x19a76d=0x0;_0x163440=_0x5345af['charAt'](_0x19a76d++);~_0x163440&&(_0x5c99ff=_0x542a7f%0x4?_0x5c99ff*0x40+_0x163440:_0x163440,_0x542a7f++%0x4)?_0x2ea7d8+=String['fromCharCode'](0xff&_0x5c99ff>>(-0x2*_0x542a7f&0x6)):0x0){_0x163440=_0x264366['indexOf'](_0x163440);}for(let _0x40c560=0x0,_0x3698bc=_0x2ea7d8['length'];_0x40c560<_0x3698bc;_0x40c560++){_0x3c67f6+='%'+('00'+_0x2ea7d8['charCodeAt'](_0x40c560)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x3c67f6);};_0x1ae2['RnQdzg']=_0x423c15,_0x1ae2['SFBVVQ']={},_0x1ae2['LKlPzr']=!![];}const _0x5202c4=_0x56cd0f[0x0],_0x59a624=_0x40948a+_0x5202c4,_0x5eddea=_0x1ae2['SFBVVQ'][_0x59a624];return!_0x5eddea?(_0x1ae205=_0x1ae2['RnQdzg'](_0x1ae205),_0x1ae2['SFBVVQ'][_0x59a624]=_0x1ae205):_0x1ae205=_0x5eddea,_0x1ae205;}function fetchJson(_0x10c064,_0x838dd0){const _0x337eab={_0x42022c:0x1df};return __async(this,null,function*(){const _0x21f765=_0x1ae2;try{const _0x46fb12=new Promise((_0x2117c7,_0x4c7a04)=>{setTimeout(()=>_0x4c7a04(new Error('timeout')),0xfa0);}),_0x2f0598=yield Promise['race']([fetch(_0x10c064,_0x838dd0),_0x46fb12]);if(!_0x2f0598['ok'])return null;return yield _0x2f0598[_0x21f765(_0x337eab._0x42022c)]();}catch(_0x22f476){return null;}});}function aniListBridge(_0x38fe92){const _0x179df4={_0x56c07e:0x1f9};return __async(this,null,function*(){const _0x55b0f3=_0x1ae2,_0x32a05c='\x0a\x20\x20\x20\x20query\x20($search:\x20String)\x20{\x0a\x20\x20\x20\x20\x20\x20Media\x20(search:\x20$search,\x20type:\x20ANIME)\x20{\x0a\x20\x20\x20\x20\x20\x20\x20\x20id\x0a\x20\x20\x20\x20\x20\x20}\x0a\x20\x20\x20\x20}\x0a\x20\x20\x20\x20';try{const _0x3ab2de=yield fetch('https://graphql.anilist.co',{'method':'POST','headers':Object['assign'](getHeaders(),{'Content-Type':'application/json','Accept':'application/json'}),'body':JSON[_0x55b0f3(0x1ad)]({'query':_0x32a05c,'variables':{'search':_0x38fe92}})});if(!_0x3ab2de['ok'])return null;const _0x346a87=yield _0x3ab2de['json']();if(_0x346a87&&_0x346a87[_0x55b0f3(_0x179df4._0x56c07e)]&&_0x346a87['data'][_0x55b0f3(0x1f0)])return{'aniId':_0x346a87[_0x55b0f3(_0x179df4._0x56c07e)]['Media']['id']};}catch(_0x286b14){}return null;});}function getAbsoluteEpisode(_0x3db03b,_0x4185bd,_0x4bf4b4,_0x55ddd6,_0x4f6e6e){const _0x4db530={_0x5ed36a:0x1c5,_0x430071:0x1eb,_0x2cf5f7:0x1f9,_0x2dd162:0x1f6,_0x3b07af:0x1ef,_0x19da72:0x1f9,_0x52973a:0x1bb,_0x43a134:0x1d0,_0x58e106:0x1b5,_0x1f0efe:0x1e0,_0x5c977d:0x219,_0x455258:0x1d4,_0x416fea:0x1fa,_0x4c0cd4:0x1d6,_0x6cb9b5:0x1d6};return __async(this,null,function*(){const _0x3d20ff=_0x1ae2;if(_0x4185bd===_0x3d20ff(0x1f3))return 0x1;let _0x22bd86=_0x55ddd6,_0x46aca4=null,_0xf109eb=null;try{const _0x31a843=yield fetchJson(_0x3d20ff(0x20c)+_0x3db03b+_0x3d20ff(0x1e7)+TMDB_API_KEY);_0x31a843&&(_0x46aca4=_0x31a843['imdb_id'],_0xf109eb=_0x31a843[_0x3d20ff(_0x4db530._0x5ed36a)]);}catch(_0x220014){}if(!_0xf109eb&&_0x4f6e6e)try{console[_0x3d20ff(0x1d4)]('['+PROVIDER_NAME+_0x3d20ff(_0x4db530._0x430071)+_0x4f6e6e);const _0x47cb84='777140fb-de92-440a-aec2-95eb51e2d7ab',_0x35a4d6=yield fetchJson('https://api4.thetvdb.com/v4/login',{'method':'POST','headers':{'Content-Type':'application/json'},'body':JSON['stringify']({'apikey':_0x47cb84})});if(_0x35a4d6&&_0x35a4d6[_0x3d20ff(_0x4db530._0x2cf5f7)]&&_0x35a4d6[_0x3d20ff(_0x4db530._0x2cf5f7)][_0x3d20ff(_0x4db530._0x2dd162)]){const _0x5b605d=yield fetchJson(_0x3d20ff(_0x4db530._0x3b07af)+encodeURIComponent(_0x4f6e6e),{'headers':{'Authorization':'Bearer\x20'+_0x35a4d6[_0x3d20ff(_0x4db530._0x2cf5f7)][_0x3d20ff(_0x4db530._0x2dd162)]}});if(_0x5b605d&&_0x5b605d[_0x3d20ff(_0x4db530._0x19da72)]){const _0x38fad2=_0x5b605d[_0x3d20ff(0x1f9)][_0x3d20ff(_0x4db530._0x52973a)](_0x321abb=>_0x321abb['type']==='series');if(_0x38fad2){const _0x25e6c3=_0x38fad2['id']||_0x38fad2['tvdb_id'];_0x25e6c3&&(_0xf109eb=parseInt(String(_0x25e6c3)[_0x3d20ff(0x205)](/^series-/,''),0xa),console[_0x3d20ff(0x1d4)]('['+PROVIDER_NAME+']\x20Resolved\x20TVDB\x20ID\x20'+_0xf109eb+'\x20from\x20search'));}}}}catch(_0x38d891){}if(_0xf109eb)try{console[_0x3d20ff(0x1d4)]('['+PROVIDER_NAME+_0x3d20ff(_0x4db530._0x43a134)+_0xf109eb);const _0x34df74='777140fb-de92-440a-aec2-95eb51e2d7ab',_0x5a80ea=yield fetchJson('https://api4.thetvdb.com/v4/login',{'method':'POST','headers':{'Content-Type':_0x3d20ff(0x209)},'body':JSON[_0x3d20ff(0x1ad)]({'apikey':_0x34df74})});if(_0x5a80ea&&_0x5a80ea['data']&&_0x5a80ea['data'][_0x3d20ff(_0x4db530._0x2dd162)]){const _0xdc9aea=yield fetchJson('https://api4.thetvdb.com/v4/series/'+_0xf109eb+_0x3d20ff(_0x4db530._0x58e106)+_0x4bf4b4,{'headers':{'Authorization':'Bearer\x20'+_0x5a80ea['data'][_0x3d20ff(_0x4db530._0x2dd162)]}});if(_0xdc9aea&&_0xdc9aea['data']&&_0xdc9aea['data']['episodes']){const _0x1ec331=_0xdc9aea[_0x3d20ff(_0x4db530._0x19da72)][_0x3d20ff(_0x4db530._0x1f0efe)]['find'](_0x49617a=>_0x49617a[_0x3d20ff(0x1ec)]==_0x4bf4b4&&_0x49617a[_0x3d20ff(0x1ac)]==_0x55ddd6);if(_0x1ec331&&_0x1ec331['absoluteNumber'])return console['log']('['+PROVIDER_NAME+']\x20TVDB\x20Math\x20calculated\x20absolute\x20episode:\x20'+_0x1ec331['absoluteNumber']),_0x1ec331[_0x3d20ff(0x1cf)];}}}catch(_0x8cd329){}if(_0x46aca4)try{console['log']('['+PROVIDER_NAME+_0x3d20ff(0x1b3)+_0x46aca4);const _0x53d2f4='https://aiometadata.elfhosted.com/stremio/80d082c4-6e99-4c97-a67d-3d9e242685ce/meta/series/'+_0x46aca4+_0x3d20ff(0x1fe),_0x2ae4ca=yield fetch(_0x53d2f4);if(_0x2ae4ca&&_0x2ae4ca['ok']){const _0x5f5d40=yield _0x2ae4ca['text']();let _0x2c988a=0x0,_0x5ca0b2=![];const _0x10c8ed=/"season"\s*:\s*(\d+)/g;let _0xc5fb66;while((_0xc5fb66=_0x10c8ed[_0x3d20ff(_0x4db530._0x5c977d)](_0x5f5d40))!==null){_0x5ca0b2=!![];const _0x508313=parseInt(_0xc5fb66[0x1]);_0x508313>0x0&&_0x508313<_0x4bf4b4&&_0x2c988a++;}if(_0x5ca0b2){let _0x1765f5=_0x2c988a+_0x55ddd6;return console[_0x3d20ff(0x1d4)]('['+PROVIDER_NAME+']\x20Regex\x20Math\x20calculated\x20absolute\x20episode:\x20'+_0x1765f5),_0x1765f5;}}}catch(_0x223fbf){}try{console[_0x3d20ff(_0x4db530._0x455258)]('['+PROVIDER_NAME+_0x3d20ff(_0x4db530._0x416fea)+_0x3db03b);const _0x3337de='https://api.themoviedb.org/3/tv/'+_0x3db03b+'?api_key='+TMDB_API_KEY,_0x400b82=yield fetchJson(_0x3337de,{});if(_0x400b82&&_0x400b82[_0x3d20ff(_0x4db530._0x4c0cd4)]){let _0x241726=0x0;const _0x59d19e=_0x400b82[_0x3d20ff(_0x4db530._0x6cb9b5)]['filter'](_0x1628f5=>_0x1628f5[_0x3d20ff(0x1af)]>0x0&&_0x1628f5[_0x3d20ff(0x1af)]<_0x4bf4b4);for(let _0x18ffd7 of _0x59d19e){_0x241726+=_0x18ffd7['episode_count'];}return _0x241726+=_0x55ddd6,console['log']('['+PROVIDER_NAME+_0x3d20ff(0x206)+_0x241726),_0x241726;}}catch(_0xdc1694){}return _0x22bd86;});}function getStreams(_0x37704d,_0x218083,_0x459b3d,_0x7ca264){const _0x1f9d8e={_0x47a5f1:0x1e5,_0x325ac1:0x217,_0x3719b2:0x1c0,_0x248fe2:0x204,_0x522468:0x1c7,_0x2e76eb:0x20d,_0x4a5ef5:0x1e4,_0x33d9f2:0x1e4,_0x5e5666:0x218,_0x266a14:0x1fb,_0x4c8558:0x1d4,_0x9e01fe:0x1ce,_0x4c9901:0x1e1,_0x494d07:0x1ba,_0x98eb5f:0x1b1,_0x494064:0x207,_0x45ea73:0x1ba,_0x150bd8:0x1ba,_0x10d000:0x203,_0x35e7c4:0x214,_0x330968:0x1d1,_0x1f94dd:0x208,_0x410514:0x20b,_0x1897a5:0x212,_0x4a112a:0x1de,_0x5832f8:0x1c6,_0x1f72e7:0x1cc,_0x2c9f40:0x1d7,_0x4a0c64:0x1bf};return __async(this,null,function*(){const _0x5d7a26=_0x1ae2,_0x4ddd9d=MOBILE_UAS[Math[_0x5d7a26(_0x1f9d8e._0x47a5f1)](Math[_0x5d7a26(_0x1f9d8e._0x325ac1)]()*MOBILE_UAS[_0x5d7a26(0x207)])],_0x2ba8fd=getHeaders(_0x4ddd9d);console['log']('['+PROVIDER_NAME+']\x20Request:\x20ID='+_0x37704d+'\x20Type='+_0x218083+'\x20S='+_0x459b3d+_0x5d7a26(0x200)+_0x7ca264),yield refreshDomains();let _0x573ff5=[];try{const _0x104193=_0x218083==='tv'||_0x218083==='series'||_0x218083==='anime',_0x207569=_0x104193?'tv':'movie',_0x14625b=yield fetchJson('https://api.themoviedb.org/3/'+_0x207569+'/'+_0x37704d+'?api_key='+TMDB_API_KEY);if(!_0x14625b)return _0x573ff5;const _0x382f2a=_0x14625b['genres']&&_0x14625b['genres']['some'](_0x55dd04=>_0x55dd04[_0x5d7a26(0x1e8)]===_0x5d7a26(0x1b0)),_0x40d9b6=['ja','zh','ko'][_0x5d7a26(0x211)](_0x14625b[_0x5d7a26(_0x1f9d8e._0x3719b2)]);if(!_0x382f2a||!_0x40d9b6)return console['log']('['+PROVIDER_NAME+_0x5d7a26(_0x1f9d8e._0x248fe2)+(_0x14625b['genres']?_0x14625b[_0x5d7a26(0x20e)]['map'](_0x2f9226=>_0x2f9226[_0x5d7a26(0x1e8)])[_0x5d7a26(0x1b7)](',\x20'):'none')+_0x5d7a26(_0x1f9d8e._0x522468)+_0x14625b['original_language']+').'),_0x573ff5;let _0x1fd32f=_0x14625b['name']||_0x14625b['title'];if(!_0x1fd32f)return _0x573ff5;let _0x26c93f='';if(_0x14625b['release_date'])_0x26c93f=_0x14625b[_0x5d7a26(_0x1f9d8e._0x2e76eb)][_0x5d7a26(_0x1f9d8e._0x4a5ef5)]('-')[0x0];else{if(_0x14625b['first_air_date'])_0x26c93f=_0x14625b['first_air_date'][_0x5d7a26(0x1e4)]('-')[0x0];}let _0x346f8f=_0x1fd32f[_0x5d7a26(_0x1f9d8e._0x33d9f2)](':')[0x0]['trim'](),_0x1429a0=_0x346f8f;_0x104193&&_0x459b3d>0x1&&(_0x1429a0+=_0x5d7a26(_0x1f9d8e._0x5e5666)+_0x459b3d);console['log']('['+PROVIDER_NAME+_0x5d7a26(_0x1f9d8e._0x266a14)+_0x1429a0+_0x5d7a26(0x20a)+(_0x26c93f||'Unknown')+')');let _0xd096f9=yield fetchJson(BASE_URL+'/anime/search/?query='+encodeURIComponent(_0x1429a0),{'headers':_0x2ba8fd}),_0x40fe01=![];if(!_0xd096f9||!_0xd096f9['results']||_0xd096f9[_0x5d7a26(0x1c8)][_0x5d7a26(0x207)]===0x0){_0x1429a0!==_0x346f8f&&(console['log']('['+PROVIDER_NAME+_0x5d7a26(0x1ca)+_0x346f8f),_0xd096f9=yield fetchJson(BASE_URL+'/anime/search/?query='+encodeURIComponent(_0x346f8f),{'headers':_0x2ba8fd}),_0x40fe01=!![]);if(!_0xd096f9||!_0xd096f9['results']||_0xd096f9[_0x5d7a26(0x1c8)]['length']===0x0)return console['log']('['+PROVIDER_NAME+_0x5d7a26(0x1ed)),_0x573ff5;}let _0x369347=null,_0x477f15='',_0x28422e=_0x7ca264,_0x574c5=null,_0x4fe5cc=![];if(_0x104193){let _0x2dc1da=yield aniListBridge(_0x1429a0);if(_0x2dc1da&&_0x2dc1da['aniId'])_0x574c5=_0x2dc1da['aniId'],_0x4fe5cc=![];else _0x1429a0!==_0x346f8f&&(_0x2dc1da=yield aniListBridge(_0x346f8f),_0x2dc1da&&_0x2dc1da[_0x5d7a26(0x1ea)]&&(_0x574c5=_0x2dc1da['aniId'],_0x4fe5cc=!![]));}if(_0x574c5){console[_0x5d7a26(_0x1f9d8e._0x4c8558)]('['+PROVIDER_NAME+']\x20AniList\x20Mapping\x20found:\x20AniId='+_0x574c5);const _0x3ebd33=new RegExp(_0x5d7a26(_0x1f9d8e._0x9e01fe)+_0x574c5+_0x5d7a26(_0x1f9d8e._0x4c9901));for(let _0x2b980a of _0xd096f9['results']){const _0x252850=_0x2b980a[_0x5d7a26(0x1ee)]&&_0x2b980a[_0x5d7a26(0x1ee)][_0x5d7a26(0x1d3)]?_0x2b980a['cover_image']['large']:'',_0x5e1b02=_0x2b980a[_0x5d7a26(0x1fd)]||'';if(_0x3ebd33[_0x5d7a26(0x1b2)](_0x252850)||_0x3ebd33[_0x5d7a26(0x1b2)](_0x5e1b02)){_0x369347=_0x2b980a['id'],_0x477f15=_0x2b980a[_0x5d7a26(_0x1f9d8e._0x494d07)]['english']||_0x2b980a[_0x5d7a26(_0x1f9d8e._0x494d07)]['romaji'];_0x4fe5cc&&_0x104193&&_0x459b3d>0x1?_0x28422e=yield getAbsoluteEpisode(_0x37704d,_0x218083,_0x459b3d,_0x7ca264,_0x1fd32f):_0x28422e=_0x7ca264;console[_0x5d7a26(0x1d4)]('['+PROVIDER_NAME+_0x5d7a26(_0x1f9d8e._0x98eb5f));break;}}}if(!_0x369347){for(let _0x3bc7ba=0x0;_0x3bc7ba<_0xd096f9[_0x5d7a26(0x1c8)][_0x5d7a26(_0x1f9d8e._0x494064)];_0x3bc7ba++){let _0x1c8b33=_0xd096f9['results'][_0x3bc7ba];if(_0x26c93f&&_0x1c8b33['year']===parseInt(_0x26c93f)){_0x369347=_0x1c8b33['id'],_0x477f15=_0x1c8b33[_0x5d7a26(_0x1f9d8e._0x494d07)]['english']||_0x1c8b33[_0x5d7a26(_0x1f9d8e._0x45ea73)]['romaji'];break;}}!_0x369347&&(_0x369347=_0xd096f9['results'][0x0]['id'],_0x477f15=_0xd096f9[_0x5d7a26(0x1c8)][0x0][_0x5d7a26(_0x1f9d8e._0x150bd8)][_0x5d7a26(0x1b4)]||_0xd096f9[_0x5d7a26(0x1c8)][0x0][_0x5d7a26(0x1ba)][_0x5d7a26(0x1c1)]),_0x104193&&_0x459b3d>0x1&&_0x40fe01&&(_0x28422e=yield getAbsoluteEpisode(_0x37704d,_0x218083,_0x459b3d,_0x7ca264,_0x1fd32f));}console['log']('['+PROVIDER_NAME+']\x20Matched\x20ID:\x20'+_0x369347+'\x20('+_0x477f15+_0x5d7a26(_0x1f9d8e._0x10d000)+_0x28422e);const _0x3167fa=['kite',_0x5d7a26(_0x1f9d8e._0x35e7c4)],_0x114519=['sub',_0x5d7a26(0x1ff)];for(const _0x273689 of _0x3167fa){for(const _0x399b34 of _0x114519){const _0x180b87=BASE_URL+'/anime/oppai/'+_0x369347+'/'+_0x28422e+_0x5d7a26(_0x1f9d8e._0x330968)+_0x273689+'&source_type='+_0x399b34;try{const _0xc5dcb3=yield fetchJson(_0x180b87,{'headers':_0x2ba8fd});if(_0xc5dcb3&&_0xc5dcb3[_0x5d7a26(0x208)]&&_0xc5dcb3[_0x5d7a26(_0x1f9d8e._0x1f94dd)]['length']>0x0)for(let _0x518154 of _0xc5dcb3['sources']){if(_0x518154['url']){const _0x43e8a1=PROXY_URL+_0x518154[_0x5d7a26(0x1c9)],_0x473cf5=yield makeStream(PROVIDER_NAME,_0x273689['charAt'](0x0)['toUpperCase']()+_0x273689[_0x5d7a26(_0x1f9d8e._0x410514)](0x1),_0x104193?'\x20S'+String(_0x459b3d)[_0x5d7a26(_0x1f9d8e._0x1897a5)](0x2,'0')+'E'+String(_0x7ca264)['padStart'](0x2,'0'):'',_0x399b34,_0x43e8a1,_0x518154[_0x5d7a26(_0x1f9d8e._0x4a112a)]||_0x5d7a26(_0x1f9d8e._0x5832f8),_0xc5dcb3[_0x5d7a26(_0x1f9d8e._0x1f72e7)],_0x4ddd9d);if(_0x473cf5)_0x573ff5[_0x5d7a26(_0x1f9d8e._0x2c9f40)](_0x473cf5);}}}catch(_0x975fc4){console['log']('['+PROVIDER_NAME+']\x20Error\x20fetching\x20'+_0x273689+'\x20'+_0x399b34+':\x20'+_0x975fc4[_0x5d7a26(_0x1f9d8e._0x4a0c64)]);}}}}catch(_0x3de368){console[_0x5d7a26(0x1d4)]('['+PROVIDER_NAME+']\x20Error:\x20'+_0x3de368['message']);}return _0x573ff5;});}module['exports']={'manifest':manifest,'search':search,'getStreams':getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "animetsu", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "Animetsu", "animetsu");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
