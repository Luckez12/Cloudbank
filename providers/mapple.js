// Imported provider: mapple; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
/**
 * mapple - Built from src/mapple/
 * Generated: 2026-09-21T12:38:36.737Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/mapple/constants.js
var BASE_URL = "https://mapple.fun";
var SUBTITLE_BASE = "https://sub.wyzie.io";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var DEFAULT_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36";
var API_HEADERS = {
  "User-Agent": DEFAULT_USER_AGENT,
  "Accept": "*/*",
  "Origin": BASE_URL,
  "Referer": `${BASE_URL}/`
};
var PLAYBACK_HEADERS = {
  "Referer": `${BASE_URL}/`,
  "Origin": BASE_URL,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
};
var HOSTERS = [
  { name: "Zeus", key: "mapple" },
  { name: "Poseidon", key: "s25" },
  { name: "Athena", key: "s2" },
  { name: "Hera", key: "s4" },
  { name: "Persephone", key: "s12" },
  { name: "Apollo", key: "s19" },
  { name: "Artemis", key: "s13" },
  { name: "Hermes", key: "s26" },
  { name: "Ares", key: "s24" },
  { name: "Aphrodite", key: "s6" },
  { name: "Hephaestus", key: "s15" },
  { name: "Demeter", key: "s7" },
  { name: "Dionysus", key: "s8" },
  { name: "Hestia", key: "s3" },
  { name: "Hades", key: "s16" },
  { name: "Nike", key: "s5" },
  { name: "Atlas", key: "s1" },
  { name: "Prometheus", key: "s10" }
];

// src/mapple/pow.js
var import_crypto_js = __toESM(require("crypto-js"));
var nodeCrypto = null;
try {
  const req = require;
  nodeCrypto = req("crypto");
} catch (e) {
}
function countLeadingZeroBitsBytes(bytes) {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) {
      count += 8;
    } else {
      for (let bit = 7; bit >= 0; bit--) {
        if ((b & 1 << bit) !== 0)
          return count;
        count++;
      }
    }
  }
  return count;
}
function countLeadingZeroBitsWords(words) {
  let count = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] >>> 0;
    const lz = Math.clz32(w);
    count += lz;
    if (lz < 32)
      break;
  }
  return count;
}
function solvePow(challenge, difficulty) {
  const maxAttempts = 5e7;
  let nonce = 0;
  if (nodeCrypto && typeof nodeCrypto.createHash === "function") {
    while (nonce < maxAttempts) {
      const hash = nodeCrypto.createHash("sha256").update(challenge + nonce).digest();
      if (countLeadingZeroBitsBytes(hash) >= difficulty) {
        return nonce.toString();
      }
      nonce++;
    }
  } else {
    while (nonce < maxAttempts) {
      const hash = import_crypto_js.default.SHA256(challenge + nonce);
      if (countLeadingZeroBitsWords(hash.words) >= difficulty) {
        return nonce.toString();
      }
      nonce++;
    }
  }
  throw new Error(`PoW solve exceeded max attempts (difficulty=${difficulty})`);
}

// src/mapple/utils.js
var CookieJar = class {
  constructor() {
    this.cookies = /* @__PURE__ */ new Map();
  }
  update(res) {
    if (!res || !res.headers)
      return;
    let rawCookies = [];
    if (typeof res.headers.getSetCookie === "function") {
      rawCookies = res.headers.getSetCookie();
    } else if (res.headers.get) {
      const h = res.headers.get("set-cookie");
      if (h)
        rawCookies = [h];
    }
    for (const c of rawCookies) {
      const parts = c.split(";");
      const [k, v] = parts[0].split("=");
      if (k && v) {
        this.cookies.set(k.trim(), v.trim());
      }
    }
  }
  getCookieString() {
    const list = [];
    for (const [k, v] of this.cookies.entries()) {
      list.push(`${k}=${v}`);
    }
    return list.join("; ");
  }
};
function fetchMediaDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const endpoint = mediaType === "tv" ? "tv" : "movie";
      const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "Accept": "application/json"
        }
      });
      if (!res.ok)
        throw new Error(`TMDB HTTP ${res.status}`);
      const data = yield res.json();
      return {
        title: mediaType === "tv" ? data.name : data.title,
        year: (mediaType === "tv" ? data.first_air_date : data.release_date || "").substring(0, 4),
        imdbId: ((_a = data.external_ids) == null ? void 0 : _a.imdb_id) || null,
        mediaType
      };
    } catch (e) {
      return {
        title: `TMDB ${tmdbId}`,
        year: "",
        imdbId: null,
        mediaType
      };
    }
  });
}
function fetchSubtitles(tmdbId, mediaType, seasonNum = null, episodeNum = null) {
  return __async(this, null, function* () {
    try {
      const isMovie = mediaType !== "tv";
      const url = isMovie ? `${SUBTITLE_BASE}/search?id=${tmdbId}` : `${SUBTITLE_BASE}/search?id=${tmdbId}&season=${seasonNum}&episode=${episodeNum}`;
      const res = yield fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok)
        return [];
      const data = yield res.json();
      if (!Array.isArray(data))
        return [];
      return data.map((sub) => ({
        url: sub.url,
        language: sub.language || "Unknown",
        name: sub.isHearingImpaired ? `${sub.language} (CC)` : sub.language || "Subtitle"
      }));
    } catch (e) {
      return [];
    }
  });
}
function parseHlsMaster(masterUrl, hosterName, mediaTitle, playbackHeaders) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(masterUrl, { headers: playbackHeaders });
      if (!res.ok)
        return null;
      const text = yield res.text();
      if (!text.includes("#EXT-X-STREAM-INF"))
        return null;
      const lines = text.split("\n");
      const streams = [];
      let currentQuality = "Unknown";
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF")) {
          const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
          if (resMatch) {
            currentQuality = resMatch[1] + "p";
          }
        } else if (line && !line.startsWith("#")) {
          const streamUrl = line.startsWith("http") ? line : new URL(line, masterUrl).href;
          streams.push({
            name: `Mapple [${hosterName}] - ${currentQuality}`,
            title: mediaTitle,
            url: streamUrl,
            quality: currentQuality,
            size: "Unknown",
            headers: playbackHeaders,
            provider: "mapple"
          });
          currentQuality = "Unknown";
        }
      }
      return streams.length > 0 ? streams : null;
    } catch (e) {
      return null;
    }
  });
}

// src/mapple/index.js
function getPlaybackSession(tmdbId, mediaType, tvSlug, mediaReferer, cookieJar) {
  return __async(this, null, function* () {
    const initRes = yield fetch(`${BASE_URL}/`, {
      headers: {
        "User-Agent": API_HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    cookieJar.update(initRes);
    const tokenRes = yield fetch(`${BASE_URL}/api/request-token`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, API_HEADERS), {
        "Referer": mediaReferer,
        "Content-Type": "application/json",
        "Cookie": cookieJar.getCookieString()
      }),
      body: ""
    });
    cookieJar.update(tokenRes);
    if (!tokenRes.ok)
      return null;
    const tokenData = yield tokenRes.json();
    const requestToken = tokenData == null ? void 0 : tokenData.token;
    if (!requestToken)
      return null;
    const initPayload = {
      mediaId: Number(tmdbId),
      mediaType,
      tv_slug: tvSlug,
      requestToken
    };
    const playbackRes = yield fetch(`${BASE_URL}/api/playback-init`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, API_HEADERS), {
        "Referer": mediaReferer,
        "Content-Type": "application/json",
        "Cookie": cookieJar.getCookieString()
      }),
      body: JSON.stringify(initPayload)
    });
    cookieJar.update(playbackRes);
    if (!playbackRes.ok)
      return null;
    const initData = yield playbackRes.json();
    let playbackToken = null;
    if (initData.success && initData.token) {
      playbackToken = initData.token;
    } else if (initData.requiresPow && initData.pow) {
      const nonce = solvePow(initData.pow.challenge, initData.pow.difficulty);
      const powRes = yield fetch(`${BASE_URL}/api/playback-init`, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, API_HEADERS), {
          "Referer": mediaReferer,
          "Content-Type": "application/json",
          "Cookie": cookieJar.getCookieString()
        }),
        body: JSON.stringify(__spreadProps(__spreadValues({}, initPayload), {
          pow: {
            challengeId: initData.pow.challengeId,
            nonce
          }
        }))
      });
      cookieJar.update(powRes);
      if (powRes.ok) {
        const powData = yield powRes.json();
        playbackToken = powData == null ? void 0 : powData.token;
      }
    }
    if (!playbackToken)
      return null;
    return { requestToken, playbackToken };
  });
}
function extractHosterStream(hoster, tmdbId, mediaType, tvSlug, mediaReferer, session, cookieJar, mediaTitle, subtitles) {
  return __async(this, null, function* () {
    var _a;
    try {
      const encRes = yield fetch(`${BASE_URL}/api/encrypt`, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, API_HEADERS), {
          "Referer": mediaReferer,
          "Content-Type": "application/json",
          "Cookie": cookieJar.getCookieString()
        }),
        body: JSON.stringify({
          data: {
            mediaId: Number(tmdbId),
            mediaType,
            tv_slug: tvSlug,
            source: hoster.key
          },
          endpoint: "stream-encrypted",
          requestToken: session.requestToken
        })
      });
      if (!encRes.ok)
        return [];
      const encData = yield encRes.json();
      if (!(encData == null ? void 0 : encData.url))
        return [];
      const streamEndpoint = `${BASE_URL}${encData.url}&requestToken=${encodeURIComponent(session.requestToken)}&token=${encodeURIComponent(session.playbackToken)}`;
      const streamRes = yield fetch(streamEndpoint, {
        headers: __spreadProps(__spreadValues({}, API_HEADERS), {
          "Referer": mediaReferer,
          "Cookie": cookieJar.getCookieString()
        })
      });
      if (!streamRes.ok)
        return [];
      const streamData = yield streamRes.json();
      const streamUrl = (_a = streamData == null ? void 0 : streamData.data) == null ? void 0 : _a.stream_url;
      if (!(streamData == null ? void 0 : streamData.success) || !streamUrl || streamUrl.includes("playback-unavailable")) {
        return [];
      }
      const streams = [];
      const parsedStreams = yield parseHlsMaster(streamUrl, hoster.name, mediaTitle, PLAYBACK_HEADERS);
      if (parsedStreams && parsedStreams.length > 0) {
        parsedStreams.forEach((s) => {
          s.subtitles = subtitles;
          streams.push(s);
        });
      }
      streams.push({
        name: `Mapple [${hoster.name}] - Auto`,
        title: mediaTitle,
        url: streamUrl,
        quality: "Auto",
        size: "Unknown",
        headers: PLAYBACK_HEADERS,
        provider: "mapple",
        subtitles
      });
      return streams;
    } catch (e) {
      return [];
    }
  });
}
function getStreams(tmdbId, mediaType, seasonNum = null, episodeNum = null) {
  return __async(this, null, function* () {
    const type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
    const s = seasonNum ? Number(seasonNum) : 1;
    const e = episodeNum ? Number(episodeNum) : 1;
    const tvSlug = type === "tv" ? `${s}-${e}` : "";
    const mediaReferer = type === "tv" ? `${BASE_URL}/tv/${tmdbId}/${s}/${e}` : `${BASE_URL}/movie/${tmdbId}`;
    const [mediaDetails, subtitles] = yield Promise.all([
      fetchMediaDetails(tmdbId, type),
      fetchSubtitles(tmdbId, type, s, e)
    ]);
    let mediaTitle = mediaDetails.title || `TMDB ${tmdbId}`;
    if (mediaDetails.year) {
      mediaTitle += ` (${mediaDetails.year})`;
    }
    if (type === "tv") {
      mediaTitle += ` S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;
    }
    const cookieJar = new CookieJar();
    const session = yield getPlaybackSession(tmdbId, type, tvSlug, mediaReferer, cookieJar);
    if (!session)
      return [];
    const hosterPromises = HOSTERS.map(
      (hoster) => extractHosterStream(hoster, tmdbId, type, tvSlug, mediaReferer, session, cookieJar, mediaTitle, subtitles)
    );
    const hosterResults = yield Promise.all(hosterPromises);
    const allStreams = hosterResults.flat();
    const seen = /* @__PURE__ */ new Set();
    const uniqueStreams = [];
    allStreams.forEach((stream) => {
      if (!seen.has(stream.url)) {
        seen.add(stream.url);
        uniqueStreams.push(stream);
      }
    });
    const qualityRank = {
      "auto": 4e3,
      "adaptive": 4e3,
      "2160p": 2160,
      "4k": 2160,
      "1080p": 1080,
      "720p": 720,
      "480p": 480,
      "360p": 360,
      "240p": 240,
      "unknown": 0
    };
    uniqueStreams.sort((a, b) => {
      var _a, _b;
      const qa = qualityRank[(_a = a.quality) == null ? void 0 : _a.toLowerCase()] || 0;
      const qb = qualityRank[(_b = b.quality) == null ? void 0 : _b.toLowerCase()] || 0;
      return qb - qa;
    });
    return uniqueStreams;
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "mapple", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "Mapple", "mapple");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
