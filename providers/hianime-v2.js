// Imported provider: hianime-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
 * hianime - Built from src/hianime/
 * Generated: 2026-06-01T14:20:20.767Z
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

// src/hianime/index.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

// src/hianime/constants.js
var MEGAPLAY_BASE = "https://megaplay.buzz";
var VIDWISH_BASE = "https://vidwish.live";
var MEGACLOUD_BASE = "https://megacloud.bloggy.click";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Connection": "keep-alive"
};

// src/hianime/utils.js
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const response = yield fetch(url, __spreadValues({
      headers: __spreadValues(__spreadValues({}, DEFAULT_HEADERS), options.headers)
    }, options));
    if (!response.ok)
      throw new Error(`HTTP ${response.status} on ${url}`);
    return yield response.text();
  });
}
function fetchJson(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const text = yield fetchText(url, options);
    return JSON.parse(text);
  });
}
function getImdbId(tmdbId, mediaType) {
  return __async(this, null, function* () {
    try {
      const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      const data = yield fetchJson(url);
      return data.imdb_id || null;
    } catch (e) {
      return null;
    }
  });
}
function getTmdbShowTitle(tmdbId, mediaType) {
  return __async(this, null, function* () {
    try {
      const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
      const data = yield fetchJson(url);
      return data.name || data.title || data.original_title || null;
    } catch (e) {
      return null;
    }
  });
}
function resolveMapping(imdbId, season, episode) {
  return __async(this, null, function* () {
    try {
      const url = `https://id-mapping-api-malid.hf.space/api/resolve?id=${imdbId}&s=${season}&e=${episode}`;
      const data = yield fetchJson(url);
      if (data.error)
        return null;
      return data;
    } catch (e) {
      return null;
    }
  });
}
function searchMalId(title, mediaType) {
  return __async(this, null, function* () {
    try {
      const type = mediaType === "movie" ? "movie" : "tv";
      const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&type=${type}&limit=1`;
      const data = yield fetchJson(url);
      if (data.data && data.data.length > 0) {
        return data.data[0].mal_id;
      }
      return null;
    } catch (e) {
      return null;
    }
  });
}

// src/hianime/index.js
function extractSources(apiUrl, referer, origin, serverName, animeTitle, episodeNum, type) {
  return __async(this, null, function* () {
    var _a;
    try {
      const json = yield fetchJson(apiUrl, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Referer": referer,
          "Origin": origin
        }
      });
      const file = (_a = json.sources) == null ? void 0 : _a.file;
      if (!file)
        return [];
      const streamTitle = `${animeTitle} - Episode ${episodeNum} (${type.toUpperCase()})`;
      const streams = [];
      streams.push({
        name: `HiAnime [${serverName}] (${type.toUpperCase()})`,
        title: streamTitle,
        url: file,
        quality: "Auto",
        headers: __spreadProps(__spreadValues({}, DEFAULT_HEADERS), {
          "Referer": `${origin}/`,
          "Origin": origin
        }),
        provider: "hianime",
        type: "m3u8"
      });
      if (json.tracks && json.tracks.length > 0) {
        const subtitles = json.tracks.filter((t) => t.file && t.kind === "captions").map((t) => ({
          url: t.file,
          name: t.label || "English",
          language: t.label ? t.label.slice(0, 3).toLowerCase() : "en"
        }));
        streams[0].subtitles = subtitles;
      }
      return streams;
    } catch (e) {
      return [];
    }
  });
}
function scrapeType(malId, episode, type, animeTitle) {
  return __async(this, null, function* () {
    const streams = [];
    const megaUrl = `${MEGAPLAY_BASE}/stream/mal/${malId}/${episode}/${type}`;
    try {
      const html = yield fetchText(megaUrl, {
        headers: { "Referer": megaUrl }
      });
      const $ = import_cheerio_without_node_native.default.load(html);
      const player = $("div.fix-area#megaplay-player");
      if (!player.length)
        return [];
      const dataId = player.attr("data-id");
      const realId = player.attr("data-realid");
      const extractions = [];
      if (dataId) {
        const apiUrl = `${MEGAPLAY_BASE}/stream/getSources?id=${dataId}&id=${dataId}`;
        extractions.push(
          extractSources(apiUrl, megaUrl, MEGAPLAY_BASE, "MegaPlay", animeTitle, episode, type)
        );
      }
      if (realId) {
        const vidPage = `${VIDWISH_BASE}/stream/s-2/${realId}/${type}`;
        extractions.push((() => __async(this, null, function* () {
          try {
            const vidHtml = yield fetchText(vidPage, { headers: { "Referer": megaUrl } });
            const $v = import_cheerio_without_node_native.default.load(vidHtml);
            const vPlayer = $v("div.fix-area#megaplay-player");
            const vDataId = vPlayer.attr("data-id");
            if (vDataId) {
              const apiUrl = `${VIDWISH_BASE}/stream/getSources?id=${vDataId}&id=${vDataId}`;
              return yield extractSources(apiUrl, vidPage, VIDWISH_BASE, "Vidwish", animeTitle, episode, type);
            }
          } catch (err) {
          }
          return [];
        }))());
      }
      if (realId) {
        const megacloudPage = `${MEGACLOUD_BASE}/stream/s-3/${realId}/${type}`;
        extractions.push((() => __async(this, null, function* () {
          try {
            const mcHtml = yield fetchText(megacloudPage, { headers: { "Referer": megaUrl } });
            const $m = import_cheerio_without_node_native.default.load(mcHtml);
            const mPlayer = $m("div.fix-area#megaplay-player");
            const mDataId = mPlayer.attr("data-id");
            if (mDataId) {
              const apiUrl = `${MEGACLOUD_BASE}/stream/getSources?id=${mDataId}&id=${mDataId}`;
              return yield extractSources(apiUrl, megacloudPage, MEGACLOUD_BASE, "MegaCloud", animeTitle, episode, type);
            }
          } catch (err) {
          }
          return [];
        }))());
      }
      const results = yield Promise.all(extractions);
      for (const res of results) {
        streams.push(...res);
      }
    } catch (e) {
    }
    return streams;
  });
}
function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "Stream Preferences" },
      {
        type: "select",
        key: "subDub",
        label: "Audio/Subtitle Preference",
        options: [
          { label: "Sub & Dub", value: "both" },
          { label: "Sub Only", value: "sub" },
          { label: "Dub Only", value: "dub" }
        ],
        defaultValue: "both"
      }
    ];
  });
}
function getStreams(tmdbId, mediaType = "tv", season = 1, episode = 1) {
  return __async(this, null, function* () {
    try {
      let malId = null;
      let mappedEp = episode;
      let showTitle = "";
      const imdbId = yield getImdbId(tmdbId, mediaType);
      showTitle = (yield getTmdbShowTitle(tmdbId, mediaType)) || (mediaType === "movie" ? "Movie" : "Anime");
      if (!imdbId)
        return [];
      const s = mediaType === "movie" ? 1 : season;
      const e = mediaType === "movie" ? 1 : episode;
      if (mediaType === "movie") {
        malId = yield searchMalId(showTitle, "movie");
        mappedEp = 1;
      }
      if (!malId && mediaType !== "movie") {
        const mapping = yield resolveMapping(imdbId, s, e);
        if (mapping && mapping.mal_id) {
          malId = mapping.mal_id;
          mappedEp = mapping.mal_episode || episode;
        }
      }
      if (!malId)
        return [];
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const preference = settings.subDub || "both";
      let allStreams = [];
      if (preference === "both") {
        const [subStreams, dubStreams] = yield Promise.all([
          scrapeType(malId, mappedEp, "sub", showTitle),
          scrapeType(malId, mappedEp, "dub", showTitle)
        ]);
        allStreams = [...subStreams, ...dubStreams];
      } else {
        allStreams = yield scrapeType(malId, mappedEp, preference, showTitle);
      }
      const seen = /* @__PURE__ */ new Set();
      return allStreams.filter((s2) => {
        if (seen.has(s2.url))
          return false;
        seen.add(s2.url);
        return true;
      });
    } catch (e) {
      return [];
    }
  });
}
module.exports = { getStreams, onSettings };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "hianime-v2", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
