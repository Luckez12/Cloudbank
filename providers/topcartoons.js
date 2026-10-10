// Imported provider: topcartoons; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
const _0x52744c=_0x3235;(function(_0x2922cb,_0x2015f6){const _0x8137d=_0x3235,_0x136205=_0x2922cb();while(!![]){try{const _0x346daa=parseInt(_0x8137d(0xa3))/0x1*(parseInt(_0x8137d(0xa2))/0x2)+parseInt(_0x8137d(0x9b))/0x3+-parseInt(_0x8137d(0xc1))/0x4*(-parseInt(_0x8137d(0xb0))/0x5)+-parseInt(_0x8137d(0x9e))/0x6+parseInt(_0x8137d(0xae))/0x7*(parseInt(_0x8137d(0xa1))/0x8)+parseInt(_0x8137d(0xaf))/0x9+-parseInt(_0x8137d(0xa4))/0xa*(parseInt(_0x8137d(0xbc))/0xb);if(_0x346daa===_0x2015f6)break;else _0x136205['push'](_0x136205['shift']());}catch(_0x57d2b7){_0x136205['push'](_0x136205['shift']());}}}(_0x1ca4,0x95260));var __async=(_0x172586,_0x2c8c42,_0x277790)=>{return new Promise((_0x10746e,_0x24dcca)=>{const _0x1a3b9f=_0x3235;var _0x2647aa=_0x299787=>{const _0x123da3=_0x3235;try{_0x4de87b(_0x277790[_0x123da3(0xb3)](_0x299787));}catch(_0x1495e4){_0x24dcca(_0x1495e4);}},_0x428bea=_0x306d8d=>{const _0x45c1ce=_0x3235;try{_0x4de87b(_0x277790[_0x45c1ce(0xbf)](_0x306d8d));}catch(_0x661ca7){_0x24dcca(_0x661ca7);}},_0x4de87b=_0x2698ee=>_0x2698ee[_0x1a3b9f(0xa9)]?_0x10746e(_0x2698ee[_0x1a3b9f(0xa8)]):Promise[_0x1a3b9f(0xb9)](_0x2698ee[_0x1a3b9f(0xa8)])['then'](_0x2647aa,_0x428bea);_0x4de87b((_0x277790=_0x277790[_0x1a3b9f(0xc7)](_0x172586,_0x2c8c42))[_0x1a3b9f(0xb3)]());});},cheerio=require(_0x52744c(0xbb)),BASE_URL=_0x52744c(0xc0),TMDB_API_KEY=_0x52744c(0x9a),HEADERS={'User-Agent':_0x52744c(0xc5),'Referer':BASE_URL+'/'};function _0x3235(_0x4deef4,_0x2ef761){_0x4deef4=_0x4deef4-0x9a;const _0x1ca425=_0x1ca4();let _0x32355a=_0x1ca425[_0x4deef4];if(_0x3235['GMSmoP']===undefined){var _0x46fd86=function(_0x200ac8){const _0x350a89='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';let _0x172586='',_0x2c8c42='';for(let _0x277790=0x0,_0x10746e,_0x24dcca,_0x2647aa=0x0;_0x24dcca=_0x200ac8['charAt'](_0x2647aa++);~_0x24dcca&&(_0x10746e=_0x277790%0x4?_0x10746e*0x40+_0x24dcca:_0x24dcca,_0x277790++%0x4)?_0x172586+=String['fromCharCode'](0xff&_0x10746e>>(-0x2*_0x277790&0x6)):0x0){_0x24dcca=_0x350a89['indexOf'](_0x24dcca);}for(let _0x428bea=0x0,_0x4de87b=_0x172586['length'];_0x428bea<_0x4de87b;_0x428bea++){_0x2c8c42+='%'+('00'+_0x172586['charCodeAt'](_0x428bea)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x2c8c42);};_0x3235['dJRpLG']=_0x46fd86,_0x3235['PInbru']={},_0x3235['GMSmoP']=!![];}const _0x204040=_0x1ca425[0x0],_0x3c9c42=_0x4deef4+_0x204040,_0x3ba26f=_0x3235['PInbru'][_0x3c9c42];return!_0x3ba26f?(_0x32355a=_0x3235['dJRpLG'](_0x32355a),_0x3235['PInbru'][_0x3c9c42]=_0x32355a):_0x32355a=_0x3ba26f,_0x32355a;}function _0x1ca4(){const _0x2272e1=['w1rVCenHCNrVB25Zxq','p2fWAv9RzxK9','zxjYB3i','DMfSDwu','zg9Uzq','zwfJAa','Dw5KzwzPBMvK','mta4mha','vw5RBM93BG','nte0nte0qxzWDLjq','odq5mZKXmMPsqwzfuq','mJvny2jguhO','DgL0Bgu','mJe2mha','BMv4Da','zMLYC3q','Dgv4Da','C3rHCNrZv2L0Aa','nZiWCa','Ahr0Chm6lY9HCgKUDgHLBw92AwvKyI5VCMCVmY8','CMvZB2X2zq','ndGWCa','y2HLzxjPBY13AxrOB3v0lw5VzguTBMf0AxzL','otLxB0DiAwC','AhjLzG','yxr0CG','DgHYB3C','Ahr0Chm6lY93D3CUDg9Wy2fYDg9VBNmUDhy','otmYmJG0C0LfrgfR','lZ9Zpq','Aw5JBhvKzxm','vg9Wq2fYDg9VBNm','tw96AwXSys81lJaGkfDPBMrVD3mGtLqGmtaUmdSGv2LUnJq7ihG2ncKGqxbWBgvxzwjlAxqVntm3lJm2icHlsfrntcWGBgLRzsbhzwnRBYKGq2HYB21LlZeYmc4WlJaUmcbtywzHCMKVntm3lJm2','ANnVBG','yxbWBhK','zMLUza','Bg9Hza','ChvZAa','yxj0AwnSzsbH','mtG2nwy0m2eWntq5y2e1mgqZndfKzdLHyJHImJLMndK','mZq4mdK5mgzjz0D2zq','BMfTzq','Ahr0Ca','mJGWnJe2neHQuKnUuq','zxHWB3j0CW','Bwv0yvTWCM9Wzxj0Et0IB2C6DMLKzw86DxjSiL0','odHSCwLpsgm','mtqYq1rAEePi','ndeWnKDYyMDftW','mZy1nJu1mfvwr2TszG'];_0x1ca4=function(){return _0x2272e1;};return _0x1ca4();}function extractQuality(_0x529f17){const _0x1ca117=_0x52744c,_0x4de897=(_0x529f17||'')['toLowerCase']();if(_0x4de897[_0x1ca117(0xc3)](_0x1ca117(0xb2))||_0x4de897[_0x1ca117(0xc3)]('4k'))return'4K';if(_0x4de897[_0x1ca117(0xc3)](_0x1ca117(0xac)))return _0x1ca117(0xac);if(_0x4de897['includes'](_0x1ca117(0xb7)))return'720p';if(_0x4de897['includes'](_0x1ca117(0xba)))return'480p';return _0x1ca117(0xad);}function getStreams(_0x492b3c,_0x102a04,_0x3a8ce0,_0x47acce){return __async(this,null,function*(){const _0x188d52=_0x3235;try{const _0xddf9b=_0x188d52(0xb8)+_0x102a04+'/'+_0x492b3c+_0x188d52(0xa6)+TMDB_API_KEY,_0x3d6784=yield(yield fetch(_0xddf9b))[_0x188d52(0xc6)](),_0x2d4063=_0x3d6784[_0x188d52(0xb1)]||_0x3d6784[_0x188d52(0x9c)];if(!_0x2d4063)return[];const _0x1b0164=BASE_URL+_0x188d52(0xc2)+encodeURIComponent(_0x2d4063),_0x24c27f=yield(yield fetch(_0x1b0164,{'headers':HEADERS}))[_0x188d52(0xb5)](),_0x2f6a4b=cheerio[_0x188d52(0xc9)](_0x24c27f),_0x42c3bf=_0x2f6a4b(_0x188d52(0xcb))[_0x188d52(0xb4)]();let _0x5dadc7=_0x42c3bf[_0x188d52(0xbe)](_0x188d52(0xbd));if(!_0x5dadc7)return[];if(!_0x5dadc7[_0x188d52(0xb6)](_0x188d52(0x9d)))_0x5dadc7=BASE_URL+_0x5dadc7;const _0x2ae304=yield(yield fetch(_0x5dadc7,{'headers':HEADERS}))[_0x188d52(0xb5)](),_0x5ddd85=cheerio['load'](_0x2ae304),_0x176500=[];_0x5ddd85('article\x20article')[_0x188d52(0xaa)]((_0x30ee9f,_0x51ddc9)=>{const _0x165f5e=_0x188d52,_0x36ca37=_0x5ddd85(_0x51ddc9)[_0x165f5e(0xc8)]('a')['attr']('href'),_0x1f62ed=_0x5ddd85(_0x51ddc9)[_0x165f5e(0xc8)]('h3\x20a')['text']()['trim']();if(_0x36ca37)_0x176500[_0x165f5e(0xca)]({'href':_0x36ca37,'name':_0x1f62ed});});let _0x427e08=_0x5dadc7;if(_0x176500['length']>0x0&&_0x102a04==='tv'&&_0x47acce!=null){const _0x1e8888=parseInt(_0x47acce)-0x1;_0x1e8888>=0x0&&_0x1e8888<_0x176500['length']?_0x427e08=_0x176500[_0x1e8888][_0x188d52(0xbd)]:_0x427e08=_0x176500[0x0]['href'];}else _0x176500['length']>0x0&&(_0x427e08=_0x176500[0x0]['href']);if(!_0x427e08['startsWith'](_0x188d52(0x9d)))_0x427e08=BASE_URL+_0x427e08;const _0x30148f=yield(yield fetch(_0x427e08,{'headers':HEADERS}))[_0x188d52(0xb5)](),_0x33db12=cheerio[_0x188d52(0xc9)](_0x30148f),_0x60bea3=_0x33db12(_0x188d52(0xa0))[_0x188d52(0xbe)]('content')||'';if(!_0x60bea3)return[];return[{'name':_0x188d52(0xc4),'url':_0x60bea3,'quality':extractQuality(_0x60bea3),'title':_0x188d52(0xc4),'subtitles':[],'behaviorHints':{'notWebReady':!![],'proxyHeaders':{'request':Object['assign']({},HEADERS)}}}];}catch(_0x27c91f){return console[_0x188d52(0xa7)](_0x188d52(0xa5),_0x27c91f),[];}});}typeof module!==_0x52744c(0xab)&&module[_0x52744c(0x9f)]&&(module[_0x52744c(0x9f)]={'getStreams':getStreams});

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "topcartoons", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "TopCartoons", "topcartoons");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
