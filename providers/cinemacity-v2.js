// Imported provider: cinemacity-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
 * cinemacity - Built from src/cinemacity/
 * Generated: 2026-06-01T14:20:20.706Z
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

// src/cinemacity/index.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

// src/cinemacity/constants.js
var MAIN_URL = "https://cinemacity.cc";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Cookie": "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;",
  "Referer": "https://cinemacity.cc/"
};
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

// src/cinemacity/utils.js
var atobPolyfill = (str) => {
  try {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let output = "";
    str = String(str).replace(/[=]+$/, "");
    if (str.length % 4 === 1)
      return "";
    for (let bc = 0, bs = 0, buffer, i = 0; buffer = str.charAt(i++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
      buffer = chars.indexOf(buffer);
    }
    return output;
  } catch (e) {
    return "";
  }
};
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const response = yield fetch(url, __spreadValues({
      headers: options.headers || HEADERS,
      skipSizeCheck: true
    }, options));
    return yield response.text();
  });
}
function extractQuality(url) {
  const low = (url || "").toLowerCase();
  if (low.includes("2160p") || low.includes("4k"))
    return "4K";
  if (low.includes("1080p"))
    return "1080p";
  if (low.includes("720p"))
    return "720p";
  if (low.includes("480p"))
    return "480p";
  if (low.includes("360p"))
    return "360p";
  return "HD";
}

// src/cinemacity/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var _a;
    const streams = [];
    try {
      const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const tmdbRes = yield fetch(tmdbUrl, { skipSizeCheck: true });
      const tmdbData = yield tmdbRes.json();
      const imdbId = ((_a = tmdbData.external_ids) == null ? void 0 : _a.imdb_id) || tmdbData.imdb_id;
      const animeTitle = mediaType === "movie" ? tmdbData.title : tmdbData.name;
      if (!animeTitle && !imdbId)
        return [];
      const searchQuery = imdbId || animeTitle;
      const searchUrl = `${MAIN_URL}/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(searchQuery)}`;
      console.log(`[CinemaCity] Searching for: ${searchQuery}`);
      const searchHtml = yield fetchText(searchUrl);
      const $search = import_cheerio_without_node_native.default.load(searchHtml);
      let mediaUrl = null;
      $search("div.dar-short_item").each((i, el) => {
        if (mediaUrl)
          return;
        const anchor = $search(el).find("a").filter((idx, a) => ($search(a).attr("href") || "").includes(".html")).first();
        if (!anchor.length)
          return;
        const href = anchor.attr("href");
        const foundTitle = anchor.text().toLowerCase();
        if (imdbId && searchHtml.includes(imdbId)) {
          mediaUrl = href;
        } else if (foundTitle.includes(animeTitle.toLowerCase()) || animeTitle.toLowerCase().includes(foundTitle)) {
          mediaUrl = href;
        }
      });
      if (!mediaUrl && imdbId && searchQuery !== animeTitle) {
        console.log(`[CinemaCity] IMDB search failed, falling back to title search: ${animeTitle}`);
        const titleSearchUrl = `${MAIN_URL}/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(animeTitle)}`;
        const titleSearchHtml = yield fetchText(titleSearchUrl);
        const $titleSearch = import_cheerio_without_node_native.default.load(titleSearchHtml);
        $titleSearch("div.dar-short_item").each((i, el) => {
          if (mediaUrl)
            return;
          const anchor = $titleSearch(el).find("a").filter((idx, a) => ($titleSearch(a).attr("href") || "").includes(".html")).first();
          if (anchor.length)
            mediaUrl = anchor.attr("href");
        });
      }
      if (!mediaUrl) {
        console.log(`[CinemaCity] No media found for ${animeTitle}`);
        return [];
      }
      console.log(`[CinemaCity] Loading media page: ${mediaUrl}`);
      const pageHtml = yield fetchText(mediaUrl);
      const $page = import_cheerio_without_node_native.default.load(pageHtml);
      let fileData = null;
      let globalSubtitleData = null;
      $page("script").each((i, el) => {
        if (fileData)
          return;
        const html = $page(el).html();
        if (html && html.includes("atob")) {
          const regex = /atob\s*\(\s*(['"])(.*?)\1\s*\)/g;
          let match;
          while ((match = regex.exec(html)) !== null) {
            try {
              const decoded = atobPolyfill(match[2]);
              const fileMatch = decoded.match(new RegExp(`file\\s*:\\s*(['"])(.*?)\\1`, "s")) || decoded.match(new RegExp("file\\s*:\\s*(\\[.*?\\])", "s")) || decoded.match(new RegExp("file\\s*:\\s*(\\{.*?\\})", "s"));
              const subMatch = decoded.match(new RegExp(`subtitle\\s*:\\s*(['"])(.*?)\\1`, "s"));
              if (fileMatch) {
                let rawFile = fileMatch[2] || fileMatch[1];
                if (rawFile && rawFile.length > 5) {
                  if (rawFile.startsWith("[") || rawFile.startsWith("{")) {
                    try {
                      const unescaped = rawFile.replace(/\\(.)/g, "$1");
                      fileData = JSON.parse(unescaped);
                    } catch (e) {
                      try {
                        fileData = JSON.parse(rawFile);
                      } catch (e2) {
                        fileData = rawFile;
                      }
                    }
                  } else {
                    fileData = rawFile;
                  }
                }
              }
              if (subMatch) {
                globalSubtitleData = subMatch[2];
              }
              if (fileData)
                break;
            } catch (err) {
            }
          }
        }
      });
      if (!fileData) {
        console.log(`[CinemaCity] Failed to extract player data`);
        return [];
      }
      const parseSubtitles = (raw) => {
        const subtitles = [];
        if (!raw || typeof raw !== "string")
          return subtitles;
        raw.split(",").forEach((entry) => {
          const match = entry.trim().match(/\[(.+?)\](https?:\/\/.+)/);
          if (match) {
            subtitles.push({
              url: match[2],
              language: match[1],
              name: match[1],
              headers: { Referer: "https://cinemacity.cc/" }
            });
          }
        });
        return subtitles;
      };
      const addStream = (url, title, quality, subtitles) => {
        if (!url || !url.startsWith("http") || url.length < 15)
          return;
        streams.push({
          name: "CinemaCity",
          title,
          url,
          quality: quality || extractQuality(url),
          headers: __spreadProps(__spreadValues({}, HEADERS), {
            Referer: "https://cinemacity.cc/"
          }),
          subtitles: subtitles || []
        });
      };
      const processStr = (str, title, subtitles) => {
        if (str.includes(".urlset/master.m3u8")) {
          addStream(str, title, "Auto", subtitles);
        } else {
          const urls = str.includes("[") ? str.split(",") : [str];
          urls.forEach((u) => {
            const m = u.match(/\[(.*?)\](.*)/);
            if (m)
              addStream(m[2], title, m[1], subtitles);
            else
              addStream(u, title, extractQuality(u), subtitles);
          });
        }
      };
      if (mediaType === "movie") {
        if (Array.isArray(fileData)) {
          const obj = fileData.find((f) => !f.folder && f.file) || fileData[0];
          if (obj && obj.file) {
            const subs = parseSubtitles(obj.subtitle || globalSubtitleData);
            processStr(obj.file, animeTitle, subs);
          }
        } else if (typeof fileData === "string") {
          const subs = parseSubtitles(globalSubtitleData);
          processStr(fileData, animeTitle, subs);
        }
      } else {
        if (Array.isArray(fileData)) {
          const sLabel = `Season ${season}`;
          const sObj = fileData.find((s) => (s.title || "").includes(sLabel) || (s.title || "").includes(`S${season}`));
          if (sObj && sObj.folder) {
            const eLabel = `Episode ${episode}`;
            const eObj = sObj.folder.find((e) => (e.title || "").includes(eLabel) || (e.title || "").includes(`E${episode}`));
            if (eObj && eObj.file) {
              const subs = parseSubtitles(eObj.subtitle || sObj.subtitle || globalSubtitleData);
              processStr(eObj.file, `${animeTitle} S${season}E${episode}`, subs);
            }
          }
        }
      }
      console.log(`[CinemaCity] Successfully processed ${streams.length} streams`);
      return streams;
    } catch (error) {
      console.error(`[CinemaCity] Error in getStreams: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "cinemacity-v2", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
