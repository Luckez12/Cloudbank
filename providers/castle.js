// Imported provider: castle; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
 * castle - Built from src/castle/
 * Generated: 2025-12-31T21:23:16.715Z
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

// src/castle/constants.js
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var CASTLE_BASE = "https://api.hlowb.com";
var PKG = "com.external.castle";
var CHANNEL = "IndiaA";
var CLIENT = "1";
var LANG = "en-US";
var API_HEADERS = {
  "User-Agent": "okhttp/4.9.3",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "Keep-Alive",
  "Referer": CASTLE_BASE
};
var PLAYBACK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
  "DNT": "1"
};

// src/castle/http.js
function makeRequest(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    try {
      const response = yield fetch(url, {
        method: options.method || "GET",
        headers: __spreadValues(__spreadValues({}, API_HEADERS), options.headers),
        body: options.body
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      console.error(`[Castle] Request failed for ${url}: ${error.message}`);
      throw error;
    }
  });
}
function extractCipherFromResponse(response) {
  return __async(this, null, function* () {
    const text = yield response.text();
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Empty response");
    }
    try {
      const json = JSON.parse(trimmed);
      if (json && json.data && typeof json.data === "string") {
        return json.data.trim();
      }
    } catch (e) {
    }
    return trimmed;
  });
}
function extractDataBlock(obj) {
  if (obj && obj.data && typeof obj.data === "object") {
    return obj.data;
  }
  return obj || {};
}

// src/castle/tmdb.js
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    const response = yield makeRequest(url);
    const data = yield response.json();
    const title = mediaType === "tv" ? data.name : data.title;
    const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
    return {
      title,
      year,
      tmdbId
    };
  });
}

// src/castle/decrypt.js
function decryptCastle(encryptedB64, securityKeyB64) {
  return __async(this, null, function* () {
    console.log("[Castle] Starting local AES-CBC decryption...");
    try {
      const CryptoJS = require("crypto-js");
      
      let decryptAES = CryptoJS.AES.decrypt.bind(CryptoJS.AES);
      // Local JNI adapter; do not mutate the shared crypto-js module.
      if (typeof __crypto_aes_decrypt_raw !== 'undefined') {
        const originalDecrypt = decryptAES;
        decryptAES = function(cipher, key, options) {
          try {
            const wordArrayToBytes = (wordArray) => {
              const bytes = new Uint8Array(wordArray.sigBytes);
              for (let i = 0; i < wordArray.sigBytes; i++) {
                bytes[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
              }
              return bytes;
            };
            const toUint8Array = (data) => {
              if (data instanceof Uint8Array) return data;
              if (data instanceof ArrayBuffer) return new Uint8Array(data);
              if (data && typeof data.length === 'number') return new Uint8Array(Array.prototype.slice.call(data));
              return new Uint8Array(0);
            };
            const data = typeof cipher === 'string'
              ? new Uint8Array(Array.from(atob(cipher), c => c.charCodeAt(0)))
              : (cipher.ciphertext ? wordArrayToBytes(cipher.ciphertext) : toUint8Array(cipher));
            const kBytes = wordArrayToBytes(key);
            const ivBytes = (options && options.iv) ? wordArrayToBytes(options.iv) : new Uint8Array(0);
            const mode = (options && options.mode) || 'AES-CBC';
            
            // Map Uint8Array (unsigned) to Int8Array (signed) to match Kotlin ByteArray
            const keyArg = typeof Int8Array !== 'undefined' ? new Int8Array(kBytes.buffer) : kBytes;
            const ivArg = typeof Int8Array !== 'undefined' ? new Int8Array(ivBytes.buffer) : ivBytes;
            const dataArg = typeof Int8Array !== 'undefined' ? new Int8Array(data.buffer) : data;
            
            const resBytes = __crypto_aes_decrypt_raw(mode, keyArg, ivArg, dataArg);
            const plain = new TextDecoder().decode(resBytes);
            return { toString: function() { return plain; } };
          } catch (err) {
            console.error("[Castle JNI Patch] Decrypt failed, falling back:", err);
            return originalDecrypt.call(CryptoJS.AES, cipher, key, options);
          }
        };
      }

      const CASTLE_SUFFIX = "T!BgJB";
      
      const securityKeyWords = CryptoJS.enc.Base64.parse(securityKeyB64);
      const suffixWords = CryptoJS.enc.Utf8.parse(CASTLE_SUFFIX);
      const keyMaterial = securityKeyWords.concat(suffixWords);
      
      let finalKey;
      if (keyMaterial.sigBytes < 16) {
        const padding = CryptoJS.lib.WordArray.create([0, 0, 0, 0], 16 - keyMaterial.sigBytes);
        finalKey = keyMaterial.concat(padding);
      } else if (keyMaterial.sigBytes > 16) {
        finalKey = CryptoJS.lib.WordArray.create(keyMaterial.words.slice(0, 4), 16);
      } else {
        finalKey = keyMaterial;
      }
      
      const iv = finalKey;
      
      const decrypted = decryptAES(encryptedB64, finalKey, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      
      const result = decrypted.toString(CryptoJS.enc.Utf8);
      if (!result) {
        throw new Error("Decryption resulted in empty string (possible key/IV mismatch)");
      }
      
      console.log("[Castle] Local decryption successful");
      return result;
    } catch (error) {
      console.error(`[Castle] Local decryption failed: ${error.message}`);
      throw error;
    }
  });
}

// src/castle/api.js
function getSecurityKey() {
  return __async(this, null, function* () {
    console.log("[Castle] Fetching security key...");
    const url = `${CASTLE_BASE}/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}`;
    const response = yield makeRequest(url);
    const data = yield response.json();
    if (data.code !== 200 || !data.data) {
      throw new Error(`Security key API error: ${JSON.stringify(data)}`);
    }
    console.log("[Castle] Security key obtained");
    return data.data;
  });
}
function searchCastle(securityKey, keyword, page = 1, size = 30) {
  return __async(this, null, function* () {
    console.log(`[Castle] Searching for: ${keyword}`);
    const params = new URLSearchParams({
      channel: CHANNEL,
      clientType: CLIENT,
      keyword,
      lang: LANG,
      mode: "1",
      packageName: PKG,
      page: page.toString(),
      size: size.toString()
    });
    const url = `${CASTLE_BASE}/film-api/v1.1.0/movie/searchByKeyword?${params.toString()}`;
    const response = yield makeRequest(url);
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return JSON.parse(decrypted);
  });
}
function getDetails(securityKey, movieId) {
  return __async(this, null, function* () {
    console.log(`[Castle] Fetching details for movieId: ${movieId}`);
    const url = `${CASTLE_BASE}/film-api/v1.9.9/movie?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}&movieId=${movieId}&packageName=${PKG}`;
    const response = yield makeRequest(url);
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return JSON.parse(decrypted);
  });
}
function getVideoV1(securityKey, movieId, episodeId, languageId, resolution = 2) {
  return __async(this, null, function* () {
    console.log(`[Castle] Fetching video (v1) for movieId: ${movieId}, languageId: ${languageId}`);
    const url = `${CASTLE_BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`;
    const body = {
      mode: "1",
      appMarket: "GuanWang",
      clientType: CLIENT,
      woolUser: "false",
      apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475",
      androidVersion: "13",
      movieId: movieId.toString(),
      episodeId: episodeId.toString(),
      languageId: languageId.toString(),
      isNewUser: "true",
      resolution: resolution.toString(),
      packageName: PKG
    };
    const response = yield makeRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return JSON.parse(decrypted);
  });
}
function getVideo2(securityKey, movieId, episodeId, resolution = 2) {
  return __async(this, null, function* () {
    console.log(`[Castle] Fetching video (v2) for movieId: ${movieId}, episodeId: ${episodeId}`);
    const url = `${CASTLE_BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`;
    const body = {
      mode: "1",
      appMarket: "GuanWang",
      clientType: CLIENT,
      woolUser: "false",
      apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475",
      androidVersion: "13",
      movieId: movieId.toString(),
      episodeId: episodeId.toString(),
      isNewUser: "true",
      resolution: resolution.toString(),
      packageName: PKG
    };
    const response = yield makeRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return JSON.parse(decrypted);
  });
}
function findCastleMovieId(securityKey, tmdbInfo) {
  return __async(this, null, function* () {
    const searchTerm = tmdbInfo.year ? `${tmdbInfo.title} ${tmdbInfo.year}` : tmdbInfo.title;
    const searchResult = yield searchCastle(securityKey, searchTerm);
    const data = extractDataBlock(searchResult);
    const rows = data.rows || [];
    if (rows.length === 0) {
      throw new Error("No search results found");
    }
    for (const item of rows) {
      const itemTitle = (item.title || item.name || "").toLowerCase();
      const searchTitle = tmdbInfo.title.toLowerCase();
      if (itemTitle.includes(searchTitle) || searchTitle.includes(itemTitle)) {
        const movieId2 = item.id || item.redirectId || item.redirectIdStr;
        if (movieId2) {
          console.log(`[Castle] Found match: ${item.title || item.name} (id: ${movieId2})`);
          return movieId2.toString();
        }
      }
    }
    const firstItem = rows[0];
    const movieId = firstItem.id || firstItem.redirectId || firstItem.redirectIdStr;
    if (movieId) {
      console.log(`[Castle] Using first result: ${firstItem.title || firstItem.name} (id: ${movieId})`);
      return movieId.toString();
    }
    throw new Error("Could not extract movie ID from search results");
  });
}

// src/castle/utils.js
function getQualityValue(quality) {
  if (!quality)
    return 0;
  if (/^(4k|uhd)$/i.test(String(quality).trim())) return 2160;
  const cleanQuality = quality.toString().toLowerCase().replace(/^(sd|hd|fhd|uhd|4k)\s*/i, "").replace(/p$/, "").trim();
  const qualityMap = {
    "4k": 2160,
    "2160": 2160,
    "1440": 1440,
    "1080": 1080,
    "720": 720,
    "480": 480,
    "360": 360,
    "240": 240
  };
  if (qualityMap[cleanQuality]) {
    return qualityMap[cleanQuality];
  }
  const numQuality = parseInt(cleanQuality);
  if (!isNaN(numQuality) && numQuality > 0) {
    return numQuality;
  }
  return 0;
}
function formatSize(sizeValue) {
  if (typeof sizeValue !== "number" || sizeValue <= 0) {
    return "Unknown";
  }
  if (sizeValue > 1e9) {
    return `${(sizeValue / 1e9).toFixed(2)} GB`;
  }
  return `${(sizeValue / 1e6).toFixed(0)} MB`;
}
function resolutionToQuality(resolution) {
  const qualityMap = {
    1: "480p",
    2: "720p",
    3: "1080p"
  };
  return qualityMap[resolution] || `${resolution}p`;
}

function castleBounded(run, timeoutMs) {
  if (timeoutMs <= 0) return Promise.reject(new Error("Castle request budget exhausted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Castle request timed out")), timeoutMs);
    Promise.resolve().then(run).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

// src/castle/index.js
function processVideoResponse(videoData, mediaInfo, seasonNum, episodeNum, resolution, languageInfo) {
  const streams = [];
  const data = extractDataBlock(videoData);
  const videoUrl = data.videoUrl;
  if (!videoUrl && !(Array.isArray(data.videos) && data.videos.some(v => v && v.url))) {
    console.log("[Castle] No videoUrl found in response");
    return streams;
  }
  
  const subtitles = [];
  if (data.subtitles && Array.isArray(data.subtitles)) {
    data.subtitles.forEach((sub) => {
      if (sub.url) {
        subtitles.push({
          url: sub.url,
          language: sub.abbreviate || "Unknown",
          name: sub.title || sub.abbreviate || "Unknown",
          headers: PLAYBACK_HEADERS
        });
      }
    });
  }

  let mediaTitle = mediaInfo.title || "Unknown";
  if (mediaInfo.year) {
    mediaTitle += ` (${mediaInfo.year})`;
  }
  if (seasonNum != null && episodeNum != null) {
    mediaTitle = `${mediaInfo.title} S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
  }
  const quality = resolutionToQuality(resolution);
  if (Array.isArray(data.videos) && data.videos.length) {
    for (const video of data.videos) {
      if (!video || !(video.url || videoUrl)) continue;
      let videoQuality = String(video.resolutionDescription || (video.resolution ? resolutionToQuality(video.resolution) : quality));
      videoQuality = videoQuality.replace(/^(SD|HD|FHD)\s+/i, "");
      const streamName = languageInfo ? `Castle ${languageInfo} - ${videoQuality}` : `Castle - ${videoQuality}`;
      streams.push({
        name: streamName,
        title: mediaTitle,
        url: video.url || videoUrl,
        quality: videoQuality,
        size: formatSize(video.size),
        headers: PLAYBACK_HEADERS,
        provider: "castle",
        subtitles
      });
    }
  } else {
    const streamName = languageInfo ? `Castle ${languageInfo} - ${quality}` : `Castle - ${quality}`;
    streams.push({
      name: streamName,
      title: mediaTitle,
      url: videoUrl,
      quality,
      size: formatSize(data.size),
      headers: PLAYBACK_HEADERS,
      provider: "castle",
      subtitles
    });
  }
  return streams;
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    console.log(`[Castle] Starting extraction for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === "tv" ? `, S:${seasonNum}E:${episodeNum}` : ""}`);
    try {
      const deadline = Date.now() + 17500;
      const [tmdbInfo, securityKey] = yield Promise.all([getTMDBDetails(tmdbId, mediaType), getSecurityKey()]);
      console.log(`[Castle] TMDB Info: "${tmdbInfo.title}" (${tmdbInfo.year || "N/A"})`);
      const movieId = yield findCastleMovieId(securityKey, tmdbInfo);
      let details = yield getDetails(securityKey, movieId);
      let currentMovieId = movieId;
      if (mediaType === "tv") {
        const data = extractDataBlock(details);
        const seasons = data.seasons || [];
        const season = seasons.find((s) => Number(s.number) === Number(seasonNum));
        if (seasons.length && !season) throw new Error("Requested season unavailable");
        if (season && season.movieId && String(season.movieId) !== String(movieId)) {
          console.log(`[Castle] Fetching season ${seasonNum} details...`);
          details = yield getDetails(securityKey, season.movieId.toString());
          currentMovieId = season.movieId.toString();
        }
      }
      const detailsData = extractDataBlock(details);
      const episodes = detailsData.episodes || [];
      let episodeId = null;
      if (mediaType === "tv") {
        const episode2 = episodes.find((e) => Number(e.number) === Number(episodeNum));
        if (episode2 && episode2.id) {
          episodeId = episode2.id.toString();
        }
      } else if (episodes.length > 0) {
        episodeId = episodes[0].id.toString();
      }
      if (!episodeId) {
        throw new Error("Could not find episode ID");
      }
      const episode = episodes.find((e) => e.id.toString() === episodeId);
      const tracks = episode && episode.tracks || [];
      const resolution = 2;
      const allStreams = [];
      // Keep completed tracks inside the app budget, with at most three requests in flight.
      const audioTracks = tracks.filter(t => t && t.existIndividualVideo && t.languageId);
      const trackResults = new Array(audioTracks.length);
      let nextTrack = 0;
      const audioDeadline = deadline - 3500;
      function worker() {
        return __async(this, null, function* () {
          while (nextTrack < audioTracks.length && Date.now() < audioDeadline) {
            const index = nextTrack++;
            const track = audioTracks[index];
            const langName = track.languageName || track.abbreviate || "Unknown";
            try {
              const videoData = yield castleBounded(
                () => getVideoV1(securityKey, currentMovieId, episodeId, track.languageId, resolution),
                Math.min(4500, audioDeadline - Date.now()));
              trackResults[index] = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, `[${langName}]`);
            } catch (error) {
              console.log(`[Castle] ${langName}: Failed - ${error.message}`);
            }
          }
        });
      }
      yield Promise.all(Array.from({ length: Math.min(3, audioTracks.length) }, () => worker()));
      for (const results of trackResults) if (results) allStreams.push(...results);
      if (allStreams.length === 0) {
        console.log("[Castle] Falling back to shared stream (v2)");
        const videoData = yield castleBounded(() => getVideo2(securityKey, currentMovieId, episodeId, resolution), deadline - Date.now());
        const sharedStreams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, "[Shared]");
        allStreams.push(...sharedStreams);
      }
      allStreams.sort((a, b) => getQualityValue(b.quality) - getQualityValue(a.quality));
      console.log(`[Castle] Total streams found: ${allStreams.length}`);
      return allStreams;
    } catch (error) {
      console.error(`[Castle] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "castle", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "🏰 Castle", "castle");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
