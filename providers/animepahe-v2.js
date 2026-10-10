// Imported provider: animepahe-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
 * Generated: 2026-06-01T14:20:20.667Z
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
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
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

// src/animepahe/index.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

// src/animepahe/constants.js
var MAIN_URL = "https://animepahe.com";
var PROXY_URL = "https://animepaheproxy.phisheranimepahe.workers.dev/?url=";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Cookie": "__ddg2_=1234567890",
  "Referer": "https://animepahe.com/"
};

// src/animepahe/utils.js
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const _a = options, { useProxy = true } = _a, fetchOptions = __objRest(_a, ["useProxy"]);
    const finalUrl = url.startsWith("http") ? url : `${MAIN_URL}${url}`;
    const targetUrl = useProxy ? `${PROXY_URL}${encodeURIComponent(finalUrl)}` : finalUrl;
    const response = yield fetch(targetUrl, __spreadValues({
      headers: HEADERS
    }, fetchOptions));
    if (!response.ok)
      throw new Error(`HTTP ${response.status} on ${finalUrl}`);
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
      const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}/external_ids?api_key=1865f43a0549ca50d341dd9ab8b29f49`;
      const res = yield fetch(url);
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
function searchAnime(query) {
  return __async(this, null, function* () {
    const url = `/api?m=search&l=8&q=${encodeURIComponent(query)}`;
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
      a = parseInt(a);
      c = parseInt(c);
      const k = kStr.split("|");
      const e = (c2) => (c2 < a ? "" : e(parseInt(c2 / a))) + ((c2 = c2 % a) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
      const d = {};
      while (c--)
        d[e(c)] = k[c] || e(c);
      return p.replace(/\b\w+\b/g, (w) => d[w]);
    }
  } catch (e) {
    console.error("[AnimePahe] Unpack error:", e.message);
  }
  return code;
}
function extractKwik(url) {
  return __async(this, null, function* () {
    try {
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const baseUrl = settings.domain || "https://animepahe.com";
      const html = yield fetchText(url, {
        headers: __spreadProps(__spreadValues({}, HEADERS), {
          "Referer": `${baseUrl}/`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }),
        useProxy: false
      });
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
        const m3u8Match = unpacked.match(/source\s*=\s*'([^']+m3u8[^']*)'/) || unpacked.match(/source\s*=\s*"([^"]+m3u8[^"]*)"/);
        if (m3u8Match) {
          const m3u8Url = m3u8Match[1];
          const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
          const title = titleMatch ? titleMatch[1].trim() : "video";
          const fileName = title.endsWith(".mp4") ? title : title + ".mp4";
          const urlParts = m3u8Url.replace("/stream/", "/mp4/").split("/");
          urlParts.pop();
          const mp4Base = urlParts.join("/");
          const mp4Url = `${mp4Base}?file=${encodeURIComponent(fileName)}`;
          return {
            m3u8: m3u8Url,
            mp4: mp4Url,
            headers: {
              "Referer": "https://kwik.cx/",
              "Origin": "https://kwik.cx",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
          };
        }
      }
    } catch (e) {
      console.error("[AnimePahe] Kwik extraction failed:", e.message);
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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://pahe.win/"
        }
      });
      const redirectLoc = initRes.headers.get("location") || initRes.headers.get("Location");
      if (!redirectLoc)
        return null;
      const kwikUrl = redirectLoc.startsWith("http") ? redirectLoc : `https://${redirectLoc.replace(/^\/+/, "")}`;
      const kwikRes = yield fetch(kwikUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://kwik.cx/"
        }
      });
      const html = yield kwikRes.text();
      const setCookieHeader = kwikRes.headers.get("set-cookie") || kwikRes.headers.get("Set-Cookie");
      let cookie = "";
      if (setCookieHeader) {
        cookie = setCookieHeader.split(";")[0];
      }
      const kwikParamsRegex = /\("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)/;
      const match = html.match(kwikParamsRegex);
      if (!match)
        return null;
      const [_, fullString, key, v1, v2] = match;
      const decrypted = paheDecrypt(fullString, key, parseInt(v1), parseInt(v2));
      const actionMatch = decrypted.match(/action="([^"]+)"/);
      const tokenMatch = decrypted.match(/value="([^"]+)"/);
      if (!actionMatch || !tokenMatch)
        return null;
      const postUri = actionMatch[1];
      const token = tokenMatch[1];
      const formData = new URLSearchParams();
      formData.append("_token", token);
      let tries = 0;
      let postRes = null;
      let location = null;
      while (tries < 20) {
        postRes = yield fetch(postUri, {
          method: "POST",
          redirect: "manual",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": kwikUrl,
            "Cookie": cookie,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: formData.toString()
        });
        if (postRes.status === 302 || postRes.status === 301) {
          location = postRes.headers.get("location") || postRes.headers.get("Location");
          break;
        }
        tries++;
      }
      if (location) {
        return {
          url: location,
          headers: {
            "Referer": "https://kwik.cx/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        };
      }
    } catch (e) {
      console.error("[AnimePahe] Pahe extractor failed:", e.message);
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
        const searchResults = yield searchAnime(animeTitle);
        if (searchResults.data && searchResults.data.length > 0) {
          for (let i = 0; i < Math.min(searchResults.data.length, 3); i++) {
            const item = searchResults.data[i];
            const pageHtml = yield fetchText(`/anime/${item.session}`);
            if (pageHtml.includes(`myanimelist.net/anime/${targetMalId}`)) {
              animeSession = item.session;
              break;
            }
          }
        }
      } else {
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=1865f43a0549ca50d341dd9ab8b29f49`;
        const tmdbRes = yield fetch(tmdbUrl);
        const tmdbData = yield tmdbRes.json();
        animeTitle = tmdbData.title || tmdbData.original_title;
        mappedEp = 1;
        if (!animeTitle)
          return [];
        const searchResults = yield searchAnime(animeTitle);
        if (searchResults.data && searchResults.data.length > 0) {
          const firstResult = searchResults.data[0];
          if (firstResult.title.toLowerCase() === animeTitle.toLowerCase()) {
            animeSession = firstResult.session;
          }
        }
      }
      if (!animeSession)
        return [];
      const firstPageUrl = `/api?m=release&id=${animeSession}&sort=episode_asc&page=1`;
      const firstPageData = yield fetchJson(firstPageUrl);
      if (!firstPageData.data || firstPageData.data.length === 0)
        return [];
      const paheEpStart = Math.floor(firstPageData.data[0].episode);
      const perPage = firstPageData.per_page || 30;
      const targetPaheEp = paheEpStart - 1 + mappedEp;
      const targetPage = Math.ceil(mappedEp / perPage) || 1;
      const targetPageUrl = `/api?m=release&id=${animeSession}&sort=episode_asc&page=${targetPage}`;
      const targetPageData = yield fetchJson(targetPageUrl);
      let episodeSession = null;
      if (targetPageData && targetPageData.data) {
        const foundEp = targetPageData.data.find((e) => Math.floor(e.episode) == targetPaheEp);
        if (foundEp)
          episodeSession = foundEp.session;
      }
      if (!episodeSession && targetPage !== 1) {
        const fallbackEp = firstPageData.data.find((e) => Math.floor(e.episode) == targetPaheEp);
        if (fallbackEp)
          episodeSession = fallbackEp.session;
      }
      if (!episodeSession)
        return [];
      const playUrl = `/play/${animeSession}/${episodeSession}`;
      const playHtml = yield fetchText(playUrl);
      const $ = import_cheerio_without_node_native.default.load(playHtml);
      const streams = [];
      const promises = [];
      $("#resolutionMenu button").each((i, el) => {
        const $btn = $(el);
        const kwikUrl = $btn.attr("data-src");
        const btnText = $btn.text();
        const quality = extractQuality(btnText);
        const type = btnText.toLowerCase().includes("eng") ? "Dub" : "Sub";
        if (kwikUrl && kwikUrl.includes("kwik")) {
          promises.push(
            extractKwik(kwikUrl).then((res) => {
              if (res) {
                if (res.m3u8) {
                  streams.push({
                    name: `AnimePahe [HLS] (${quality} ${type})`,
                    title: `${animeTitle} - Episode ${mappedEp}`,
                    url: res.m3u8,
                    quality,
                    headers: res.headers
                  });
                }
                if (res.mp4) {
                  streams.push({
                    name: `AnimePahe [MP4] (${quality} ${type})`,
                    title: `${animeTitle} - Episode ${mappedEp}`,
                    url: res.mp4,
                    quality,
                    headers: __spreadProps(__spreadValues({}, res.headers), {
                      "Referer": kwikUrl
                    })
                  });
                }
              }
            }).catch(() => {
            })
          );
        }
      });
      $("div#pickDownload a").each((i, el) => {
        const $link = $(el);
        const paheUrl = $link.attr("href");
        const linkText = $link.text();
        const quality = extractQuality(linkText);
        const type = $link.find("span").text().toLowerCase().includes("eng") ? "Dub" : "Sub";
        if (paheUrl && (paheUrl.includes("pahe.win") || paheUrl.includes("pahe.me") || paheUrl.includes("pahe.li") || paheUrl.includes("kwik"))) {
          promises.push(
            extractPahe(paheUrl).then((res) => {
              if (res && res.url) {
                streams.push({
                  name: `AnimePahe [Direct] (${quality} ${type})`,
                  title: `${animeTitle} - Episode ${mappedEp}`,
                  url: res.url,
                  quality,
                  headers: res.headers
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
    } catch (error) {
      return [];
    }
  });
}
function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "Domain Selection" },
      {
        type: "select",
        key: "domain",
        label: "Preferred Domain",
        description: "AnimePahe frequently rotates domains. Choose the one currently working for you.",
        options: [
          { label: "animepahe.com", value: "https://animepahe.com" },
          { label: "animepahe.org", value: "https://animepahe.org" },
          { label: "animepahe.pw", value: "https://animepahe.pw" }
        ],
        defaultValue: "https://animepahe.com"
      }
    ];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, onSettings };
} else {
  global.getStreams = getStreams;
  global.onSettings = onSettings;
}

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "animepahe-v2", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
