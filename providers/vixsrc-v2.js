// Imported provider: vixsrc-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
 * vixsrc - Built from src/vixsrc/
 * Generated: 2025-12-31T21:23:16.687Z
 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
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

// src/vixsrc/constants.js
var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
var BASE_URL = "https://vixsrc.to";
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// src/vixsrc/http.js
function makeRequest(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const defaultHeaders = __spreadValues({
      "User-Agent": USER_AGENT,
      "Accept": "application/json,*/*",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate",
      "Connection": "keep-alive"
    }, options.headers);
    try {
      const response = yield fetch(url, __spreadValues({
        method: options.method || "GET",
        headers: defaultHeaders
      }, options));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      console.error(`[Vixsrc] Request failed for ${url}: ${error.message}`);
      throw error;
    }
  });
}

// src/vixsrc/tmdb.js
function getTmdbInfo(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a, _b;
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = yield makeRequest(url);
    const data = yield response.json();
    const title = mediaType === "tv" ? data.name : data.title;
    const year = mediaType === "tv" ? (_a = data.first_air_date) == null ? void 0 : _a.substring(0, 4) : (_b = data.release_date) == null ? void 0 : _b.substring(0, 4);
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    console.log(`[Vixsrc] TMDB Info: "${title}" (${year})`);
    return { title, year, data };
  });
}

// src/vixsrc/extractor.js
function extractStreamFromPage(contentType, contentId, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    let vixsrcUrl;
    let subtitleApiUrl;
    if (contentType === "movie") {
      vixsrcUrl = `${BASE_URL}/movie/${contentId}`;
      subtitleApiUrl = `https://sub.wyzie.ru/search?id=${contentId}`;
    } else {
      vixsrcUrl = `${BASE_URL}/tv/${contentId}/${seasonNum}/${episodeNum}`;
      subtitleApiUrl = `https://sub.wyzie.ru/search?id=${contentId}&season=${seasonNum}&episode=${episodeNum}`;
    }
    console.log(`[Vixsrc] Fetching: ${vixsrcUrl}`);
    const response = yield makeRequest(vixsrcUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const html = yield response.text();
    console.log(`[Vixsrc] HTML length: ${html.length} characters`);
    let masterPlaylistUrl = null;
    if (html.includes("window.masterPlaylist")) {
      console.log("[Vixsrc] Found window.masterPlaylist");
      const urlMatch = html.match(/url:\s*['"]([^'"]+)['"]/);
      const tokenMatch = html.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expiresMatch = html.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);
      if (urlMatch && tokenMatch && expiresMatch) {
        const baseUrl = urlMatch[1];
        const token = tokenMatch[1];
        const expires = expiresMatch[1];
        console.log("[Vixsrc] Extracted tokens:");
        console.log(`  - Base URL: ${baseUrl}`);
        console.log(`  - Token: ${token.substring(0, 20)}...`);
        console.log(`  - Expires: ${expires}`);
        if (baseUrl.includes("?b=1")) {
          masterPlaylistUrl = `${baseUrl}&token=${token}&expires=${expires}&h=1&lang=en`;
        } else {
          masterPlaylistUrl = `${baseUrl}?token=${token}&expires=${expires}&h=1&lang=en`;
        }
        console.log(`[Vixsrc] Constructed master playlist URL: ${masterPlaylistUrl}`);
      }
    }
    if (!masterPlaylistUrl) {
      const m3u8Match = html.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/);
      if (m3u8Match) {
        masterPlaylistUrl = m3u8Match[1];
        console.log("[Vixsrc] Found direct .m3u8 URL:", masterPlaylistUrl);
      }
    }
    if (!masterPlaylistUrl) {
      const scriptMatches = html.match(new RegExp("<script[^>]*>(.*?)<\\/script>", "gs"));
      if (scriptMatches) {
        for (const script of scriptMatches) {
          const streamMatch = script.match(/['"]?(https?:\/\/[^'"\s]+(?:\.m3u8|playlist)[^'"\s]*)/);
          if (streamMatch) {
            masterPlaylistUrl = streamMatch[1];
            console.log("[Vixsrc] Found stream in script:", masterPlaylistUrl);
            break;
          }
        }
      }
    }
    if (!masterPlaylistUrl) {
      console.log("[Vixsrc] No master playlist URL found");
      return null;
    }
    return { masterPlaylistUrl, subtitleApiUrl };
  });
}

// src/vixsrc/subtitles.js
function getSubtitles(subtitleApiUrl) {
  return __async(this, null, function* () {
    try {
      const response = yield makeRequest(subtitleApiUrl);
      const subtitleData = yield response.json();
      let subtitleTrack = subtitleData.find(
        (track) => track.display.includes("English") && (track.encoding === "ASCII" || track.encoding === "UTF-8")
      );
      if (!subtitleTrack) {
        subtitleTrack = subtitleData.find(
          (track) => track.display.includes("English") && track.encoding === "CP1252"
        );
      }
      if (!subtitleTrack) {
        subtitleTrack = subtitleData.find(
          (track) => track.display.includes("English") && track.encoding === "CP1250"
        );
      }
      if (!subtitleTrack) {
        subtitleTrack = subtitleData.find(
          (track) => track.display.includes("English") && track.encoding === "CP850"
        );
      }
      const subtitles = subtitleTrack ? subtitleTrack.url : "";
      console.log(
        subtitles ? `[Vixsrc] Found subtitles: ${subtitles}` : "[Vixsrc] No English subtitles found"
      );
      return subtitles;
    } catch (error) {
      console.log("[Vixsrc] Subtitle fetch failed:", error.message);
      return "";
    }
  });
}

// src/vixsrc/index.js
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  return __async(this, null, function* () {
    console.log(`[Vixsrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    try {
      const tmdbInfo = yield getTmdbInfo(tmdbId, mediaType);
      const { title, year } = tmdbInfo;
      console.log(`[Vixsrc] Title: "${title}" (${year})`);
      const streamData = yield extractStreamFromPage(mediaType, tmdbId, seasonNum, episodeNum);
      if (!streamData) {
        console.log("[Vixsrc] No stream data found");
        return [];
      }
      const { masterPlaylistUrl, subtitleApiUrl } = streamData;
      const subtitles = yield getSubtitles(subtitleApiUrl);
      const nuvioStreams = [{
        name: "Vixsrc",
        title: "Auto Quality Stream",
        url: masterPlaylistUrl,
        quality: "Auto",
        type: "direct",
        headers: {
          "Referer": BASE_URL,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
      }];
      console.log("[Vixsrc] Successfully processed 1 stream with Auto quality");
      return nuvioStreams;
    } catch (error) {
      console.error(`[Vixsrc] Error in getStreams: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vixsrc-v2", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
