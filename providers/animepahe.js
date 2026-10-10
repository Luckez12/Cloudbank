// Imported provider: animepahe; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
 * animepahe - Built from src/animepahe/
 * Generated: 2026-09-22T10:30:55.503Z
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

// src/animepahe/index.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

// src/animepahe/constants.js
var ANIMEPAHE_DOMAINS = [
  "https://animepahe.pw",
  "https://animepahe.com",
  "https://animepahe.org"
];
var MAIN_URL = "https://animepahe.pw";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Referer": `${MAIN_URL}/`
};

// src/animepahe/utils.js
var activeDomain = MAIN_URL;
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const isAbsolute = url.startsWith("http");
    const urlsToTry = isAbsolute ? [url] : ANIMEPAHE_DOMAINS.map((d) => `${d}${url.startsWith("/") ? "" : "/"}${url}`);
    let lastError = null;
    for (const tryUrl of urlsToTry) {
      try {
        const isPaheUrl = tryUrl.includes("animepahe.");
        const mergedHeaders = __spreadValues(__spreadProps(__spreadValues({}, HEADERS), {
          "Referer": `${activeDomain}/`
        }), options.headers || {});
        let response = yield fetch(tryUrl, __spreadValues({
          headers: mergedHeaders,
          cfKiller: isPaheUrl,
          skipSizeCheck: true
        }, options));
        if ((response.status === 403 || response.status === 503) && typeof Cloudflare !== "undefined" && Cloudflare.solve) {
          try {
            const solvedHeaders = yield Cloudflare.solve(tryUrl);
            if (solvedHeaders["Cookie"])
              mergedHeaders["Cookie"] = solvedHeaders["Cookie"];
            if (solvedHeaders["User-Agent"])
              mergedHeaders["User-Agent"] = solvedHeaders["User-Agent"];
            response = yield fetch(tryUrl, __spreadValues({
              headers: mergedHeaders,
              skipSizeCheck: true
            }, options));
          } catch (_) {
          }
        }
        if (response.ok) {
          if (!isAbsolute) {
            const match = tryUrl.match(/^(https?:\/\/[^\/]+)/);
            if (match)
              activeDomain = match[1];
          }
          return yield response.text();
        }
        lastError = new Error(`HTTP ${response.status} on ${tryUrl}`);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error(`Failed to fetch: ${url}`);
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
      const res = yield fetch(url);
      const data = yield res.json();
      return data.imdb_id;
    } catch (_) {
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
    } catch (_) {
      return null;
    }
  });
}
function getMalTitle(malId) {
  return __async(this, null, function* () {
    var _a, _b;
    try {
      const res = yield fetch(`https://api.jikan.moe/v4/anime/${malId}`);
      if (!res.ok)
        return null;
      const data = yield res.json();
      return ((_a = data.data) == null ? void 0 : _a.title) || ((_b = data.data) == null ? void 0 : _b.title_english);
    } catch (_) {
      return null;
    }
  });
}
function searchAnime(query, page = 1) {
  return __async(this, null, function* () {
    const timeSuffix = Math.floor(Date.now() / 1e3) + page * 3;
    const url = `/api?m=search&q=${encodeURIComponent(query + " " + timeSuffix)}&page=${page}`;
    return yield fetchJson(url);
  });
}
function extractQuality(text) {
  const match = text.match(/(\d{3,4}p)/);
  return match ? match[1] : "720p";
}

// src/animepahe/extractors.js
function unpack(code) {
  try {
    const match = code.match(/}\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\((['"])\|\7\)/);
    if (match) {
      let [_, quote1, p, a, c, quote2, kStr] = match;
      p = p.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      a = parseInt(a, 10);
      c = parseInt(c, 10);
      const k = kStr.split("|");
      const e = (c2) => (c2 < a ? "" : e(parseInt(c2 / a, 10))) + ((c2 = c2 % a) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
      const d = {};
      while (c--)
        d[e(c)] = k[c] || e(c);
      return p.replace(/\b\w+\b/g, (w) => d[w] !== void 0 ? d[w] : w);
    }
  } catch (_) {
  }
  return code;
}
function extractKwik(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, {
        headers: __spreadProps(__spreadValues({}, HEADERS), {
          "Referer": `${MAIN_URL}/`,
          "User-Agent": USER_AGENT
        }),
        cfKiller: true,
        skipSizeCheck: true
      });
      const finalUrl = res.url || url;
      const html = yield res.text();
      const scripts = html.match(/<script.*?>([\s\S]*?)<\/script>/g) || [];
      const matches = [];
      for (const script of scripts) {
        if (script.includes("eval(function(p,a,c,k,e,d)")) {
          let pos = 0;
          while (true) {
            const start = script.indexOf("eval(function(p,a,c,k,e,d)", pos);
            if (start === -1)
              break;
            const end = script.indexOf(".split('|')", start);
            if (end === -1)
              break;
            const closeParen = script.indexOf("))", end);
            if (closeParen === -1)
              break;
            matches.push(script.substring(start, closeParen + 2));
            pos = closeParen + 2;
          }
        }
      }
      for (const scriptContent of matches) {
        const unpacked = unpack(scriptContent);
        const srcMatch = unpacked.match(/(?:const\s+)?source\s*=\s*\\?['"]([^\\'"]+)\\?['"]/);
        if (srcMatch) {
          const streamUrl = srcMatch[1];
          const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
          const title = titleMatch ? titleMatch[1].trim() : "video";
          const fileName = title.endsWith(".mp4") ? title : `${title}.mp4`;
          let mp4Url = null;
          if (streamUrl.includes("/stream/")) {
            const urlParts = streamUrl.replace("/stream/", "/mp4/").split("/");
            urlParts.pop();
            const mp4Base = urlParts.join("/");
            mp4Url = `${mp4Base}?file=${encodeURIComponent(fileName)}`;
          }
          return {
            m3u8: streamUrl,
            mp4: mp4Url,
            headers: {
              "Referer": finalUrl,
              "Origin": "https://kwik.cx",
              "User-Agent": USER_AGENT
            }
          };
        }
      }
    } catch (_) {
    }
    return null;
  });
}
function paheDecrypt(fullString, key, v1, v2) {
  const keyIndexMap = {};
  for (let i2 = 0; i2 < key.length; i2++)
    keyIndexMap[key[i2]] = i2;
  let result = "";
  let i = 0;
  const toFind = key[v2];
  while (i < fullString.length) {
    const nextIndex = fullString.indexOf(toFind, i);
    if (nextIndex === -1)
      break;
    let decodedCharStr = "";
    for (let j = i; j < nextIndex; j++) {
      decodedCharStr += keyIndexMap[fullString[j]];
    }
    i = nextIndex + 1;
    const decodedChar = String.fromCharCode(parseInt(decodedCharStr, v2) - v1);
    result += decodedChar;
  }
  return result;
}
function extractPahe(url) {
  return __async(this, null, function* () {
    try {
      const initUrl = url.endsWith("/i") ? url : `${url}/i`;
      const initRes = yield fetch(initUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": "https://pahe.win/"
        },
        cfKiller: true,
        skipSizeCheck: true
      });
      const redirectLoc = initRes.headers.get("location") || initRes.headers.get("Location");
      if (!redirectLoc)
        return null;
      let kwikUrl = redirectLoc;
      if (kwikUrl.includes("https://")) {
        kwikUrl = "https://" + kwikUrl.split("https://").pop();
      } else if (kwikUrl.includes("http://")) {
        kwikUrl = "http://" + kwikUrl.split("http://").pop();
      } else {
        kwikUrl = `https://${kwikUrl.replace(/^\/+/, "")}`;
      }
      const kwikRes = yield fetch(kwikUrl, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": "https://kwik.cx/",
          "Origin": "https://kwik.cx"
        },
        cfKiller: true,
        skipSizeCheck: true
      });
      const html = yield kwikRes.text();
      let cookie = "";
      if (typeof kwikRes.headers.getSetCookie === "function") {
        cookie = kwikRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      }
      if (!cookie) {
        const setCookieHeader = kwikRes.headers.get("set-cookie") || kwikRes.headers.get("Set-Cookie");
        if (setCookieHeader) {
          cookie = setCookieHeader.split(";")[0];
        }
      }
      const kwikParamsRegex = /\("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)/;
      const match = html.match(kwikParamsRegex);
      if (!match)
        return null;
      const [_, fullString, key, v1, v2] = match;
      const decrypted = paheDecrypt(fullString, key, parseInt(v1, 10), parseInt(v2, 10));
      const actionMatch = decrypted.match(/action="([^"]+)"/);
      const tokenMatch = decrypted.match(/value="([^"]+)"/);
      if (!actionMatch || !tokenMatch)
        return null;
      const postUri = actionMatch[1];
      const token = tokenMatch[1];
      const formData = new URLSearchParams();
      formData.append("_token", token);
      let tries = 0;
      let location = null;
      while (tries < 3) {
        tries++;
        const postRes = yield fetch(postUri, {
          method: "POST",
          redirect: "manual",
          headers: __spreadProps(__spreadValues({
            "User-Agent": USER_AGENT,
            "Referer": kwikUrl,
            "Origin": "https://kwik.cx"
          }, cookie ? { "Cookie": cookie } : {}), {
            "Content-Type": "application/x-www-form-urlencoded"
          }),
          body: formData.toString(),
          cfKiller: true,
          skipSizeCheck: true
        });
        if (postRes.status === 302 || postRes.status === 301) {
          location = postRes.headers.get("location") || postRes.headers.get("Location");
          break;
        }
      }
      if (location) {
        return {
          url: location,
          headers: {
            "Referer": "https://kwik.cx/",
            "Origin": "https://kwik.cx",
            "User-Agent": USER_AGENT
          }
        };
      }
    } catch (_) {
    }
    return null;
  });
}

// src/animepahe/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      let animeSession = null;
      let animeTitle = "";
      let mappedEp = episode;
      let targetMalId = null;
      if (mediaType === "tv") {
        const imdbId = yield getImdbId(tmdbId, mediaType);
        if (!imdbId)
          return [];
        const mapping = yield resolveMapping(imdbId, season, episode);
        if (!mapping || !mapping.mal_id)
          return [];
        targetMalId = mapping.mal_id;
        mappedEp = mapping.mal_episode || episode;
        animeTitle = yield getMalTitle(targetMalId);
        if (!animeTitle)
          return [];
        let searchResults = yield searchAnime(animeTitle);
        if (!searchResults.data || searchResults.data.length === 0) {
          const clean = animeTitle.replace(/[^a-zA-Z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
          if (clean !== animeTitle) {
            searchResults = yield searchAnime(clean);
          }
        }
        if (!searchResults.data || searchResults.data.length === 0) {
          const words = animeTitle.split(/\s+/).filter(Boolean);
          if (words.length > 3) {
            const shortQuery = words.slice(-3).join(" ");
            searchResults = yield searchAnime(shortQuery);
          }
        }
        if (searchResults.data && searchResults.data.length > 0) {
          for (let i = 0; i < Math.min(searchResults.data.length, 5); i++) {
            const item = searchResults.data[i];
            try {
              const pageHtml = yield fetchText(`/anime/${item.session}`);
              if (pageHtml.includes(`myanimelist.net/anime/${targetMalId}`) || item.id && String(item.id) === String(targetMalId)) {
                animeSession = item.session;
                break;
              }
            } catch (_) {
            }
          }
          if (!animeSession) {
            const normTarget = animeTitle.toLowerCase().replace(/[^a-z0-9]+/g, "");
            const titleMatch = searchResults.data.find((r) => {
              const normR = (r.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
              return normR.includes(normTarget) || normTarget.includes(normR);
            });
            animeSession = titleMatch ? titleMatch.session : searchResults.data[0].session;
          }
        }
      } else {
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=439c478a771f35c05022f9feabcca01c`;
        const tmdbRes = yield fetch(tmdbUrl);
        const tmdbData = yield tmdbRes.json();
        animeTitle = tmdbData.title || tmdbData.original_title;
        mappedEp = 1;
        if (!animeTitle)
          return [];
        let searchResults = yield searchAnime(animeTitle);
        if (!searchResults.data || searchResults.data.length === 0) {
          const clean = animeTitle.replace(/[^a-zA-Z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
          if (clean !== animeTitle) {
            searchResults = yield searchAnime(clean);
          }
        }
        if (searchResults.data && searchResults.data.length > 0) {
          const normTarget = animeTitle.toLowerCase().replace(/[^a-z0-9]+/g, "");
          const match = searchResults.data.find((r) => {
            const normR = (r.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
            return normR === normTarget || normR.includes(normTarget) || normTarget.includes(normR);
          }) || searchResults.data[0];
          animeSession = match.session;
        }
      }
      if (!animeSession)
        return [];
      const firstPageUrl = `/api?m=release&id=${animeSession}&sort=episode_asc&page=1`;
      const firstPageData = yield fetchJson(firstPageUrl);
      if (!firstPageData.data || firstPageData.data.length === 0)
        return [];
      const targetEpNum = Number(mappedEp);
      let episodeSession = null;
      const epInFirstPage = firstPageData.data.find((e) => Math.floor(Number(e.episode)) === targetEpNum || Number(e.episode) === targetEpNum);
      if (epInFirstPage) {
        episodeSession = epInFirstPage.session;
      } else {
        const perPage = firstPageData.per_page || 30;
        const targetPage = Math.ceil(targetEpNum / perPage) || 1;
        const lastPage = firstPageData.last_page || 1;
        if (targetPage !== 1 && targetPage <= lastPage) {
          const targetPageUrl = `/api?m=release&id=${animeSession}&sort=episode_asc&page=${targetPage}`;
          const targetPageData = yield fetchJson(targetPageUrl);
          if (targetPageData && targetPageData.data) {
            const foundEp = targetPageData.data.find((e) => Math.floor(Number(e.episode)) === targetEpNum || Number(e.episode) === targetEpNum);
            if (foundEp)
              episodeSession = foundEp.session;
          }
        }
        if (!episodeSession) {
          for (let p = 2; p <= Math.min(lastPage, 6); p++) {
            if (p === targetPage)
              continue;
            const pData = yield fetchJson(`/api?m=release&id=${animeSession}&sort=episode_asc&page=${p}`);
            if (pData && pData.data) {
              const foundEp = pData.data.find((e) => Math.floor(Number(e.episode)) === targetEpNum || Number(e.episode) === targetEpNum);
              if (foundEp) {
                episodeSession = foundEp.session;
                break;
              }
            }
          }
        }
      }
      if (!episodeSession)
        return [];
      const playUrl = `/play/${animeSession}/${episodeSession}`;
      const playHtml = yield fetchText(playUrl);
      const $ = import_cheerio_without_node_native.default.load(playHtml);
      const streams = [];
      const promises = [];
      const seen = /* @__PURE__ */ new Set();
      const downloadLinks = $("div#pickDownload > a");
      const buttons = $("#resolutionMenu > button");
      buttons.each((index, el) => {
        const $btn = $(el);
        const kwikUrl = $btn.attr("data-src");
        const fullText = $btn.text().trim();
        const qualityText = fullText.includes(" \xB7 ") ? fullText.substring(fullText.indexOf(" \xB7 ") + 3) : fullText;
        const isDub = qualityText.toLowerCase().includes("eng");
        const isKor = qualityText.toLowerCase().includes("kor");
        const isChi = qualityText.toLowerCase().includes("chi");
        const langLabel = isDub ? "DUB" : isKor ? "KOR" : isChi ? "CHI" : "SUB";
        const cleanQualityText = qualityText.replace(/eng/gi, "").replace(/kor/gi, "").replace(/chi/gi, "").replace(/\s+/g, " ").trim();
        const quality = extractQuality(cleanQualityText);
        const paheWinLink = downloadLinks.eq(index).attr("href");
        if (kwikUrl && kwikUrl.includes("kwik")) {
          promises.push(
            extractKwik(kwikUrl).then((res) => {
              if (res && res.m3u8 && !seen.has(res.m3u8)) {
                seen.add(res.m3u8);
                streams.push({
                  name: `AnimePahe [${langLabel}] (${quality} HLS)`,
                  title: mediaType === "movie" ? `${animeTitle} (${langLabel})` : `${animeTitle} - Episode ${mappedEp} (${langLabel})`,
                  url: res.m3u8,
                  quality,
                  headers: res.headers,
                  provider: "animepahe",
                  type: "m3u8"
                });
              }
              if (res && res.mp4 && !seen.has(res.mp4)) {
                seen.add(res.mp4);
                streams.push({
                  name: `AnimePahe [${langLabel}] (${quality} MP4)`,
                  title: mediaType === "movie" ? `${animeTitle} (${langLabel})` : `${animeTitle} - Episode ${mappedEp} (${langLabel})`,
                  url: res.mp4,
                  quality,
                  headers: __spreadProps(__spreadValues({}, res.headers), {
                    "Referer": kwikUrl
                  }),
                  provider: "animepahe",
                  type: "mp4"
                });
              }
            }).catch(() => {
            })
          );
        }
        if (paheWinLink && (paheWinLink.includes("pahe.win") || paheWinLink.includes("pahe.me") || paheWinLink.includes("pahe.li") || paheWinLink.includes("kwik"))) {
          promises.push(
            extractPahe(paheWinLink).then((res) => {
              if (res && res.url && !seen.has(res.url)) {
                seen.add(res.url);
                streams.push({
                  name: `AnimePahe [${langLabel}] (${quality} Direct)`,
                  title: mediaType === "movie" ? `${animeTitle} (${langLabel})` : `${animeTitle} - Episode ${mappedEp} (${langLabel})`,
                  url: res.url,
                  quality,
                  headers: res.headers,
                  provider: "animepahe",
                  type: "mp4"
                });
              }
            }).catch(() => {
            })
          );
        }
      });
      yield Promise.all(promises);
      const qualityOrder = { "1080p": 3, "720p": 2, "360p": 1 };
      return streams.sort((a, b) => (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0));
    } catch (_) {
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankAnimeMappingFetch(cloudbankMetadataFetch(fetch)), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "animepahe", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
