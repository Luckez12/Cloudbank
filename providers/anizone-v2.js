// Imported provider: anizone-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
      var timer = setTimeout(function() { finish([]); }, 45000);
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

/* CLOUDBANK_ANIME_MAPPING_START */
/* Cloudbank anime mapping adapter. No Node globals or runtime imports. */
function cloudbankAnimeMappingFetch(nativeFetch) {
  var cache = Object.create(null), cacheKeys = [], tmdbKey = "", documents = Object.create(null), documentKeys = [], malTitles = Object.create(null), titleKeys = [];
  function response(data, status) {
    var body = JSON.stringify(data);
    return { ok: status === 200, status: status, statusText: status === 200 ? "OK" : "Not Found",
      headers: { get: function(n) { return String(n).toLowerCase() === "content-type" ? "application/json" : null; } },
      json: function() { return Promise.resolve(JSON.parse(body)); }, text: function() { return Promise.resolve(body); },
      clone: function() { return response(data, status); } };
  }
  function loadJson(url) {
    var timer, settled = false;
    return new Promise(function(resolve) {
      function finish(value) { if (settled) return; settled = true; clearTimeout(timer); resolve(value); }
      timer = setTimeout(function() { finish(null); }, 8000);
      Promise.resolve().then(function() { return nativeFetch(url); }).then(function(r) {
        return r.ok ? r.json() : null;
      }).then(finish, function() { finish(null); });
    });
  }
  function json(url) {
    var hit = documents[url];
    if (hit && Date.now() - hit.time < 300000) return hit.promise;
    var entry = { time: Date.now(), promise: null };
    entry.promise = loadJson(url).then(function(data) {
      if (!data) delete documents[url];
      return data;
    });
    documents[url] = entry;
    documentKeys.push(url);
    if (documentKeys.length > 20) delete documents[documentKeys.shift()];
    return entry.promise;
  }
  function positive(value) { var n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
  function day(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ""; }
  function compatible(a, b) {
    if (!a || !b) return false;
    return Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) <= 86400000;
  }
  async function resolve(id, season, episode, movie) {
    var isImdb = /^tt\d+$/.test(id);
    if (!isImdb && !positive(id)) return null;
    var route = isImdb ? "imdb" : "themoviedb";
    var armPromise = json("https://arm.haglund.dev/api/v2/" + route + "?id=" + encodeURIComponent(id));
    // TMDB episode dates take precedence over Cinemeta's alternative season numbering.
    var metaPromise = !movie && isImdb ? json("https://v3-cinemeta.strem.io/meta/series/" + id + ".json") : Promise.resolve(null);
    var rows = await armPromise;
    if (!Array.isArray(rows)) return null;
    rows = rows.filter(function(r) {
      return r && positive(r.myanimelist) && (isImdb ? r.imdb === id : String(r.themoviedb) === id) &&
        (movie ? r.media === "MOVIE" && r["themoviedb-season"] == null :
          r["themoviedb-season"] != null && Number(r["themoviedb-season"]) === season);
    });
    var seen = Object.create(null);
    rows = rows.filter(function(r) { var key = r.myanimelist; if (seen[key]) return false; seen[key] = true; return true; });
    if (!rows.length || rows.length > 6) return null;
    if (movie) {
      if (rows.length !== 1) return null;
      return { mal_id: positive(rows[0].myanimelist), anilist: positive(rows[0].anilist), mal_episode: 1, episode: 1 };
    }
    if (!isImdb && /^tt\d+$/.test(rows[0].imdb || "")) {
      metaPromise = json("https://v3-cinemeta.strem.io/meta/series/" + rows[0].imdb + ".json");
    }
    var tmdbId = positive(rows[0].themoviedb), target = "", dayIndex = 0;
    var episodeUrl = tmdbKey && tmdbId ? "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "?api_key=" + encodeURIComponent(tmdbKey) : "";
    var seasonPromise = episodeUrl ? json(episodeUrl) : Promise.resolve(null);
    var datasetsPromise = Promise.all(rows.map(function(r) { return json("https://api.ani.zip/mappings?mal_id=" + r.myanimelist); }));
    var seasonData = await seasonPromise, metaData = await metaPromise;
    var videos = seasonData && Array.isArray(seasonData.episodes) ? seasonData.episodes :
      metaData && metaData.meta && Array.isArray(metaData.meta.videos) ? metaData.meta.videos : [];
    function number(v) { return Number(v.episode_number != null ? v.episode_number : v.episode != null ? v.episode : v.number); }
    function seasonOf(v) { return Number(v.season_number != null ? v.season_number : v.season); }
    function released(v) { return day(v.air_date || v.released || v.firstAired); }
    var selected = videos.find(function(v) { return seasonOf(v) === season && number(v) === episode; });
    if (!selected || !(target = released(selected))) return null;
    dayIndex = videos.filter(function(v) {
      return released(v) === target && (seasonOf(v) < season || seasonOf(v) === season && number(v) < episode);
    }).length;
    var datasets = await datasetsPromise, matches = [];
    datasets.forEach(function(data, i) {
      if (!data || !data.mappings || Number(data.mappings.mal_id) !== Number(rows[i].myanimelist) || !data.episodes) return;
      var list = Object.keys(data.episodes).map(function(k) { return data.episodes[k]; }).filter(function(e) {
        return e && /^\d+$/.test(String(e.episode)) && positive(e.episode) && compatible(day(e.airdate || e.airDate || e.airDateUtc), target);
      }).sort(function(a,b) { return Number(a.episode) - Number(b.episode); });
      // Exact dates win; +/- one day accounts only for local/UTC broadcast dates.
      var exact = list.filter(function(e) { return day(e.airdate || e.airDate || e.airDateUtc) === target; });
      if (exact.length) list = exact;
      if (!list[dayIndex] || list.length > 1 && dayIndex === 0 &&
          videos.filter(function(v) { return released(v) === target; }).length < list.length) return;
      var titles = data.titles || {}, ep = Number(list[dayIndex].episode);
      matches.push({ mal_id: Number(rows[i].myanimelist), anilist: positive(rows[i].anilist),
        mal_episode: ep, episode: ep, anime_title: titles.en || titles["x-jat"] || titles.ja || "",
        titles: Object.keys(titles).map(function(k) { return titles[k]; }).filter(Boolean), air_date: target });
    });
    return matches.length === 1 ? matches[0] : null;
  }
  return function(url, options) {
    var text = typeof url === "string" ? url : url && url.url, u;
    try { u = new URL(text); } catch (_) { return nativeFetch(url, options); }
    var method = options && options.method ? String(options.method).toUpperCase() : "GET";
    if (u.hostname === "api.themoviedb.org" && u.searchParams.get("api_key")) tmdbKey = u.searchParams.get("api_key");
    var malDetail = /^\/v4\/anime\/(\d+)$/.exec(u.pathname);
    if (method === "GET" && u.hostname === "api.jikan.moe" && malDetail && malTitles[malDetail[1]]) {
      return Promise.resolve(response({ data: { mal_id: Number(malDetail[1]), title: malTitles[malDetail[1]] } }, 200));
    }
    var legacy = u.hostname === "id-mapping-api-malid.hf.space" && u.pathname === "/api/resolve";
    var anikoto = u.hostname === "arm.haglund.dev" && u.pathname === "/api/v2/tmdb";
    if (method !== "GET" || !legacy && !anikoto) return nativeFetch(url, options);
    var id = u.searchParams.get("id") || "", movie = anikoto && !u.searchParams.has("s");
    var season = Number(u.searchParams.get("s")), episode = positive(u.searchParams.get("e"));
    if (!movie && (!Number.isInteger(season) || season < 0 || !episode || !u.searchParams.has("s")))
      return Promise.resolve(response({ error: "Invalid anime episode" }, 404));
    var key = JSON.stringify([id, movie, season, episode]);
    if (!cache[key]) {
      cache[key] = resolve(id, season, episode, movie).then(function(data) {
        if (!data) delete cache[key];
        if (data && data.anime_title) {
          if (!malTitles[data.mal_id]) titleKeys.push(data.mal_id);
          malTitles[data.mal_id] = data.anime_title;
          if (titleKeys.length > 32) delete malTitles[titleKeys.shift()];
        }
        return data;
      }, function() { delete cache[key]; return null; });
      cacheKeys.push(key);
      if (cacheKeys.length > 32) delete cache[cacheKeys.shift()];
    }
    return cache[key].then(function(data) { return response(data || { error: "Verified anime mapping unavailable" }, data ? 200 : 404); });
  };
}
/* CLOUDBANK_ANIME_MAPPING_END */
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
 * Generated: 2026-06-05T21:04:20.318Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
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

// src/anizone/utils.js
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const finalUrl = url.startsWith("http") ? url : `${MAIN_URL}${url}`;
    try {
      const response = yield fetch(finalUrl, __spreadValues({
        headers: HEADERS
      }, options));
      if (!response.ok)
        return "";
      return yield response.text();
    } catch (e) {
      return "";
    }
  });
}
function getImdbId(tmdbId, mediaType) {
  return __async(this, null, function* () {
    try {
      const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}/external_ids?api_key=1865f43a0549ca50d341dd9ab8b29f49`;
      const res = yield fetch(url, { headers: HEADERS });
      if (!res.ok)
        return null;
      const data = yield res.json();
      return data.imdb_id;
    } catch (e) {
      return null;
    }
  });
}
function resolveMapping(imdbId, season, episode) {
  return __async(this, null, function* () {
    try {
      const url = `https://id-mapping-api-malid.hf.space/api/resolve?id=${imdbId}&s=${season}&e=${episode}`;
      const res = yield fetch(url);
      if (!res.ok)
        return null;
      return yield res.json();
    } catch (e) {
      return null;
    }
  });
}
function getMalTitle(malId) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(`https://api.jikan.moe/v4/anime/${malId}`);
      if (!res.ok)
        return null;
      const data = yield res.json();
      return data.data.title;
    } catch (e) {
      return null;
    }
  });
}

// src/anizone/index.js
function extractCardInfo($, el) {
  const href = $(el).find('a[href*="/anime/"]').first().attr("href");
  if (!href)
    return null;
  const parts = href.split("/");
  const slug = parts[parts.length - 1] || parts[parts.length - 2];
  const xData = $(el).attr("x-data") || "";
  const defaultTitleMatch = xData.match(/window\.getTitle\(this\.anmTitles,\s*'([^']+)'\)/);
  const defaultTitle = defaultTitleMatch ? defaultTitleMatch[1] : "";
  const titles = /* @__PURE__ */ new Set();
  if (defaultTitle)
    titles.add(defaultTitle);
  const jsonMatch = xData.match(/JSON\.parse\('([^']+)'\)/);
  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1].replace(/\\\\/g, "\\").replace(/\\u([0-9a-fA-F]{4})/g, (m, grp) => String.fromCharCode(parseInt(grp, 16))).replace(/\\'/g, "'");
      const parsed = JSON.parse(jsonStr);
      Object.values(parsed).forEach((t) => {
        if (t)
          titles.add(t);
      });
    } catch (e) {
    }
  }
  return {
    slug,
    titles: Array.from(titles)
  };
}
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}
function getSeasonRegexes(season) {
  if (season === 1) {
    return {
      mustNot: [/season\s*[2-9]/i, /[\s\-][iI]{2,}/, /\s+[2-9]nd/i, /\s+[2-9]rd/i, /\s+[2-9]th/i, /\s+ii/i, /\s+iii/i, /\s+iv/i, /\s+v/i]
    };
  }
  const patterns = [];
  if (season === 2) {
    patterns.push(/season\s*2/i, /2nd\s*season/i, /[\s\-]ii\b/i, /\b2\b/);
  } else if (season === 3) {
    patterns.push(/season\s*3/i, /3rd\s*season/i, /[\s\-]iii\b/i, /\b3\b/);
  } else if (season === 4) {
    patterns.push(/season\s*4/i, /4th\s*season/i, /[\s\-]iv\b/i, /\b4\b/);
  } else {
    patterns.push(new RegExp(`season\\s*${season}`, "i"), new RegExp(`\\b${season}\\b`));
  }
  return { must: patterns };
}
function matchCard(cards, jikanTitle, baseTitle, season) {
  const normalizedJikan = normalize(jikanTitle);
  const normalizedJikanNoSub = normalize(jikanTitle.split(":")[0]);
  const normalizedBase = normalize(baseTitle);
  for (const card of cards) {
    for (const title of card.titles) {
      const normTitle = normalize(title);
      const normTitleNoSub = normalize(title.split(":")[0]);
      if (normTitle === normalizedJikan || normTitleNoSub === normalizedJikanNoSub) {
        return card.slug;
      }
    }
  }
  const seasonRules = getSeasonRegexes(season);
  for (const card of cards) {
    let matchesBase = false;
    for (const title of card.titles) {
      if (normalize(title).includes(normalizedBase)) {
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
  return null;
}
function matchMovieCard(cards, targetTitle) {
  const normTarget = normalize(targetTitle);
  for (const card of cards) {
    for (const title of card.titles) {
      if (normalize(title) === normTarget)
        return card.slug;
    }
  }
  for (const card of cards) {
    for (const title of card.titles) {
      if (normalize(title).includes(normTarget) || normTarget.includes(normalize(title)))
        return card.slug;
    }
  }
  return cards[0].slug;
}
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      let animeTitle = "";
      let mappedEp = episode;
      let mapping = null;
      if (mediaType === "tv") {
        const imdbId = yield getImdbId(tmdbId, mediaType);
        if (!imdbId)
          return [];
        mapping = yield resolveMapping(imdbId, season, episode);
        if (!mapping || !mapping.mal_id)
          return [];
        mappedEp = mapping.mal_episode || episode;
        animeTitle = yield getMalTitle(mapping.mal_id);
      } else {
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=1865f43a0549ca50d341dd9ab8b29f49`;
        const tmdbRes = yield fetch(tmdbUrl);
        const tmdbData = yield tmdbRes.json();
        animeTitle = tmdbData.title || tmdbData.original_title;
        mappedEp = 1;
      }
      if (!animeTitle)
        return [];
      let searchQuery = animeTitle;
      if (mediaType === "tv" && mapping) {
        searchQuery = mapping.anime_title || animeTitle.split(":")[0].trim();
      } else {
        searchQuery = animeTitle.split(":")[0].trim();
      }
      const searchUrl = `/anime?search=${encodeURIComponent(searchQuery)}`;
      const searchHtml = yield fetchText(searchUrl);
      if (!searchHtml)
        return [];
      const $search = import_cheerio_without_node_native.default.load(searchHtml);
      const cards = [];
      $search('[x-data*="anmTitles"]').each((i, el) => {
        const info = extractCardInfo($search, el);
        if (info)
          cards.push(info);
      });
      let animeSlug = null;
      if (cards.length > 0) {
        if (mediaType === "tv") {
          animeSlug = matchCard(cards, animeTitle, mapping && mapping.anime_title || animeTitle, season);
        } else {
          animeSlug = matchMovieCard(cards, animeTitle);
        }
      }
      if (!animeSlug) {
        $search("main a").each((i, el) => {
          const href = $search(el).attr("href");
          if (href && (href.startsWith("https://anizone.to/anime/") || href.startsWith("/anime/")) && !animeSlug) {
            const parts = href.split("/");
            animeSlug = parts[parts.length - 1] || parts[parts.length - 2];
          }
        });
      }
      if (!animeSlug)
        return [];
      const episodeUrl = `/anime/${animeSlug}/${mappedEp}`;
      const episodeHtml = yield fetchText(episodeUrl);
      if (!episodeHtml)
        return [];
      const streams = [];
      const $epPage = import_cheerio_without_node_native.default.load(episodeHtml);
      let masterUrl = $epPage("media-player").attr("src");
      if (!masterUrl) {
        const matches = episodeHtml.match(/https:\/\/[^"']+\/master\.m3u8/);
        if (matches) {
          masterUrl = matches[0];
        }
      }
      const subtitles = [];
      $epPage("track").each((i, el) => {
        const src = $epPage(el).attr("src");
        const kind = $epPage(el).attr("kind");
        if (src && (kind === "subtitles" || kind === "captions" || src.endsWith(".ass") || src.endsWith(".vtt"))) {
          subtitles.push({
            url: src,
            name: $epPage(el).attr("label") || "English",
            language: $epPage(el).attr("srclang") || "en"
          });
        }
      });
      let format = "Sub";
      $epPage("button").each((i, el) => {
        const text = $epPage(el).text();
        if (text.includes("Audio:")) {
          const hasJapanese = text.includes("Japanese");
          const hasEnglish = text.includes("English");
          if (hasEnglish && !hasJapanese)
            format = "Dub";
          else if (hasEnglish && hasJapanese)
            format = "Sub & Dub";
        }
      });
      if (format === "Sub") {
        $epPage('button[wire\\:click^="setVideo"]').each((i, el) => {
          const btnText = $epPage(el).text();
          const hasJapanese = btnText.includes("Japanese");
          const hasEnglish = btnText.includes("English");
          if (hasEnglish && !hasJapanese)
            format = "Dub";
          else if (hasEnglish && hasJapanese)
            format = "Sub & Dub";
        });
      }
      if (masterUrl) {
        streams.push({
          name: "AniZone",
          title: `${animeTitle} - Episode ${mappedEp} [${format}]`,
          url: masterUrl,
          quality: "Multi",
          headers: HEADERS,
          subtitles
        });
      }
      return streams;
    } catch (error) {
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankAnimeMappingFetch(cloudbankMetadataFetch(fetch)), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "anizone-v2", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
