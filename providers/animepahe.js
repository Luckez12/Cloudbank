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
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "animepahe", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "AnimePahe", "animepahe");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
