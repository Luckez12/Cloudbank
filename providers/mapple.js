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
