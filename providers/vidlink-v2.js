// Imported provider: vidlink-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
 * vidlink - Built from src/vidlink/
 * Generated: 2025-12-31T21:23:16.719Z
 */
"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
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
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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

// src/vidlink/constants.js
var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
var ENC_DEC_API = "https://enc-dec.app/api";
var VIDLINK_API = "https://vidlink.pro/api/b";
var VIDLINK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Connection": "keep-alive",
  "Referer": "https://vidlink.pro/",
  "Origin": "https://vidlink.pro"
};

// src/vidlink/http.js
function makeRequest(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const defaultHeaders = __spreadValues({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
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
      console.error(`[Vidlink] Request failed for ${url}: ${error.message}`);
      throw error;
    }
  });
}

// src/vidlink/tmdb.js
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
    console.log(`[Vidlink] TMDB Info: "${title}" (${year})`);
    return { title, year, data };
  });
}
function encryptTmdbId(tmdbId) {
  return __async(this, null, function* () {
    console.log(`[Vidlink] Encrypting TMDB ID: ${tmdbId}`);
    const response = yield makeRequest(`${ENC_DEC_API}/enc-vidlink?text=${tmdbId}`);
    const data = yield response.json();
    if (data && data.result) {
      console.log(`[Vidlink] Successfully encrypted TMDB ID`);
      return data.result;
    } else {
      throw new Error("Invalid encryption response format");
    }
  });
}

// src/vidlink/m3u8.js
function resolveUrl(url, baseUrl) {
  if (url.startsWith("http")) {
    return url;
  }
  try {
    return new URL(url, baseUrl).toString();
  } catch (error) {
    console.error(`[Vidlink] Could not resolve URL: ${url} against ${baseUrl}`);
    return url;
  }
}
function getQualityFromResolution(resolution) {
  if (!resolution)
    return "Auto";
  const [, height] = resolution.split("x").map(Number);
  if (height >= 2160)
    return "4K";
  if (height >= 1440)
    return "1440p";
  if (height >= 1080)
    return "1080p";
  if (height >= 720)
    return "720p";
  if (height >= 480)
    return "480p";
  if (height >= 360)
    return "360p";
  return "240p";
}
function parseM3U8(content, baseUrl) {
  const lines = content.split("\n").map((line) => line.trim()).filter((line) => line);
  const streams = [];
  let currentStream = null;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      currentStream = { bandwidth: null, resolution: null, url: null };
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      if (bandwidthMatch) {
        currentStream.bandwidth = parseInt(bandwidthMatch[1]);
      }
      const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
      if (resolutionMatch) {
        currentStream.resolution = resolutionMatch[1];
      }
    } else if (currentStream && !line.startsWith("#")) {
      currentStream.url = resolveUrl(line, baseUrl);
      streams.push(currentStream);
      currentStream = null;
    }
  }
  return streams;
}
function fetchAndParseM3U8(playlistUrl, mediaInfo, subtitles) {
  return __async(this, null, function* () {
    console.log(`[Vidlink] Fetching M3U8 playlist: ${playlistUrl.substring(0, 80)}...`);
    try {
      const response = yield makeRequest(playlistUrl, { headers: VIDLINK_HEADERS });
      const m3u8Content = yield response.text();
      console.log(`[Vidlink] Parsing M3U8 content`);
      const parsedStreams = parseM3U8(m3u8Content, playlistUrl);
      if (parsedStreams.length === 0) {
        console.log("[Vidlink] No quality variants found, returning master playlist");
        return [{
          name: "Vidlink - Auto",
          title: mediaInfo.title,
          url: playlistUrl,
          quality: "Auto",
          size: "Unknown",
          headers: VIDLINK_HEADERS,
          provider: "vidlink",
          subtitles: subtitles || []
        }];
      }
      console.log(`[Vidlink] Found ${parsedStreams.length} quality variants`);
      return parsedStreams.map((stream) => {
        const quality = getQualityFromResolution(stream.resolution);
        return {
          name: `Vidlink - ${quality}`,
          title: mediaInfo.title,
          url: stream.url,
          quality,
          size: "Unknown",
          headers: VIDLINK_HEADERS,
          provider: "vidlink",
          subtitles: subtitles || []
        };
      });
    } catch (error) {
      console.error(`[Vidlink] Error fetching/parsing M3U8: ${error.message}`);
      return [{
        name: "Vidlink - Auto",
        title: mediaInfo.title,
        url: playlistUrl,
        quality: "Auto",
        size: "Unknown",
        headers: VIDLINK_HEADERS,
        provider: "vidlink",
        subtitles: subtitles || []
      }];
    }
  });
}

// src/vidlink/processor.js
function extractQuality(streamData) {
  if (!streamData)
    return "Unknown";
  const qualityFields = ["quality", "resolution", "label", "name"];
  for (const field of qualityFields) {
    if (streamData[field]) {
      const quality = streamData[field].toString().toLowerCase();
      if (quality.includes("2160") || quality.includes("4k"))
        return "4K";
      if (quality.includes("1440") || quality.includes("2k"))
        return "1440p";
      if (quality.includes("1080") || quality.includes("fhd"))
        return "1080p";
      if (quality.includes("720") || quality.includes("hd"))
        return "720p";
      if (quality.includes("480") || quality.includes("sd"))
        return "480p";
      if (quality.includes("360"))
        return "360p";
      if (quality.includes("240"))
        return "240p";
      const match = quality.match(/(\d{3,4})[pP]?/);
      if (match) {
        const resolution = parseInt(match[1]);
        if (resolution >= 2160)
          return "4K";
        if (resolution >= 1440)
          return "1440p";
        if (resolution >= 1080)
          return "1080p";
        if (resolution >= 720)
          return "720p";
        if (resolution >= 480)
          return "480p";
        if (resolution >= 360)
          return "360p";
        return "240p";
      }
    }
  }
  return "Unknown";
}
function createStreamTitle(mediaInfo) {
  if (mediaInfo.mediaType === "tv" && mediaInfo.season && mediaInfo.episode) {
    return `${mediaInfo.title} S${String(mediaInfo.season).padStart(2, "0")}E${String(mediaInfo.episode).padStart(2, "0")}`;
  }
  return mediaInfo.year ? `${mediaInfo.title} (${mediaInfo.year})` : mediaInfo.title;
}
function processVidlinkResponse(data, mediaInfo) {
  const streams = [];
  try {
    console.log(`[Vidlink] Processing response data`);
    const streamTitle = createStreamTitle(mediaInfo);
    const subtitles = [];
    const rawSubtitles = data.subtitles || data.stream && data.stream.subtitles || data.captions || data.stream && data.stream.captions || [];
    if (Array.isArray(rawSubtitles)) {
      rawSubtitles.forEach((sub) => {
        if (sub.url) {
          subtitles.push({
            url: sub.url,
            language: sub.language || sub.lang || sub.label || "Unknown",
            name: sub.name || sub.label || sub.language || sub.lang || "Unknown",
            headers: VIDLINK_HEADERS
          });
        }
      });
    }
    if (data.stream && data.stream.qualities) {
      console.log(`[Vidlink] Processing qualities from stream object`);
      Object.entries(data.stream.qualities).forEach(([qualityKey, qualityData]) => {
        if (qualityData.url) {
          const quality = extractQuality({ quality: qualityKey });
          streams.push({
            name: `Vidlink - ${quality}`,
            title: streamTitle,
            url: qualityData.url,
            quality,
            size: "Unknown",
            headers: VIDLINK_HEADERS,
            provider: "vidlink",
            subtitles
          });
        }
      });
      if (data.stream.playlist) {
        streams.push({
          _isPlaylist: true,
          url: data.stream.playlist,
          mediaInfo: __spreadProps(__spreadValues({}, mediaInfo), { title: streamTitle }),
          subtitles
        });
      }
    } else if (data.stream && data.stream.playlist && !data.stream.qualities) {
      console.log(`[Vidlink] Processing playlist-only response`);
      streams.push({
        _isPlaylist: true,
        url: data.stream.playlist,
        mediaInfo: __spreadProps(__spreadValues({}, mediaInfo), { title: streamTitle }),
        subtitles
      });
    } else if (data.url) {
      const quality = extractQuality(data);
      streams.push({
        name: `Vidlink - ${quality}`,
        title: streamTitle,
        url: data.url,
        quality,
        size: "Unknown",
        headers: VIDLINK_HEADERS,
        provider: "vidlink",
        subtitles
      });
    } else if (data.streams && Array.isArray(data.streams)) {
      data.streams.forEach((stream, index) => {
        if (stream.url) {
          const quality = extractQuality(stream);
          streams.push({
            name: `Vidlink Stream ${index + 1} - ${quality}`,
            title: streamTitle,
            url: stream.url,
            quality,
            size: stream.size || "Unknown",
            headers: VIDLINK_HEADERS,
            provider: "vidlink",
            subtitles
          });
        }
      });
    } else if (data.links && Array.isArray(data.links)) {
      data.links.forEach((link, index) => {
        if (link.url) {
          const quality = extractQuality(link);
          streams.push({
            name: `Vidlink Link ${index + 1} - ${quality}`,
            title: streamTitle,
            url: link.url,
            quality,
            size: link.size || "Unknown",
            headers: VIDLINK_HEADERS,
            provider: "vidlink",
            subtitles
          });
        }
      });
    } else if (typeof data === "object") {
      const findUrls = (obj) => {
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === "string" && (value.startsWith("http") || value.includes(".m3u8"))) {
            if (value.includes(".srt") || value.includes(".vtt") || value.includes("subtitle") || value.includes("captions") || key.toLowerCase().includes("subtitle") || key.toLowerCase().includes("caption")) {
              continue;
            }
            const quality = extractQuality({ [key]: value });
            streams.push({
              name: `Vidlink ${key} - ${quality}`,
              title: streamTitle,
              url: value,
              quality,
              size: "Unknown",
              headers: VIDLINK_HEADERS,
              provider: "vidlink",
              subtitles
            });
          } else if (typeof value === "object" && value !== null) {
            if (!key.toLowerCase().includes("caption") && !key.toLowerCase().includes("subtitle")) {
              findUrls(value);
            }
          }
        }
      };
      findUrls(data);
    }
    console.log(`[Vidlink] Extracted ${streams.length} streams from response`);
  } catch (error) {
    console.error(`[Vidlink] Error processing response: ${error.message}`);
  }
  return streams;
}

// src/vidlink/index.js
var QUALITY_ORDER = {
  "4K": 5,
  "1440p": 4,
  "1080p": 3,
  "720p": 2,
  "480p": 1,
  "360p": 0,
  "240p": -1,
  "Auto": -2,
  "Unknown": -3
};
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  return __async(this, null, function* () {
    console.log(`[Vidlink] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === "tv" ? `, S:${seasonNum}E:${episodeNum}` : ""}`);
    try {
      const { title, year } = yield getTmdbInfo(tmdbId, mediaType);
      const encryptedId = yield encryptTmdbId(tmdbId);
      let vidlinkUrl;
      if (mediaType === "tv" && seasonNum && episodeNum) {
        vidlinkUrl = `${VIDLINK_API}/tv/${encryptedId}/${seasonNum}/${episodeNum}`;
      } else {
        vidlinkUrl = `${VIDLINK_API}/movie/${encryptedId}`;
      }
      console.log(`[Vidlink] Requesting: ${vidlinkUrl}`);
      const response = yield makeRequest(vidlinkUrl, { headers: VIDLINK_HEADERS });
      const data = yield response.json();
      console.log(`[Vidlink] Received response from Vidlink API`);
      const mediaInfo = {
        title,
        year,
        mediaType,
        season: seasonNum,
        episode: episodeNum
      };
      const streams = processVidlinkResponse(data, mediaInfo);
      if (streams.length === 0) {
        console.log("[Vidlink] No streams found in response");
        return [];
      }
      const playlistStreams = streams.filter((s) => s._isPlaylist);
      const directStreams = streams.filter((s) => !s._isPlaylist);
      if (playlistStreams.length > 0) {
        console.log(`[Vidlink] Processing ${playlistStreams.length} M3U8 playlists`);
        const playlistPromises = playlistStreams.map(
          (ps) => fetchAndParseM3U8(ps.url, ps.mediaInfo, ps.subtitles)
        );
        const parsedStreamArrays = yield Promise.all(playlistPromises);
        const allStreams = directStreams.concat(...parsedStreamArrays);
        allStreams.sort((a, b) => (QUALITY_ORDER[b.quality] || -3) - (QUALITY_ORDER[a.quality] || -3));
        console.log(`[Vidlink] Successfully processed ${allStreams.length} total streams`);
        return allStreams;
      } else {
        directStreams.sort((a, b) => (QUALITY_ORDER[b.quality] || -3) - (QUALITY_ORDER[a.quality] || -3));
        console.log(`[Vidlink] Successfully processed ${directStreams.length} streams`);
        return directStreams;
      }
    } catch (error) {
      console.error(`[Vidlink] Error in getStreams: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidlink-v2", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "Vidlink V2", "vidlink-v2");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
