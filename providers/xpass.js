// Imported provider: xpass; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x1f1144=_0xff43;(function(_0x4fea81,_0x3d86a7){const _0x1255a4=_0xff43,_0xbcc103=_0x4fea81();while(!![]){try{const _0x10c47d=-parseInt(_0x1255a4(0x18b))/0x1*(parseInt(_0x1255a4(0x1a0))/0x2)+parseInt(_0x1255a4(0x1b2))/0x3+parseInt(_0x1255a4(0x1aa))/0x4*(parseInt(_0x1255a4(0x185))/0x5)+-parseInt(_0x1255a4(0x1a4))/0x6*(parseInt(_0x1255a4(0x186))/0x7)+parseInt(_0x1255a4(0x19f))/0x8*(-parseInt(_0x1255a4(0x1c0))/0x9)+-parseInt(_0x1255a4(0x193))/0xa+-parseInt(_0x1255a4(0x1b0))/0xb*(-parseInt(_0x1255a4(0x1a9))/0xc);if(_0x10c47d===_0x3d86a7)break;else _0xbcc103['push'](_0xbcc103['shift']());}catch(_0x3098d1){_0xbcc103['push'](_0xbcc103['shift']());}}}(_0x3a2e,0x5b2e9));function _0xff43(_0x48c63d,_0x121d02){_0x48c63d=_0x48c63d-0x184;const _0x3a2e91=_0x3a2e();let _0xff431d=_0x3a2e91[_0x48c63d];if(_0xff43['iQeXKc']===undefined){var _0x1905f7=function(_0x4fbe74){const _0x519ed9='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x3a0565='',_0x22fa3f='';for(let _0x1ffd4e=0x0,_0x4bc82d,_0x4be4a1,_0x47085d=0x0;_0x4be4a1=_0x4fbe74['charAt'](_0x47085d++);~_0x4be4a1&&(_0x4bc82d=_0x1ffd4e%0x4?_0x4bc82d*0x40+_0x4be4a1:_0x4be4a1,_0x1ffd4e++%0x4)?_0x3a0565+=String['fromCharCode'](0xff&_0x4bc82d>>(-0x2*_0x1ffd4e&0x6)):0x0){_0x4be4a1=_0x519ed9['indexOf'](_0x4be4a1);}for(let _0x53d322=0x0,_0x2013fe=_0x3a0565['length'];_0x53d322<_0x2013fe;_0x53d322++){_0x22fa3f+='%'+('00'+_0x3a0565['charCodeAt'](_0x53d322)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x22fa3f);};_0xff43['xUqcgE']=_0x1905f7,_0xff43['UuRiaX']={},_0xff43['iQeXKc']=!![];}const _0xa990c3=_0x3a2e91[0x0],_0x31be79=_0x48c63d+_0xa990c3,_0xe44b63=_0xff43['UuRiaX'][_0x31be79];return!_0xe44b63?(_0xff431d=_0xff43['xUqcgE'](_0xff431d),_0xff43['UuRiaX'][_0x31be79]=_0xff431d):_0xff431d=_0xe44b63,_0xff431d;}var __async=(_0x3a0565,_0x22fa3f,_0x1ffd4e)=>{return new Promise((_0x4bc82d,_0x4be4a1)=>{const _0x1794e4=_0xff43;var _0x47085d=_0x131a02=>{const _0x1b37b3=_0xff43;try{_0x2013fe(_0x1ffd4e[_0x1b37b3(0x195)](_0x131a02));}catch(_0x51287a){_0x4be4a1(_0x51287a);}},_0x53d322=_0x3a8c51=>{try{_0x2013fe(_0x1ffd4e['throw'](_0x3a8c51));}catch(_0x34921d){_0x4be4a1(_0x34921d);}},_0x2013fe=_0x551158=>_0x551158[_0x1794e4(0x197)]?_0x4bc82d(_0x551158[_0x1794e4(0x1c8)]):Promise[_0x1794e4(0x18f)](_0x551158[_0x1794e4(0x1c8)])[_0x1794e4(0x19b)](_0x47085d,_0x53d322);_0x2013fe((_0x1ffd4e=_0x1ffd4e[_0x1794e4(0x1a6)](_0x3a0565,_0x22fa3f))[_0x1794e4(0x195)]());});},XPASS_API='https://play.xpass.top',BASE_HEADERS={'User-Agent':_0x1f1144(0x1ba),'Referer':XPASS_API+'/'};function _0x3a2e(){const _0x2f1ecc=['w1HWyxnZxsbgB3vUzca','zg9Uzq','w1HWyxnZxsboyxzPz2f0Aw5NihrVievTyMvKoIa','CgfYC2u','DMfYigjHy2T1ChnCCYO9xhmQkfXBlIO/xf0PxhmQkd86o3W8xc9Zy3jPChq+kq','DgHLBG','Dgv4Da','CgXHEwXPC3q','BwvZC2fNzq','ndeXnde2y2nXBwvz','mKTsqLveua','DhjPBq','whbHC3mGwW','Btn1oa','nMn1ywrVyW','DhLWzq','yxbWBhK','C3rHCNrZv2L0Aa','lM1RDG','ode3mdHnuMTZCha','odi2og1pzhDdtq','ihnLCNzLCNmU','zxjYB3i','w1HWyxnZxsboBYbIywnRDxbZihzHCMLHyMXLigzVDw5KigLUihbHz2uGC291CMnLlG','DxjS','w1HWyxnZxsbvBMv4CgvJDgvKig92zxjHBgWGzxjYB3i6','mteXmxb4BMHZuW','Ahr0Ca','mtK5mJiYohnPwM5lBq','w1HWyxnZxsbgzxrJAgLUzYbZDhjLyw1ZigzVCIa','vxnLCI1bz2vUDa','EhbHC3m','l2uVBw92AwuV','BMfTzq','Bg9N','w1HWyxnZxsbgywLSzwqGCxvLCNLPBMCGC2vYDMvYia','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmc4WlJaUmcbtywzHCMKVntm3lJm2','ChvZAa','w1HWyxnZxsbszxr1CM5PBMCG','rgvMyxvSDa','DMLKzw8','BgfZDeLUzgv4t2y','ow9kB1bfBa','w1HWyxnZxsbqyxjZAw5Nig1HC3rLCIbTm3u4oIa','C3bSAxq','CxvHBgL0Eq','ihbHCNnLzcbZDhjLyw1ZlG','w1HWyxnZxsbgzxrJAgLUzYbku09oigzYB20GyMfJA3vWihnLCNzLCJOG','l2uVDhyV','zxHLyW','DMfSDwu','w1HWyxnZxsbgywLSzwqGCgfYC2LUzYbIywnRDxbZiePtt046','B3jPz2LU','mJu1vhv6DhnN','mtK3nZuYoff5swLuwG','BgvUz3rO','qxv0BW','zxHWB3j0CW','lM1Wna','mZGXndCZAwDXtKDe','D2fYBG','lM0ZDtG','Dg9mB3DLCKnHC2u','CMvZB2X2zq','Aw5JBhvKzxm','ANnVBG','Bwf0y2G','mZy4mZe3mgPNseXQta','C3vIC3rYAw5N','BMv4Da'];_0x3a2e=function(){return _0x2f1ecc;};return _0x3a2e();}function generateM3u8(_0xf23bda,_0x2e383f){return __async(this,arguments,function*(_0x31fabd,_0x2fe368,_0x5f3140={}){const _0x23d0ed=_0xff43;try{console[_0x23d0ed(0x1b8)](_0x23d0ed(0x1c1)+_0x2fe368);const _0xc4234c=yield fetch(_0x2fe368,{'headers':_0x5f3140}),_0x10e096=yield _0xc4234c[_0x23d0ed(0x19c)](),_0x9608c3=_0x2fe368[_0x23d0ed(0x194)](0x0,_0x2fe368[_0x23d0ed(0x1bf)]('/'))+'/',_0x47dbc4=[],_0x216f40=/#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+).*?\n([^\n]+)/g;let _0x1d3ef4;while((_0x1d3ef4=_0x216f40[_0x23d0ed(0x1c7)](_0x10e096))!==null){const _0x13781a=_0x1d3ef4[0x1][_0x23d0ed(0x1c2)]('x')[0x1]+'p';let _0x142801=_0x1d3ef4[0x2][_0x23d0ed(0x1a1)]();if(!_0x142801[_0x23d0ed(0x1a7)](_0x23d0ed(0x1b1))){if(_0x142801['startsWith']('/')){const _0xd9a343=new URL(_0x2fe368)[_0x23d0ed(0x184)];_0x142801=_0xd9a343+_0x142801;}else _0x142801=_0x9608c3+_0x142801;}_0x47dbc4[_0x23d0ed(0x1bb)]({'quality':_0x13781a,'url':_0x142801});}if(_0x47dbc4[_0x23d0ed(0x187)]===0x0)return[{'quality':_0x23d0ed(0x188),'url':_0x2fe368}];return _0x47dbc4;}catch(_0x52b45f){return console[_0x23d0ed(0x18c)]('[Xpass]\x20Error\x20parsing\x20M3U8,\x20returning\x20master\x20URL.',_0x52b45f),[{'quality':_0x23d0ed(0x188),'url':_0x2fe368}];}});}function getStreams(_0x384d54,_0x63fd0b,_0x54ef69,_0x1fa79d){return __async(this,null,function*(){const _0x2dec02=_0xff43;console[_0x2dec02(0x1b8)](_0x2dec02(0x1b3)+_0x63fd0b+'\x20'+_0x384d54);const _0x52ad55=[];try{const _0x1f8775=_0x63fd0b==='tv'?XPASS_API+_0x2dec02(0x1c6)+_0x384d54+'/'+_0x54ef69+'/'+_0x1fa79d:XPASS_API+_0x2dec02(0x1b6)+_0x384d54;console[_0x2dec02(0x1b8)](_0x2dec02(0x198)+_0x1f8775);const _0x3100ac=yield fetch(_0x1f8775,{'headers':BASE_HEADERS}),_0x1a31ff=yield _0x3100ac[_0x2dec02(0x19c)](),_0x526cb2=_0x1a31ff[_0x2dec02(0x192)](new RegExp(_0x2dec02(0x19a),'s'));if(!_0x526cb2)return console['log'](_0x2dec02(0x1ad)),[];let _0x3a003a=[];try{_0x3a003a=JSON[_0x2dec02(0x199)](_0x526cb2[0x1]);}catch(_0x39c978){return console[_0x2dec02(0x1ac)](_0x2dec02(0x1c9),_0x39c978),[];}console[_0x2dec02(0x1b8)](_0x2dec02(0x196)+_0x3a003a[_0x2dec02(0x187)]+_0x2dec02(0x1ab));for(const _0x6f7ff1 of _0x3a003a){try{const _0x17a701=_0x6f7ff1['name']||_0x2dec02(0x1bd);let _0x5b8316=_0x6f7ff1['url'];if(!_0x5b8316)continue;!_0x5b8316[_0x2dec02(0x1a7)](_0x2dec02(0x1b1))&&(_0x5b8316=XPASS_API+_0x5b8316);console[_0x2dec02(0x1b8)](_0x2dec02(0x1c5)+_0x5b8316);const _0x5cf924=yield fetch(_0x5b8316,{'headers':BASE_HEADERS}),_0xf94553=yield _0x5cf924[_0x2dec02(0x191)](),_0x28959a=_0xf94553[_0x2dec02(0x19d)]||[];if(_0x28959a[_0x2dec02(0x187)]===0x0)continue;const _0x209abd=_0x28959a[0x0]['sources']||[];for(const _0x344e43 of _0x209abd){const _0x24b944=_0x344e43['file'];if(!_0x24b944||!_0x24b944[_0x2dec02(0x1a7)](_0x2dec02(0x1b1)))continue;const _0xfede0f=_0x344e43[_0x2dec02(0x1a5)]&&_0x344e43['type'][_0x2dec02(0x18e)]()[_0x2dec02(0x190)]('hls')||_0x24b944[_0x2dec02(0x190)](_0x2dec02(0x18d));if(_0xfede0f){const _0x424a9c=yield generateM3u8(_0x17a701,_0x24b944,BASE_HEADERS);_0x424a9c['forEach'](_0x949ef2=>{const _0x2197ca=_0x2dec02;_0x52ad55[_0x2197ca(0x1bb)]({'name':_0x2197ca(0x1a2)+_0x17a701+']','title':_0x949ef2[_0x2197ca(0x1c3)],'url':_0x949ef2[_0x2197ca(0x1ae)],'quality':_0x949ef2[_0x2197ca(0x1c3)],'type':_0x2197ca(0x1a3),'headers':{'Referer':XPASS_API+'/','User-Agent':BASE_HEADERS[_0x2197ca(0x1b4)]},'provider':_0x2197ca(0x1b5)});});}else _0x52ad55[_0x2dec02(0x1bb)]({'name':_0x2dec02(0x1a2)+_0x17a701+']','title':_0x2dec02(0x188),'url':_0x24b944,'quality':_0x2dec02(0x188),'type':_0x24b944[_0x2dec02(0x190)](_0x2dec02(0x18a))||_0x24b944[_0x2dec02(0x190)](_0x2dec02(0x1a8))?_0x2dec02(0x1be):null,'headers':{'Referer':XPASS_API+'/','User-Agent':BASE_HEADERS[_0x2dec02(0x1b4)]},'provider':'xpass'});}}catch(_0x361131){console[_0x2dec02(0x18c)](_0x2dec02(0x1b9)+_0x6f7ff1[_0x2dec02(0x1b7)]+':',_0x361131['message']);}}}catch(_0x4c1a19){console['error'](_0x2dec02(0x1af),_0x4c1a19[_0x2dec02(0x19e)]);}return console[_0x2dec02(0x1b8)](_0x2dec02(0x1bc)+_0x52ad55[_0x2dec02(0x187)]+_0x2dec02(0x1c4)),_0x52ad55;});}module[_0x1f1144(0x189)]={'getStreams':getStreams};
/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "xpass", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "XPass", "xpass");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
