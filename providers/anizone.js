// Imported provider: anizone; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
 * anizone - Built from src/anizone/
 * Generated: 2026-09-25T19:36:47.745Z
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

// src/anizone/index.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

// src/anizone/constants.js
var MAIN_URL = "https://anizone.to";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Referer": "https://anizone.to/"
};
var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";

// src/anizone/utils.js
var HEX_ESCAPE = /\\x([0-9a-fA-F]{2})/g;
var INVALID_BACKSLASH = /\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g;
function sanitizeJson(raw) {
  if (!raw)
    return "";
  return raw.replace(/\\u0022/g, '"').replace(/\\u0026/g, "&").replace(/\\'/g, "'").replace(/\\\//g, "/").replace(/\\\\/g, "\\").replace(/\\&/g, "&").replace(/\\'/g, "'").replace(/\\0/g, "\\u0000").replace(HEX_ESCAPE, (_, hex) => "\\u00" + hex).replace(INVALID_BACKSLASH, "");
}
function parseXDataJson(rawArg) {
  const sanitized = sanitizeJson(rawArg);
  return JSON.parse(sanitized);
}
function fetchWithTimeout(_0) {
  return __async(this, arguments, function* (url, options = {}, timeoutMs = 8e3) {
    const mergedHeaders = __spreadValues({
      "User-Agent": HEADERS["User-Agent"],
      "Referer": HEADERS["Referer"]
    }, options.headers || {});
    const fetchOptions = __spreadProps(__spreadValues({
      skipSizeCheck: true
    }, options), {
      headers: mergedHeaders
    });
    if (typeof setTimeout !== "function") {
      return fetch(url, fetchOptions);
    }
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    });
    try {
      const res = yield Promise.race([
        fetch(url, fetchOptions),
        timeoutPromise
      ]);
      clearTimeout(timer);
      return res;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  });
}
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const finalUrl = url.startsWith("http") ? url : `${MAIN_URL}${url}`;
    try {
      const response = yield fetchWithTimeout(finalUrl, options, 1e4);
      if (!response.ok)
        return "";
      return yield response.text();
    } catch (e) {
      return "";
    }
  });
}
function fetchWithCookies(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    var _a, _b;
    const finalUrl = url.startsWith("http") ? url : `${MAIN_URL}${url}`;
    try {
      const response = yield fetchWithTimeout(finalUrl, options, 1e4);
      if (!response.ok)
        return { text: "", cookies: "", ok: false };
      const text = yield response.text();
      let cookies = "";
      try {
        if (typeof ((_a = response.headers) == null ? void 0 : _a.getSetCookie) === "function") {
          cookies = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
        } else if ((_b = response.headers) == null ? void 0 : _b.get) {
          cookies = response.headers.get("set-cookie") || "";
        }
      } catch (_) {
      }
      return { text, cookies, ok: true };
    } catch (e) {
      return { text: "", cookies: "", ok: false };
    }
  });
}
function getImdbId(tmdbId, mediaType) {
  return __async(this, null, function* () {
    try {
      const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      const res = yield fetchWithTimeout(url, {}, 5e3);
      const data = yield res.json();
      return data.imdb_id || null;
    } catch (_) {
      return null;
    }
  });
}
function isDateMatch(d1, d2) {
  if (!d1 || !d2)
    return false;
  const s1 = d1.split("T")[0];
  const s2 = d2.split("T")[0];
  const date1 = /* @__PURE__ */ new Date(s1 + "T00:00:00Z");
  const date2 = /* @__PURE__ */ new Date(s2 + "T00:00:00Z");
  const diff = Math.abs(date1.getTime() - date2.getTime());
  return Math.ceil(diff / (1e3 * 60 * 60 * 24)) <= 2;
}
function resolveMapping(imdbId, season, episode, tmdbId) {
  return __async(this, null, function* () {
    var _a, _b, _c, _d;
    const seasonNum = parseInt(season, 10);
    const episodeNum = parseInt(episode, 10);
    const mapId = `${imdbId}:s${season}:e${episode}`;
    let metaData = null;
    const metaUrls = [
      `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
      `https://cinemeta-live.strem.io/meta/series/${imdbId}.json`
    ];
    for (const url of metaUrls) {
      try {
        const mRes = yield fetchWithTimeout(url, {}, 5e3);
        if (mRes.ok) {
          const text = yield mRes.text();
          const json = JSON.parse(text);
          if ((_a = json == null ? void 0 : json.meta) == null ? void 0 : _a.videos) {
            metaData = json.meta;
            break;
          }
        }
      } catch (_) {
      }
    }
    if ((!metaData || !metaData.videos) && tmdbId) {
      try {
        const tmdbEpUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${TMDB_API_KEY}`;
        const tmdbRes = yield fetchWithTimeout(tmdbEpUrl, {}, 5e3);
        if (tmdbRes.ok) {
          const epData = JSON.parse(yield tmdbRes.text());
          if (epData == null ? void 0 : epData.air_date) {
            const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
            const tvRes = yield fetchWithTimeout(tvUrl, {}, 5e3);
            const tvData = tvRes.ok ? JSON.parse(yield tvRes.text()) : {};
            metaData = {
              name: tvData.name || tvData.original_name,
              moviedb_id: tmdbId,
              videos: [{
                season: seasonNum,
                episode: episodeNum,
                released: epData.air_date
              }]
            };
          }
        }
      } catch (_) {
      }
    }
    if (!metaData || !metaData.videos)
      return null;
    const video = metaData.videos.find((v) => v.season === seasonNum && v.episode === episodeNum);
    if (!(video == null ? void 0 : video.released))
      return null;
    const airDate = video.released.split("T")[0];
    const showTitle = metaData.name;
    const dayIndex = metaData.videos.filter((v) => {
      if (!v.released)
        return false;
      return v.released.split("T")[0] === airDate && (v.season < seasonNum || v.season === seasonNum && v.episode < episodeNum);
    }).length;
    let malIds = [];
    const tId = tmdbId || metaData.moviedb_id || metaData.themoviedb_id;
    const tvdbId = metaData.tvdb_id;
    const armUrls = [
      `https://arm.haglund.dev/api/v2/imdb?id=${imdbId}`,
      tId ? `https://arm.haglund.dev/api/v2/themoviedb?id=${tId}` : null,
      tvdbId ? `https://arm.haglund.dev/api/v2/thetvdb?id=${tvdbId}` : null
    ].filter(Boolean);
    for (const url of armUrls) {
      try {
        const res = yield fetchWithTimeout(url, {}, 5e3);
        if (res.ok) {
          const data = JSON.parse(yield res.text());
          if (Array.isArray(data)) {
            data.forEach((e) => {
              if (e.myanimelist)
                malIds.push(e.myanimelist);
            });
          }
        }
      } catch (_) {
      }
    }
    try {
      const aniIdUrl = tId ? `https://api.ani.zip/mappings?themoviedb_id=${tId}` : `https://api.ani.zip/mappings?imdb_id=${imdbId}`;
      const aniRes = yield fetchWithTimeout(aniIdUrl, {}, 5e3);
      if (aniRes.ok) {
        const aniData = JSON.parse(yield aniRes.text());
        if ((_b = aniData == null ? void 0 : aniData.mappings) == null ? void 0 : _b.mal_id)
          malIds.push(aniData.mappings.mal_id);
      }
    } catch (_) {
    }
    malIds = [...new Set(malIds)].filter(Boolean).sort((a, b) => b - a);
    let finalResult = null;
    for (const malId of malIds) {
      try {
        const aniRes = yield fetchWithTimeout(`https://api.ani.zip/mappings?mal_id=${malId}`, {}, 5e3);
        if (aniRes.ok) {
          const aniData = JSON.parse(yield aniRes.text());
          const extraTitles = (aniData == null ? void 0 : aniData.titles) ? Object.values(aniData.titles).filter(Boolean) : [];
          if (aniData == null ? void 0 : aniData.episodes) {
            const aniEpisodes = Object.values(aniData.episodes).map((ep) => ({
              mal_episode_number: parseInt(ep.episode, 10),
              air_date: ep.airDateUtc || ep.airDate || ep.airdate
            })).filter((ep) => !isNaN(ep.mal_episode_number));
            const aniDateMatches = aniEpisodes.filter((ep) => isDateMatch(ep.air_date, airDate)).sort((a, b) => a.mal_episode_number - b.mal_episode_number);
            if (aniDateMatches[dayIndex]) {
              const match = aniDateMatches[dayIndex];
              finalResult = {
                id: mapId,
                imdb_id: imdbId,
                season: seasonNum,
                episode: episodeNum,
                mal_id: malId,
                mal_episode: match.mal_episode_number,
                anime_title: showTitle,
                titles: extraTitles,
                air_date: airDate
              };
              break;
            }
          }
        }
      } catch (_) {
      }
      try {
        const jRes = yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${malId}`, {}, 5e3);
        if (jRes.ok) {
          const jData = JSON.parse(yield jRes.text());
          if (((_d = (_c = jData == null ? void 0 : jData.data) == null ? void 0 : _c.aired) == null ? void 0 : _d.from) && isDateMatch(jData.data.aired.from, airDate)) {
            finalResult = {
              id: mapId,
              imdb_id: imdbId,
              season: seasonNum,
              episode: episodeNum,
              mal_id: malId,
              mal_episode: dayIndex + 1,
              anime_title: showTitle,
              titles: [jData.data.title, jData.data.title_english, jData.data.title_japanese].filter(Boolean),
              air_date: airDate
            };
            break;
          }
        }
      } catch (_) {
      }
    }
    if (!finalResult && malIds.length === 1 && seasonNum === 1) {
      finalResult = {
        id: mapId,
        imdb_id: imdbId,
        season: seasonNum,
        episode: episodeNum,
        mal_id: malIds[0],
        mal_episode: episodeNum,
        anime_title: showTitle,
        titles: [],
        air_date: airDate
      };
    }
    return finalResult;
  });
}
function getMalTitle(malId) {
  return __async(this, null, function* () {
    var _a, _b;
    if (!malId)
      return null;
    try {
      const res = yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${malId}`, {}, 5e3);
      if (res.ok) {
        const data = yield res.json();
        return ((_a = data.data) == null ? void 0 : _a.title) || ((_b = data.data) == null ? void 0 : _b.title_english) || null;
      }
    } catch (_) {
    }
    return null;
  });
}
function getTmdbInfo(tmdbId, mediaType, season = 1) {
  return __async(this, null, function* () {
    try {
      const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
      const res = yield fetchWithTimeout(url, {}, 6e3);
      if (!res.ok)
        return null;
      const data = yield res.json();
      const info = {
        title: data.name || data.title || data.original_name || data.original_title || "",
        originalTitle: data.original_name || data.original_title || "",
        seasonName: ""
      };
      if (mediaType === "tv" && season) {
        try {
          const sUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`;
          const sRes = yield fetchWithTimeout(sUrl, {}, 6e3);
          if (sRes.ok) {
            const sData = yield sRes.json();
            info.seasonName = sData.name || "";
          }
        } catch (e) {
        }
      }
      return info;
    } catch (e) {
      return null;
    }
  });
}

// src/anizone/index.js
function normalize(str) {
  if (!str)
    return "";
  return str.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}
function parseCards(html, $) {
  const cards = [];
  const itemsMatch = html.match(/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if (itemsMatch) {
    try {
      const parsed = parseXDataJson(itemsMatch[1]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || !item.slug)
            continue;
          const titles = /* @__PURE__ */ new Set();
          if (item.main_title)
            titles.add(item.main_title);
          if (item.title_list && typeof item.title_list === "object") {
            Object.values(item.title_list).forEach((t) => {
              if (t)
                titles.add(t);
            });
          }
          cards.push({
            slug: item.slug,
            url: item.url || `/anime/${item.slug}`,
            titles: Array.from(titles)
          });
        }
      }
    } catch (e) {
    }
  }
  if (cards.length === 0) {
    $('[x-data*="anmTitles"]').each((i, el) => {
      const href = $(el).find('a[href*="/anime/"]').first().attr("href");
      if (!href)
        return;
      const parts = href.split("/");
      const slug = parts[parts.length - 1] || parts[parts.length - 2];
      const titles = /* @__PURE__ */ new Set();
      const xData = $(el).attr("x-data") || "";
      const jsonMatch = xData.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
      if (jsonMatch) {
        try {
          const parsed = parseXDataJson(jsonMatch[1]);
          Object.values(parsed).forEach((t) => {
            if (t)
              titles.add(t);
          });
        } catch (e) {
        }
      }
      cards.push({ slug, titles: Array.from(titles) });
    });
  }
  return cards;
}
function getSeasonRegexes(season) {
  if (season === 1) {
    return {
      mustNot: [
        /season\s*[2-9]/i,
        /saison\s*[2-9]/i,
        /[\s\-][iI]{2,}/,
        /\s+[2-9]nd/i,
        /\s+[2-9]rd/i,
        /\s+[2-9]th/i,
        /\s+ii\b/i,
        /\s+iii\b/i,
        /\s+iv\b/i,
        /\s+v\b/i,
        /movie/i,
        /gekijouban/i,
        /the movie/i
      ]
    };
  }
  const patterns = [];
  if (season === 2) {
    patterns.push(/season\s*2/i, /saison\s*2/i, /2nd\s*season/i, /[\s\-]ii\b/i, /\b2\b/);
  } else if (season === 3) {
    patterns.push(/season\s*3/i, /saison\s*3/i, /3rd\s*season/i, /[\s\-]iii\b/i, /\b3\b/);
  } else if (season === 4) {
    patterns.push(/season\s*4/i, /saison\s*4/i, /4th\s*season/i, /[\s\-]iv\b/i, /\b4\b/, /final\s*season/i);
  } else {
    patterns.push(new RegExp(`(?:season|saison)\\s*${season}`, "i"), new RegExp(`\\b${season}\\b`));
  }
  return { must: patterns };
}
function matchCard(cards, targetTitles, baseTitle, season = 1, seasonName = "") {
  const normalizedTargets = targetTitles.map(normalize).filter(Boolean);
  const normalizedBase = normalize(baseTitle);
  const normalizedSeasonName = normalize(seasonName);
  if (normalizedSeasonName && normalizedSeasonName !== "season" + season) {
    for (const card of cards) {
      for (const title of card.titles) {
        if (normalize(title).includes(normalizedSeasonName)) {
          return card.slug;
        }
      }
    }
  }
  for (const target of normalizedTargets) {
    for (const card of cards) {
      for (const title of card.titles) {
        if (normalize(title) === target) {
          return card.slug;
        }
      }
    }
  }
  const seasonRules = getSeasonRegexes(season);
  for (const card of cards) {
    let matchesBase = false;
    for (const title of card.titles) {
      const norm = normalize(title);
      if (norm.includes(normalizedBase) || normalizedBase.includes(norm)) {
        matchesBase = true;
        break;
      }
    }
    if (!matchesBase)
      continue;
    let seasonMatches = false;
    if (season === 1) {
      let hasOtherSeason = false;
      for (const title of card.titles) {
        if (seasonRules.mustNot.some((regex) => regex.test(title))) {
          hasOtherSeason = true;
          break;
        }
      }
      if (!hasOtherSeason)
        seasonMatches = true;
    } else {
      for (const title of card.titles) {
        if (seasonRules.must.some((regex) => regex.test(title))) {
          seasonMatches = true;
          break;
        }
      }
    }
    if (seasonMatches)
      return card.slug;
  }
  return cards[0] ? cards[0].slug : null;
}
function matchMovieCard(cards, targetTitles) {
  const normalizedTargets = targetTitles.map(normalize).filter(Boolean);
  for (const card of cards) {
    for (const title of card.titles) {
      const norm = normalize(title);
      if (normalizedTargets.some((t) => t === norm))
        return card.slug;
    }
  }
  for (const card of cards) {
    for (const title of card.titles) {
      const norm = normalize(title);
      if (normalizedTargets.some((t) => norm.includes(t) || t.includes(norm)))
        return card.slug;
    }
  }
  return cards[0] ? cards[0].slug : null;
}
function parseVidstackFromHtml(html, $) {
  const vidMatch = html.match(/vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/);
  if (vidMatch) {
    try {
      const data = parseXDataJson(vidMatch[1]);
      const masterUrl2 = data.src ? data.src.replace(/\\/g, "") : null;
      const subtitles2 = (data.subtitles || []).map((s) => ({
        url: s.file ? s.file.replace(/\\/g, "") : "",
        name: s.title || s.language || "English",
        language: s.language || "en"
      })).filter((s) => s.url);
      if (masterUrl2)
        return { masterUrl: masterUrl2, subtitles: subtitles2 };
    } catch (e) {
    }
  }
  let masterUrl = $("media-player").attr("src");
  if (!masterUrl) {
    const urlMatch = html.match(/https:\/\/[^"']+\/master\.m3u8/);
    if (urlMatch)
      masterUrl = urlMatch[0];
  }
  const subtitles = [];
  $("track").each((i, el) => {
    const src = $(el).attr("src");
    const kind = $(el).attr("kind");
    if (src && (kind === "subtitles" || kind === "captions" || src.endsWith(".ass") || src.endsWith(".vtt"))) {
      subtitles.push({
        url: src,
        name: $(el).attr("label") || "English",
        language: $(el).attr("srclang") || "en"
      });
    }
  });
  return { masterUrl, subtitles };
}
function parseAudioFormat(btnText) {
  const lower = btnText.toLowerCase();
  const hasJap = lower.includes("japanese") || lower.includes("jpn") || lower.includes("ja");
  const hasEng = lower.includes("english") || lower.includes("eng") || lower.includes("en");
  if (hasEng && hasJap)
    return "Dual Audio";
  if (hasEng)
    return "Dub";
  if (hasJap)
    return "Sub";
  if (lower.includes("multi"))
    return "Multi-Audio";
  return "Sub";
}
function searchCards(query) {
  return __async(this, null, function* () {
    if (!query)
      return [];
    const searchUrl = `/anime?search=${encodeURIComponent(query)}&sort=title-asc`;
    const searchHtml = yield fetchText(searchUrl);
    if (!searchHtml)
      return [];
    const $search = import_cheerio_without_node_native.default.load(searchHtml);
    return parseCards(searchHtml, $search);
  });
}
function getStreams(tmdbId, mediaType = "tv", season = 1, episode = 1) {
  return __async(this, null, function* () {
    var _a, _b, _c;
    try {
      console.log(`[AniZone] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}, S${season}E${episode}`);
      let animeTitle = "";
      let altTitles = [];
      let mappedEp = episode;
      let seasonName = "";
      let targetTitles = [];
      if (mediaType === "tv") {
        const imdbId = yield getImdbId(tmdbId, "tv");
        if (imdbId) {
          const mapping = yield resolveMapping(imdbId, season, episode, tmdbId);
          if (mapping) {
            mappedEp = mapping.mal_episode || episode;
            animeTitle = mapping.anime_title || "";
            if (mapping.titles && Array.isArray(mapping.titles)) {
              targetTitles.push(...mapping.titles);
            }
            const malTitle = yield getMalTitle(mapping.mal_id);
            if (malTitle) {
              targetTitles.push(malTitle);
              if (!animeTitle)
                animeTitle = malTitle;
            }
            console.log(`[AniZone] AnimeSync mapped: "${animeTitle}", mappedEp=${mappedEp}`);
          }
        }
        if (!animeTitle) {
          const tmdbInfo = yield getTmdbInfo(tmdbId, mediaType, season);
          if (tmdbInfo) {
            animeTitle = tmdbInfo.title;
            if (tmdbInfo.originalTitle)
              altTitles.push(tmdbInfo.originalTitle);
            seasonName = tmdbInfo.seasonName || "";
          }
        }
      } else {
        const tmdbInfo = yield getTmdbInfo(tmdbId, "movie");
        if (tmdbInfo) {
          animeTitle = tmdbInfo.title;
          if (tmdbInfo.originalTitle)
            altTitles.push(tmdbInfo.originalTitle);
        }
        mappedEp = 1;
      }
      if (!animeTitle && targetTitles.length === 0)
        return [];
      if (!animeTitle && targetTitles.length > 0)
        animeTitle = targetTitles[0];
      const specificTargetTitles = season === 1 || mediaType === "movie" ? [...targetTitles, animeTitle, ...altTitles] : [...targetTitles];
      const baseCleanQuery = animeTitle.split(":")[0].replace(/season.*|\d+nd season|\d+rd season|\d+th season|saison.*/gi, "").trim();
      let cards = yield searchCards(baseCleanQuery);
      if (cards.length === 0 && animeTitle !== baseCleanQuery) {
        cards = yield searchCards(animeTitle.split(":")[0].trim());
      }
      if (cards.length === 0) {
        for (const t of altTitles) {
          const altClean = t.split(":")[0].trim();
          cards = yield searchCards(altClean);
          if (cards.length > 0)
            break;
        }
      }
      if (cards.length === 0)
        return [];
      let animeSlug = null;
      if (mediaType === "tv") {
        animeSlug = matchCard(cards, specificTargetTitles, baseCleanQuery, season, seasonName);
      } else {
        animeSlug = matchMovieCard(cards, specificTargetTitles);
      }
      if (!animeSlug) {
        console.log(`[AniZone] No matching slug found for "${animeTitle}"`);
        return [];
      }
      console.log(`[AniZone] Selected slug: "${animeSlug}", mappedEp=${mappedEp}`);
      const episodeUrl = `/anime/${animeSlug}/${mappedEp}`;
      const epResponse = yield fetchWithCookies(episodeUrl);
      if (!epResponse.ok || !epResponse.text) {
        console.log(`[AniZone] Failed to load episode page: ${episodeUrl}`);
        return [];
      }
      const epHtml = epResponse.text;
      const $ep = import_cheerio_without_node_native.default.load(epHtml);
      const streams = [];
      const defaultStream = parseVidstackFromHtml(epHtml, $ep);
      const serverButtons = $ep('button[wire\\:click*="setVideo"]');
      let defaultFormat = "Sub";
      let defaultServerName = "AniZone";
      if (serverButtons.length > 0) {
        const firstBtn = serverButtons.first();
        const btnText = firstBtn.text().replace(/\s+/g, " ").trim();
        defaultFormat = parseAudioFormat(btnText);
        const nameMatch = btnText.match(/^([A-Za-z0-9_-]+)/);
        if (nameMatch)
          defaultServerName = nameMatch[1];
      }
      if (defaultStream.masterUrl) {
        streams.push({
          name: "AniZone",
          title: `${animeTitle} - Episode ${mappedEp} [${defaultServerName} - ${defaultFormat}]`,
          url: defaultStream.masterUrl,
          quality: "Multi",
          headers: HEADERS,
          subtitles: defaultStream.subtitles
        });
      }
      if (serverButtons.length > 1) {
        const csrfToken = $ep("script[data-csrf]").attr("data-csrf");
        const snapshotEl = $ep("main > div[wire\\:snapshot], main > ul[wire\\:snapshot], [wire\\:snapshot]");
        const snapshot = snapshotEl.attr("wire:snapshot");
        if (csrfToken && snapshot && epResponse.cookies) {
          for (let i = 1; i < serverButtons.length; i++) {
            const btn = serverButtons.eq(i);
            const clickAttr = btn.attr("wire:click") || "";
            const vMatch = clickAttr.match(/setVideo\((\d+)\)/);
            if (!vMatch)
              continue;
            const videoId = parseInt(vMatch[1], 10);
            const btnText = btn.text().replace(/\s+/g, " ").trim();
            const sFormat = parseAudioFormat(btnText);
            const nameMatch = btnText.match(/^([A-Za-z0-9_-]+)/);
            const sName = nameMatch ? nameMatch[1] : `Server ${i + 1}`;
            try {
              const payload = {
                _token: csrfToken,
                components: [
                  {
                    snapshot,
                    updates: {},
                    calls: [{ path: "", method: "setVideo", params: [videoId] }]
                  }
                ]
              };
              const postRes = yield fetchWithTimeout(`${MAIN_URL}/livewire/update`, {
                method: "POST",
                headers: {
                  "Accept": "*/*",
                  "Content-Type": "application/json",
                  "X-Livewire": "",
                  "X-CSRF-TOKEN": csrfToken,
                  "Origin": MAIN_URL,
                  "Referer": `${MAIN_URL}${episodeUrl}`,
                  "Cookie": epResponse.cookies
                },
                body: JSON.stringify(payload)
              }, 8e3);
              if (postRes.ok) {
                const postData = yield postRes.json();
                const liveHtml = (_c = (_b = (_a = postData.components) == null ? void 0 : _a[0]) == null ? void 0 : _b.effects) == null ? void 0 : _c.html;
                if (liveHtml) {
                  const $live = import_cheerio_without_node_native.default.load(liveHtml);
                  const extraStream = parseVidstackFromHtml(liveHtml, $live);
                  if (extraStream.masterUrl && extraStream.masterUrl !== defaultStream.masterUrl) {
                    streams.push({
                      name: "AniZone",
                      title: `${animeTitle} - Episode ${mappedEp} [${sName} - ${sFormat}]`,
                      url: extraStream.masterUrl,
                      quality: "Multi",
                      headers: HEADERS,
                      subtitles: extraStream.subtitles.length > 0 ? extraStream.subtitles : defaultStream.subtitles
                    });
                  }
                }
              }
            } catch (e) {
            }
          }
        }
      }
      console.log(`[AniZone] Total streams found: ${streams.length}`);
      return streams;
    } catch (error) {
      console.log(`[AniZone] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "anizone", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "AniZone", "anizone");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
