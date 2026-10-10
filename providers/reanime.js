// Imported provider: reanime; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
 * reanime - Built from src/reanime/
 * Generated: 2026-09-21T13:43:14.525Z
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

// src/reanime/reanime.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

// src/reanime/constants.js
var REANIME_DOMAINS = [
  "https://reanime.to",
  "https://reanime.cz",
  "https://reanime.wtf"
];
var REANIME_BASE = "https://reanime.to";
var FLIXCLOUD_BASE = "https://flixcloud.cc";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var ANILIST_URL = "https://graphql.anilist.co";
var ARM_BASE = "https://arm.haglund.dev/api/v2";
var CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};
var FLIX_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Origin": FLIXCLOUD_BASE,
  "Referer": `${FLIXCLOUD_BASE}/`
};

// src/reanime/reanime.js
var activeBaseUrl = REANIME_BASE;
function absolutize(path, base = activeBaseUrl) {
  if (!path)
    return "";
  if (path.startsWith("http"))
    return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const isAbsolute = url.startsWith("http");
    const urlsToTry = isAbsolute ? [url] : REANIME_DOMAINS.map((domain) => absolutize(url, domain));
    let lastError = null;
    for (const tryUrl of urlsToTry) {
      try {
        const response = yield fetch(tryUrl, __spreadProps(__spreadValues({}, options), {
          headers: __spreadValues(__spreadValues({}, HEADERS), options.headers || {})
        }));
        if (response.ok) {
          if (!isAbsolute) {
            const match = tryUrl.match(/^(https?:\/\/[^\/]+)/);
            if (match)
              activeBaseUrl = match[1];
          }
          return yield response.text();
        }
        lastError = new Error(`Reanime HTTP ${response.status}: ${tryUrl}`);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error(`Failed to fetch: ${url}`);
  });
}
function fetchJson(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const text = yield fetchText(url, __spreadProps(__spreadValues({}, options), {
      headers: __spreadValues({
        "Accept": "application/json, text/plain, */*"
      }, options.headers || {})
    }));
    return JSON.parse(text);
  });
}
function getTmdbInfo(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    try {
      const data = yield fetchJson(url);
      return {
        title: data.name || data.title || data.original_name || data.original_title || "",
        year: ((data.first_air_date || data.release_date || "").match(/\d{4}/) || [null])[0],
        imdbId: data.external_ids && data.external_ids.imdb_id
      };
    } catch (_) {
      return { title: "", year: null, imdbId: null };
    }
  });
}
function getAnilistInfo(alId) {
  return __async(this, null, function* () {
    var _a, _b, _c, _d, _e;
    const query = "query($id:Int){Media(id:$id){id title{english romaji native} startDate{year}}}";
    try {
      const json = yield fetchJson(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { id: parseInt(alId, 10) } })
      });
      const media = (_a = json.data) == null ? void 0 : _a.Media;
      if (!media)
        return { title: "", year: null };
      return {
        title: ((_b = media.title) == null ? void 0 : _b.english) || ((_c = media.title) == null ? void 0 : _c.romaji) || ((_d = media.title) == null ? void 0 : _d.native) || "",
        year: ((_e = media.startDate) == null ? void 0 : _e.year) || null
      };
    } catch (_) {
      return { title: "", year: null };
    }
  });
}
function getSyncInfo(id, mediaType, season, episode) {
  return __async(this, null, function* () {
    const isImdb = typeof id === "string" && id.indexOf("tt") === 0;
    const getCinemetaInfo = (imdbId2) => __async(this, null, function* () {
      const type = mediaType === "movie" ? "movie" : "series";
      const url = `${CINEMETA_URL}/${type}/${imdbId2}.json`;
      try {
        const data = yield fetchJson(url);
        const meta = data.meta;
        if (!meta)
          throw new Error("No Cinemeta metadata");
        if (mediaType === "movie")
          return { date: meta.released ? meta.released.split("T")[0] : null, title: meta.name, dayIndex: 1 };
        const videos = meta.videos || [];
        const target = videos.find((v) => v.season == season && v.episode == episode);
        if (!target || !target.released)
          return { date: null, title: null, dayIndex: 1 };
        const targetDate = target.released.split("T")[0];
        const dayIndex = videos.filter((v) => v.season == season && v.released && v.released.split("T")[0] === targetDate && parseInt(v.episode) < parseInt(episode)).length + 1;
        return { date: targetDate, title: target.name || null, dayIndex };
      } catch (_) {
        return { date: null, title: null, dayIndex: 1 };
      }
    });
    if (isImdb) {
      const info = yield getCinemetaInfo(id);
      if (info.date)
        return { imdbId: id, releaseDate: info.date, episodeTitle: info.title, dayIndex: info.dayIndex, episode };
      throw new Error("Could not find release date on Cinemeta");
    }
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "movie" ? "movie" : "tv"}/${id}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    const details = yield fetchJson(tmdbUrl);
    let imdbId = details.external_ids && details.external_ids.imdb_id || details.imdb_id || null;
    const title = details.name || details.title || null;
    if (!imdbId) {
      try {
        const armData = yield fetchJson(`${ARM_BASE}/themoviedb?id=${id}`);
        imdbId = Array.isArray(armData) && armData.length > 0 ? armData[0].imdb : null;
      } catch (_) {
      }
    }
    if (!imdbId)
      throw new Error(`No IMDb ID found for TMDB ${id}`);
    const cMeta = yield getCinemetaInfo(imdbId);
    let finalDate = cMeta.date;
    if (mediaType === "movie" && details.release_date)
      finalDate = details.release_date;
    if (!finalDate)
      throw new Error(`Could not find release date for ID ${imdbId}`);
    return {
      imdbId,
      tmdbId: id,
      releaseDate: finalDate,
      title,
      episodeTitle: cMeta.title,
      dayIndex: cMeta.dayIndex,
      episode
    };
  });
}
function resolveByDate(releaseDateStr, showTitle, originalEpisode, episodeTitle, dayIndex) {
  return __async(this, null, function* () {
    var _a, _b;
    if (!releaseDateStr || !/^\d{4}-\d{2}-\d{2}/.test(releaseDateStr))
      return null;
    const query = "query($search:String){Page(perPage:20){media(search:$search,type:ANIME){id type format title{romaji english native}startDate{year month day}endDate{year month day}episodes streamingEpisodes{title}}}}";
    try {
      const json = yield fetchJson(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { search: showTitle } })
      });
      const candidates = ((_b = (_a = json.data) == null ? void 0 : _a.Page) == null ? void 0 : _b.media) || [];
      if (candidates.length === 0)
        return null;
      const targetDate = new Date(releaseDateStr);
      for (const anime of candidates) {
        const s = anime.startDate;
        const startStr = s.year && s.month && s.day ? `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}` : null;
        if (!startStr)
          continue;
        const startDate = new Date(startStr);
        const diffDays = Math.ceil(Math.abs(targetDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24));
        let isMatch = false;
        if (anime.format === "MOVIE" || anime.format === "SPECIAL" || anime.episodes === 1) {
          if (diffDays <= 2)
            isMatch = true;
        } else {
          const startLimit = new Date(startDate);
          startLimit.setDate(startLimit.getDate() - 2);
          if (targetDate >= startLimit) {
            if (anime.endDate && anime.endDate.year) {
              const endDate = new Date(anime.endDate.year, (anime.endDate.month || 12) - 1, anime.endDate.day || 31);
              endDate.setDate(endDate.getDate() + 2);
              if (targetDate <= endDate)
                isMatch = true;
            } else {
              isMatch = true;
            }
          }
        }
        if (isMatch) {
          const isTV = anime.format !== "MOVIE" && anime.format !== "SPECIAL" && anime.episodes !== 1;
          let episodeNum = isTV && originalEpisode ? originalEpisode : dayIndex || 1;
          const episodes = anime.streamingEpisodes || [];
          if (episodes.length > 1 && episodeTitle) {
            const cleanTarget = episodeTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
            for (let j = 0; j < episodes.length; j++) {
              const cleanAl = (episodes[j].title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
              if (cleanAl && (cleanAl.indexOf(cleanTarget) !== -1 || cleanTarget.indexOf(cleanAl) !== -1)) {
                episodeNum = j + 1;
                break;
              }
            }
          }
          return { alId: anime.id, episode: episodeNum, title: anime.title.english || anime.title.romaji || anime.title.native };
        }
      }
    } catch (_) {
    }
    return null;
  });
}
function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function scoreCandidate(title, query, year, targetAnilistId, candidateAnilistId) {
  if (targetAnilistId && candidateAnilistId && String(targetAnilistId) === String(candidateAnilistId)) {
    return 1e3;
  }
  const a = normalizeTitle(title);
  const b = normalizeTitle(query);
  if (!a || !b)
    return 0;
  let score = 0;
  if (a === b)
    score += 100;
  if (a.includes(b) || b.includes(a))
    score += 50;
  const words = b.split(/\s+/).filter(Boolean);
  for (const word of words)
    if (a.includes(word))
      score += 4;
  if (year && String(title).includes(String(year)))
    score += 10;
  return score;
}
function extractAnilistId(item) {
  var _a, _b, _c;
  const direct = item && (item.anilist_id || item.anilistId);
  if (direct)
    return String(direct);
  const imageUrls = [
    (_a = item == null ? void 0 : item.cover_image) == null ? void 0 : _a.extra_large,
    (_b = item == null ? void 0 : item.cover_image) == null ? void 0 : _b.large,
    (_c = item == null ? void 0 : item.cover_image) == null ? void 0 : _c.medium,
    item == null ? void 0 : item.banner_image
  ].filter(Boolean);
  for (const url of imageUrls) {
    const match = String(url).match(/\/b?x?(\d+)-|\/(\d+)[-.]/);
    if (match)
      return match[1] || match[2];
  }
  return null;
}
function searchReanimeAnime(query, year, targetAnilistId = null) {
  return __async(this, null, function* () {
    const endpoints = [
      `/api/v1/search?q=${encodeURIComponent(query)}&limit=36`,
      `/api/search?q=${encodeURIComponent(query)}`
    ];
    const candidates = [];
    for (const endpoint of endpoints) {
      try {
        const text = yield fetchText(endpoint);
        if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
          const json = JSON.parse(text);
          const list = json.results || json.data || json.anime || (Array.isArray(json) ? json : null);
          if (Array.isArray(list)) {
            list.forEach((item) => {
              const rawSlug = item.anime_id || item.slug || item.id || item.url;
              if (rawSlug) {
                const cleanSlug = String(rawSlug).replace(/-[a-z0-9]{6}$/, "");
                const titles = [];
                if (typeof item.title === "object" && item.title) {
                  if (item.title.english)
                    titles.push(item.title.english);
                  if (item.title.romaji)
                    titles.push(item.title.romaji);
                  if (item.title.native)
                    titles.push(item.title.native);
                } else if (item.title) {
                  titles.push(item.title);
                }
                if (item.name)
                  titles.push(item.name);
                if (titles.length === 0)
                  titles.push(cleanSlug);
                const alId = extractAnilistId(item);
                let bestScore = 0;
                for (const t of titles) {
                  const sc = scoreCandidate(t, query, year, targetAnilistId, alId);
                  if (sc > bestScore)
                    bestScore = sc;
                }
                candidates.push({
                  slug: String(rawSlug),
                  cleanSlug,
                  title: titles[0],
                  anilistId: alId,
                  score: bestScore
                });
              }
            });
          }
        }
      } catch (_) {
      }
      if (candidates.some((c) => c.score >= 1e3))
        break;
      if (candidates.length > 0 && !targetAnilistId)
        break;
    }
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      if (!candidate.slug || seen.has(candidate.slug))
        continue;
      seen.add(candidate.slug);
      unique.push(candidate);
    }
    unique.sort((a, b) => b.score - a.score);
    return unique.length > 0 ? unique[0] : null;
  });
}
function getFlixEmbeds(slug, episodeNumber, language, anilistId) {
  return __async(this, null, function* () {
    const watchPath = `/watch/${slug || "anime"}?ep=${episodeNumber}`;
    if (anilistId) {
      try {
        const flixUrl = `/api/flix/${anilistId}/${episodeNumber}`;
        const json = yield fetchJson(flixUrl, {
          headers: { "Referer": absolutize(watchPath) }
        });
        if (json.success && Array.isArray(json.servers) && json.servers.length > 0) {
          const filtered = language ? json.servers.filter((s) => s.dataType && s.dataType.toLowerCase() === language.toLowerCase()) : json.servers;
          return {
            watchUrl: absolutize(watchPath),
            servers: filtered,
            embeds: filtered.map((s) => s.dataLink).filter(Boolean)
          };
        }
      } catch (_) {
      }
    }
    if (slug) {
      try {
        const animeApiUrl = `/api/v1/anime/${slug}`;
        const animeData = yield fetchJson(animeApiUrl);
        const alId = animeData == null ? void 0 : animeData.anilist_id;
        if (alId) {
          const flixUrl = `/api/flix/${alId}/${episodeNumber}`;
          const json = yield fetchJson(flixUrl, {
            headers: { "Referer": absolutize(watchPath) }
          });
          if (json.success && Array.isArray(json.servers) && json.servers.length > 0) {
            const filtered = language ? json.servers.filter((s) => s.dataType && s.dataType.toLowerCase() === language.toLowerCase()) : json.servers;
            return {
              watchUrl: absolutize(watchPath),
              servers: filtered,
              embeds: filtered.map((s) => s.dataLink).filter(Boolean)
            };
          }
        }
      } catch (_) {
      }
      try {
        const html = yield fetchText(`/anime/${slug}?_ep=${episodeNumber}`);
        const anilistMatch = html.match(/anilist_id:\s*(\d+)/);
        if (anilistMatch) {
          const alId = anilistMatch[1];
          const flixUrl = `/api/flix/${alId}/${episodeNumber}`;
          const json = yield fetchJson(flixUrl, {
            headers: { "Referer": absolutize(watchPath) }
          });
          if (json.success && Array.isArray(json.servers) && json.servers.length > 0) {
            const filtered = language ? json.servers.filter((s) => s.dataType && s.dataType.toLowerCase() === language.toLowerCase()) : json.servers;
            return {
              watchUrl: absolutize(watchPath),
              servers: filtered,
              embeds: filtered.map((s) => s.dataLink).filter(Boolean)
            };
          }
        }
      } catch (_) {
      }
    }
    return { watchUrl: absolutize(watchPath), servers: [], embeds: [] };
  });
}

// src/reanime/flixcloud.js
function extractFlixCloudDownload(embedUrl) {
  return __async(this, null, function* () {
    try {
      const match = embedUrl.match(/\/e\/([a-z0-9]+)/i);
      const aid = match ? match[1] : null;
      if (!aid)
        return null;
      const dlHeaders = {
        "Accept": "*/*",
        "Referer": `${FLIXCLOUD_BASE}/`,
        "User-Agent": USER_AGENT
      };
      const res = yield fetch(`${FLIXCLOUD_BASE}/d/${aid}/__data.json`, {
        headers: dlHeaders
      });
      if (!res.ok)
        return null;
      const dataBody = yield res.text();
      const fileIdMatch = dataBody.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const tokenMatch = dataBody.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
      const baseMatch = dataBody.match(/https:\/\/[a-z0-9-]+\.flixcloud\.cc/i);
      const resolutionMatch = dataBody.match(/(\d{3,4}p)/);
      const sizeMatch = dataBody.match(/"(\d+(?:\.\d+)?\s*[KMG]B)"/i);
      const fileId = fileIdMatch ? fileIdMatch[0] : null;
      const token = tokenMatch ? tokenMatch[0] : null;
      const base = baseMatch ? baseMatch[0] : FLIXCLOUD_BASE;
      const resolution = resolutionMatch ? resolutionMatch[1] : null;
      const size = sizeMatch ? sizeMatch[1] : "Unknown";
      if (!fileId || !token)
        return null;
      let ready = false;
      try {
        const progRes = yield fetch(`${base}/download/${fileId}/progress?token=${token}`, {
          headers: dlHeaders
        });
        if (progRes.ok) {
          const text = yield progRes.text();
          if (text.includes('"status":"ready"') || text.includes('"ready"')) {
            ready = true;
          }
        }
      } catch (_) {
      }
      const fileUrl = `${base}/download/${fileId}?token=${token}`;
      return {
        url: fileUrl,
        quality: resolution || "1080p",
        size,
        type: "mkv",
        headers: dlHeaders,
        ready
      };
    } catch (_) {
      return null;
    }
  });
}

// src/reanime/index.js
function getStreams(tmdbId, mediaType = "tv", season = null, episode = null) {
  return __async(this, null, function* () {
    try {
      if (mediaType !== "tv" && mediaType !== "movie")
        return [];
      let alId = null;
      let episodeNumber = mediaType === "tv" ? Number(episode || 1) : 1;
      let searchTitle = "";
      let searchYear = null;
      if (typeof tmdbId === "string" && tmdbId.indexOf("anilist:") === 0) {
        alId = tmdbId.split(":")[1];
      } else {
        try {
          const syncInfo = yield getSyncInfo(tmdbId, mediaType, season, episodeNumber);
          searchTitle = syncInfo.title;
          if (syncInfo.releaseDate) {
            searchYear = syncInfo.releaseDate.substring(0, 4);
          }
          const syncResult = yield resolveByDate(syncInfo.releaseDate, syncInfo.title, episodeNumber, syncInfo.episodeTitle, syncInfo.dayIndex);
          if (syncResult && syncResult.alId) {
            alId = String(syncResult.alId);
            episodeNumber = syncResult.episode;
            searchTitle = syncResult.title;
          }
        } catch (_) {
        }
        if (!searchTitle || !searchYear) {
          try {
            const tmdb = yield getTmdbInfo(tmdbId, mediaType);
            if (!searchTitle)
              searchTitle = tmdb.title;
            if (!searchYear)
              searchYear = tmdb.year;
          } catch (_) {
          }
        }
      }
      const serversByLang = {};
      let watchUrl = "";
      if (alId) {
        for (const lang of ["sub", "dub"]) {
          try {
            const res = yield getFlixEmbeds(null, episodeNumber, lang, alId);
            if (res.servers && res.servers.length > 0) {
              serversByLang[lang] = res.servers;
              if (res.watchUrl)
                watchUrl = res.watchUrl;
            }
          } catch (_) {
          }
        }
      }
      if (Object.keys(serversByLang).length === 0) {
        if (!searchTitle && alId) {
          const alInfo = yield getAnilistInfo(alId);
          searchTitle = alInfo.title;
          searchYear = alInfo.year;
        }
        if (searchTitle) {
          const anime = yield searchReanimeAnime(searchTitle, searchYear, alId);
          if (anime) {
            const slug = anime.slug;
            const finalAlId = alId || anime.anilistId;
            for (const lang of ["sub", "dub"]) {
              try {
                const res = yield getFlixEmbeds(slug, episodeNumber, lang, finalAlId);
                if (res.servers && res.servers.length > 0) {
                  serversByLang[lang] = res.servers;
                  if (res.watchUrl)
                    watchUrl = res.watchUrl;
                }
              } catch (_) {
              }
            }
          }
        }
      }
      if (Object.keys(serversByLang).length === 0)
        return [];
      const streams = [];
      const seen = /* @__PURE__ */ new Set();
      const tasks = [];
      for (const language of ["sub", "dub"]) {
        const serverList = serversByLang[language] || [];
        for (let i = 0; i < serverList.length; i++) {
          const server = serverList[i];
          const dataLink = server.dataLink;
          if (!dataLink)
            continue;
          const serverName = server.serverName || `HD-${i + 1}`;
          const langUpper = language.toUpperCase();
          const displayTitle = searchTitle || "Anime";
          const streamTitle = mediaType === "movie" ? `${displayTitle} (${langUpper})` : `${displayTitle} - Episode ${episodeNumber} (${langUpper})`;
          tasks.push((() => __async(this, null, function* () {
            try {
              const directDl = yield extractFlixCloudDownload(dataLink);
              if (directDl && directDl.url) {
                return {
                  name: `Reanime [${langUpper}] ${serverName} (${directDl.quality || "1080p"})`,
                  title: streamTitle,
                  url: directDl.url,
                  quality: directDl.quality || "1080p",
                  size: directDl.size || "Unknown",
                  headers: directDl.headers,
                  provider: "reanime",
                  type: "mkv"
                };
              }
            } catch (_) {
            }
            return null;
          }))());
        }
      }
      const results = yield Promise.all(tasks);
      for (const res of results) {
        if (res && res.url && !seen.has(res.name)) {
          seen.add(res.name);
          streams.push(res);
        }
      }
      const qualityRank = {
        "auto": 4e3,
        "adaptive": 4e3,
        "2160p": 2160,
        "4k": 2160,
        "1080p": 1080,
        "720p": 720,
        "480p": 480,
        "360p": 360,
        "unknown": 0
      };
      streams.sort((a, b) => {
        var _a, _b;
        const qa = qualityRank[(_a = a.quality) == null ? void 0 : _a.toLowerCase()] || 0;
        const qb = qualityRank[(_b = b.quality) == null ? void 0 : _b.toLowerCase()] || 0;
        return qb - qa;
      });
      return streams;
    } catch (error) {
      console.error(`[Reanime] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "reanime", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "Reanime", "reanime");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
