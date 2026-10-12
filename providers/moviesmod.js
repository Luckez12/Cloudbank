// Imported provider: moviesmod; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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


/* CLOUDBANK_MOVIESMOD_SIBLING_COMPAT_V1 */
function cloudbankMoviesModFollowingHref($, entry, label) {
  // VUEO's HTML bridge supports next(), but does not expose Cheerio nextAll().
  var sibling = $(entry).next();
  for (var count = 0; sibling.length && count < 128; count++) {
    var href = sibling.find("a:contains('" + label + "')").first().attr("href");
    if (href) return href;
    sibling = sibling.next();
  }
  return "";
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
 * moviesmod - Built from src/moviesmod/
 * Generated: 2026-09-22T08:14:06.813Z
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

// src/moviesmod/index.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));

// src/moviesmod/constants.js
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var FALLBACK_DOMAIN = "https://moviesmod.army";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

// src/moviesmod/utils.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
var cachedDomain = "";
function getMainUrl() {
  return __async(this, null, function* () {
    if (cachedDomain)
      return cachedDomain;
    try {
      const response = yield fetch(DOMAINS_URL);
      const data = yield response.json();
      cachedDomain = data.moviesmod || FALLBACK_DOMAIN;
      return cachedDomain;
    } catch (e) {
      return FALLBACK_DOMAIN;
    }
  });
}
function getBaseUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch (e) {
    return "";
  }
}
function fixUrl(url, domain) {
  if (!url)
    return "";
  if (url.startsWith("http"))
    return url;
  if (url.startsWith("//"))
    return `https:${url}`;
  if (url.startsWith("/"))
    return domain + url;
  return `${domain}/${url}`;
}
function bypassHrefli(url) {
  return __async(this, null, function* () {
    const host = getBaseUrl(url);
    try {
      const res1 = yield fetch(url, { headers: HEADERS });
      const html1 = yield res1.text();
      const $1 = import_cheerio_without_node_native.default.load(html1);
      const formUrl1 = $1("form#landing").attr("action");
      const formData1 = {};
      $1("form#landing input").each((_, el) => {
        formData1[$1(el).attr("name")] = $1(el).attr("value") || "";
      });
      const res2 = yield fetch(formUrl1, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), { "Content-Type": "application/x-www-form-urlencoded" }),
        body: new URLSearchParams(formData1).toString()
      });
      const html2 = yield res2.text();
      const $2 = import_cheerio_without_node_native.default.load(html2);
      const formUrl2 = $2("form#landing").attr("action");
      const formData2 = {};
      $2("form#landing input").each((_, el) => {
        formData2[$2(el).attr("name")] = $2(el).attr("value") || "";
      });
      const res3 = yield fetch(formUrl2, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), { "Content-Type": "application/x-www-form-urlencoded" }),
        body: new URLSearchParams(formData2).toString()
      });
      const html3 = yield res3.text();
      const $3 = import_cheerio_without_node_native.default.load(html3);
      const script = $3("script:contains(?go=)").html() || "";
      const skTokenMatch = script.match(/\?go=([^"]+)/);
      if (!skTokenMatch)
        return null;
      const skToken = skTokenMatch[1];
      const wpHttp2 = formData2["_wp_http2"] || "";
      const res4 = yield fetch(`${host}?go=${skToken}`, {
        headers: __spreadProps(__spreadValues({}, HEADERS), { "Cookie": `${skToken}=${wpHttp2}` })
      });
      const html4 = yield res4.text();
      const $4 = import_cheerio_without_node_native.default.load(html4);
      const metaRefresh = $4('meta[http-equiv="refresh"]').attr("content") || "";
      const driveUrlMatch = metaRefresh.match(/url=(.+)/);
      if (!driveUrlMatch)
        return null;
      const driveUrl = driveUrlMatch[1];
      const res5 = yield fetch(driveUrl, { headers: HEADERS });
      const html5 = yield res5.text();
      const pathMatch = html5.match(/replace\("([^"]+)"\)/);
      if (!pathMatch || pathMatch[1] === "/404")
        return null;
      return fixUrl(pathMatch[1], getBaseUrl(driveUrl));
    } catch (e) {
      return null;
    }
  });
}
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        imdbId: (_a = data.external_ids) == null ? void 0 : _a.imdb_id
      };
    } catch (e) {
      return null;
    }
  });
}
function getIndexQuality(str) {
  if (!str)
    return "Unknown";
  const match = str.match(/(\d{3,4})[pP]/);
  if (match)
    return match[1] + "p";
  if (str.toUpperCase().includes("4K") || str.toUpperCase().includes("UHD"))
    return "2160p";
  return "Unknown";
}
function extractVideoSeed(finallink) {
  return __async(this, null, function* () {
    try {
      const urlObj = new URL(finallink);
      const host = finallink.includes("video-leech") ? "video-leech.xyz" : urlObj.host || "video-seed.xyz";
      const token = finallink.includes("?url=") ? finallink.split("?url=")[1] : finallink;
      if (!token)
        return null;
      const res = yield fetch(`https://${host}/api`, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-token": host,
          "Referer": finallink,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        }),
        body: `keys=${encodeURIComponent(token)}`
      });
      const data = yield res.json();
      if (data && data.url) {
        return data.url.replace(/\\\//g, "/");
      }
      return null;
    } catch (e) {
      return null;
    }
  });
}
function instantLink(url) {
  return __async(this, null, function* () {
    try {
      if (url.includes("cdn.video-gen.xyz")) {
        const res = yield fetch(url, { headers: HEADERS, redirect: "follow" });
        if (res.url && res.url.includes("url=")) {
          const redirected = res.url.split("url=")[1];
          if (redirected && !redirected.includes("?url="))
            return redirected;
          return yield extractVideoSeed(redirected);
        }
      }
      if (url.includes("?url=")) {
        return yield extractVideoSeed(url);
      }
      return url;
    } catch (e) {
      return null;
    }
  });
}
function resumeBot(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: HEADERS });
      const html = yield res.text();
      const setCookie = res.headers.get("set-cookie") || "";
      const ssidMatch = setCookie.match(/PHPSESSID=([^;]+)/);
      const ssid = ssidMatch ? ssidMatch[1] : "";
      const tokenMatch = html.match(/formData\.append\('token',\s*'([a-f0-9]+)'\)/);
      const pathMatch = html.match(/fetch\('\/download\?id=([a-zA-Z0-9/+]+)'/);
      if (!tokenMatch || !pathMatch)
        return null;
      const baseUrl = url.substring(0, url.indexOf("/download"));
      const downloadUrl = `${baseUrl}/download?id=${pathMatch[1]}`;
      const postRes = yield fetch(downloadUrl, {
        method: "POST",
        headers: __spreadValues(__spreadProps(__spreadValues({}, HEADERS), {
          "Accept": "*/*",
          "Origin": baseUrl,
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded"
        }), ssid ? { "Cookie": `PHPSESSID=${ssid}` } : {}),
        body: `token=${encodeURIComponent(tokenMatch[1])}`
      });
      const data = yield postRes.json();
      return data && data.url && data.url.startsWith("http") ? data.url : null;
    } catch (e) {
      return null;
    }
  });
}
function CFType1(url) {
  return __async(this, null, function* () {
    try {
      const wfileUrl = url.replace("/file", "/wfile") + "?type=1";
      const res = yield fetch(wfileUrl, { headers: HEADERS });
      const html = yield res.text();
      const $ = import_cheerio_without_node_native.default.load(html);
      const links = [];
      $("a.btn-success").each((_, el) => {
        const h = $(el).attr("href");
        if (h && h.startsWith("http"))
          links.push(h);
      });
      return links;
    } catch (e) {
      return [];
    }
  });
}
function resumeCloudLink(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: HEADERS });
      const html = yield res.text();
      const keyMatch = html.match(/formData\.append\(\s*['"]key['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
      if (keyMatch) {
        const host = new URL(url).host;
        const postRes = yield fetch(url, {
          method: "POST",
          headers: __spreadProps(__spreadValues({}, HEADERS), {
            "Content-Type": "application/x-www-form-urlencoded",
            "x-token": host,
            "X-Requested-With": "XMLHttpRequest"
          }),
          body: `action=cloud&key=${encodeURIComponent(keyMatch[1])}&action_token=`
        });
        const data = yield postRes.json();
        if (data && data.url) {
          return data.url.replace(/\\\//g, "/");
        }
      }
      const $ = import_cheerio_without_node_native.default.load(html);
      return $("a.btn-success").first().attr("href") || null;
    } catch (e) {
      return null;
    }
  });
}
function extractDriveseedPage(url) {
  return __async(this, null, function* () {
    const streams = [];
    try {
      let pageUrl = url;
      if (url.includes("r?key=")) {
        const res2 = yield fetch(url, { headers: HEADERS });
        const html2 = yield res2.text();
        const redirectMatch = html2.match(/replace\("([^"]+)"\)/);
        if (redirectMatch) {
          pageUrl = getBaseUrl(url) + redirectMatch[1];
        }
      }
      const res = yield fetch(pageUrl, { headers: HEADERS });
      const html = yield res.text();
      const $ = import_cheerio_without_node_native.default.load(html);
      const baseDomain = getBaseUrl(pageUrl);
      const nameText = $("li.list-group-item:contains(Name)").first().text() || "";
      const sizeText = $("li.list-group-item:contains(Size)").first().text() || $("li:nth-child(3)").text() || "";
      const size = sizeText.replace(/.*Size\s*:\s*/i, "").trim();
      const quality = getIndexQuality(nameText || $("li.list-group-item").first().text() || "");
      const instantHref = $("a.btn-danger").attr("href");
      if (instantHref) {
        const finalInstant = yield instantLink(instantHref);
        if (finalInstant) {
          streams.push({ name: "Driveseed Instant", url: finalInstant, quality, size });
        }
      }
      const resumeBotHref = $("a.btn.btn-light").attr("href");
      if (resumeBotHref) {
        const finalBot = yield resumeBot(resumeBotHref);
        if (finalBot) {
          streams.push({ name: "Driveseed ResumeBot", url: finalBot, quality, size });
        }
      }
      const cfLinks = yield CFType1(pageUrl);
      for (const cfLink of cfLinks) {
        streams.push({ name: "Driveseed CF Type1", url: cfLink, quality, size });
      }
      const resumeCloudHref = $("a.btn-warning").attr("href");
      if (resumeCloudHref) {
        const fullCloudUrl = resumeCloudHref.startsWith("http") ? resumeCloudHref : `${baseDomain}${resumeCloudHref}`;
        const finalCloud = yield resumeCloudLink(fullCloudUrl);
        if (finalCloud) {
          streams.push({ name: "Driveseed ResumeCloud", url: finalCloud, quality, size });
        }
      }
    } catch (e) {
    }
    return streams;
  });
}

// src/moviesmod/index.js
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MoviesMod] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details)
      return [];
    const mainUrl = yield getMainUrl();
    console.log(`[MoviesMod] Main URL: ${mainUrl}`);
    const query = details.imdbId ? details.imdbId : details.title;
    const searchUrl = mediaType === "movie" ? `${mainUrl.replace(/\/$/, "")}/search/${encodeURIComponent(query)}` : `${mainUrl.replace(/\/$/, "")}/search/${encodeURIComponent(query)} ${seasonNum}`;
    try {
      console.log(`[MoviesMod] Searching at: ${searchUrl}`);
      const searchRes = yield fetch(searchUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }), cfKiller: true });
      const searchHtml = yield searchRes.text();
      const $search = import_cheerio_without_node_native2.default.load(searchHtml);
      let targetUrl = $search("#content_box article > a").first().attr("href") || $search("#content_box article a").first().attr("href");
      if (!targetUrl && details.imdbId && details.title) {
        const fallbackQuery = mediaType === "movie" ? `${mainUrl.replace(/\/$/, "")}/search/${encodeURIComponent(details.title)}` : `${mainUrl.replace(/\/$/, "")}/search/${encodeURIComponent(details.title)} ${seasonNum}`;
        const fallbackRes = yield fetch(fallbackQuery, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }), cfKiller: true });
        const fallbackHtml = yield fallbackRes.text();
        const $fallback = import_cheerio_without_node_native2.default.load(fallbackHtml);
        targetUrl = $fallback("#content_box article > a").first().attr("href") || $fallback("#content_box article a").first().attr("href");
      }
      if (!targetUrl) {
        console.log("[MoviesMod] No search result found");
        return [];
      }
      const pageRes = yield fetch(targetUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }), cfKiller: true });
      const pageHtml = yield pageRes.text();
      const $ = import_cheerio_without_node_native2.default.load(pageHtml);
      const allStreams = [];
      const contentBox = $(".thecontent");
      const hTag = mediaType === "movie" ? "h4" : "h3";
      const aTag = mediaType === "movie" ? "Download" : "Episode";
      const sTag = mediaType === "movie" ? "" : `(S0${seasonNum}|Season ${seasonNum})`;
      const qualityRegex = new RegExp(`${sTag}.*(480p|720p|1080p|2160p)`, "i");
      const entries = contentBox.find(hTag).filter((i, el) => {
        const text = $(el).text();
        return qualityRegex.test(text) && !text.includes("MoviesMod");
      });
      for (const entry of entries.get()) {
        const quality = getIndexQuality($(entry).text());
        let nextHref = cloudbankMoviesModFollowingHref($, entry, aTag);
        if (nextHref && nextHref.includes("=")) {
          nextHref = nextHref.substring(nextHref.indexOf("=") + 1);
        }
        if (nextHref) {
          const streams = yield processModLink(nextHref, targetUrl, quality, mediaType, episodeNum);
          allStreams.push(...streams);
        }
      }
      return allStreams;
    } catch (e) {
      console.error("[MoviesMod] Error:", e.message);
      return [];
    }
  });
}
function processModLink(url, referer, quality, mediaType, episodeNum) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
      const html = yield res.text();
      const $ = import_cheerio_without_node_native2.default.load(html);
      const selector = mediaType === "movie" ? "p a.maxbutton, a:contains('Download')" : `h3 a:contains('Episode ${episodeNum}'), a:contains('Episode ${episodeNum}'), a.maxbutton`;
      let source = $(selector).first().attr("href");
      if (!source) {
        source = $('a[href*="driveseed.org"], a[href*="tech.unblockedgames.world"], a[href*="video-seed"]').first().attr("href");
      }
      if (!source)
        return [];
      let finalLink = source;
      if (source.includes("unblockedgames") || source.includes("tech.") || source.includes("href.li")) {
        finalLink = yield bypassHrefli(source);
      }
      const results = [];
      if (finalLink && finalLink.includes("driveseed")) {
        const streams = yield extractDriveseedPage(finalLink);
        results.push(...streams.map((s) => __spreadProps(__spreadValues({}, s), {
          name: `MoviesMod [${s.name}]`,
          title: `MoviesMod - ${s.quality} ${s.size ? `[${s.size}]` : ""}`,
          quality: s.quality || quality,
          provider: "moviesmod"
        })));
      } else if (finalLink && (finalLink.includes("video-seed") || finalLink.includes("video-leech"))) {
        const streamUrl = yield extractVideoSeed(finalLink);
        if (streamUrl) {
          results.push({
            name: "MoviesMod [VideoSeed]",
            title: `MoviesMod - ${quality}`,
            url: streamUrl,
            quality,
            provider: "moviesmod"
          });
        }
      }
      return results;
    } catch (e) {
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "moviesmod", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();

/* CLOUDBANK_VERSION_MERGE_ADAPTER_START */
function cloudbankVersionMerge(engines, providerId) {
  var primary = engines[0].provider;
  var merged = Object.assign({}, primary);
  function platform(args) {
    var options = args[4];
    var hint = options && options.platform || (typeof globalThis !== 'undefined' && (globalThis.VUEO_PLATFORM || globalThis.PLATFORM || globalThis.platform));
    if (!hint && typeof navigator !== 'undefined') hint = navigator.userAgent;
    hint = String(hint || '').toLowerCase();
    if (/ios|iphone|ipad/.test(hint)) return 'ios';
    if (/android/.test(hint)) return 'android';
    return hint;
  }
  function available(engine, args) {
    if (!engine.enabled) return false;
    if (!engine.disabledPlatforms.length) return true;
    var current = platform(args);
    // Preserve source platform restrictions when the host cannot identify its platform.
    return !!current && engine.disabledPlatforms.indexOf(current) < 0;
  }
  function key(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(key).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + key(value[k]); }).join(',') + '}';
  }
  function combine(results) {
    var seen = Object.create(null), out = [];
    results.forEach(function(rows) {
      if (!Array.isArray(rows)) return;
      rows.forEach(function(stream) {
        if (!stream || typeof stream.url !== 'string' || !/^(https?:\/\/|magnet:)/i.test(stream.url)) return;
        var identity;
        try { identity = key([stream.url, stream.name || '', stream.headers || {}, stream.subtitles || [], stream.audio || stream.language || '', stream.quality || '']); }
        catch (_) { identity = String(stream.url) + '/' + String(stream.name || ''); }
        if (seen[identity]) return;
        seen[identity] = true;
        out.push(Object.assign({}, stream, { provider: providerId }));
      });
    });
    return out;
  }
  merged.getStreams = function(id, type, season, episode) {
    var args = Array.prototype.slice.call(arguments);
    type = type === 'series' ? 'tv' : type;
    if (!String(id || '').trim() || (type !== 'movie' && type !== 'tv')) return Promise.resolve([]);
    if (type === 'tv' && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    args[0] = String(id); args[1] = type;
    if (type === 'tv') { args[2] = Number(season); args[3] = Number(episode); }
    var deadline = Date.now() + 18500;
    var active = engines.filter(function(engine) { return available(engine, args); });
    var results = active.map(function() { return []; });
    return new Promise(function(resolve) {
      var done = false, primaryDone = false, alternateStarted = false, alternateDone = false;
      var timers = [];
      function finish() {
        if (done) return; done = true;
        timers.forEach(clearTimeout);
        resolve(combine(results));
      }
      function attempt(index, ms, next) {
        if (done || Date.now() >= deadline) { next(); return; }
        var settled = false;
        var timer = setTimeout(function() { settle([]); }, Math.min(ms, deadline - Date.now())); timers.push(timer);
        function settle(rows) {
          if (settled || done) return; settled = true; clearTimeout(timer);
          results[index] = Array.isArray(rows) ? rows : [];
          next();
        }
        Promise.resolve().then(function() { return active[index].provider.getStreams.apply(active[index].provider, args); }).then(settle, function() { settle([]); });
      }
      function alternate(index) {
        if (done) return;
        if (index >= active.length) { alternateDone = true; if (primaryDone) finish(); return; }
        attempt(index, 6000, function() {
          if (combine([results[index]]).length) { alternateDone = true; if (primaryDone) finish(); }
          else alternate(index + 1);
        });
      }
      function startAlternate() {
        if (alternateStarted || done) return; alternateStarted = true; alternate(1);
      }
      if (!active.length) { finish(); return; }
      timers.push(setTimeout(finish, 18500));
      // A fast successful primary starts no duplicate engine. A slow or failed one unlocks the fallback.
      timers.push(setTimeout(startAlternate, 5000));
      attempt(0, 18500, function() {
        primaryDone = true;
        if (combine([results[0]]).length) { finish(); return; }
        startAlternate();
        if (alternateDone) finish();
      });
    });
  };
  // Preserve primary settings and add missing alternate controls/options under the same provider ID.
  if (engines.some(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; })) {
    merged.onSettings = function() {
      var args = arguments;
      return Promise.all(engines.filter(function(engine) { return engine.enabled && typeof engine.provider.onSettings === 'function'; }).map(function(engine) {
        return new Promise(function(resolve) {
          var timer = setTimeout(function() { resolve([]); }, 1500);
          Promise.resolve().then(function() { return engine.provider.onSettings.apply(engine.provider, args); }).then(function(value) { clearTimeout(timer); resolve(value); }, function() { clearTimeout(timer); resolve([]); });
        });
      })).then(function(values) {
        if (values.length && !Array.isArray(values[0])) return values[0];
        var out = [], keys = Object.create(null), headers = Object.create(null);
        values.forEach(function(rows) {
          if (!Array.isArray(rows)) return;
          rows.forEach(function(setting) {
            if (!setting || typeof setting !== 'object') return;
            if (!setting.key) {
              var identity = key(setting); if (!headers[identity]) { headers[identity] = true; out.push(setting); } return;
            }
            var existing = keys[setting.key];
            if (!existing) { existing = Object.assign({}, setting); if (Array.isArray(setting.options)) existing.options = setting.options.slice(); keys[setting.key] = existing; out.push(existing); return; }
            if (existing.type === setting.type && Array.isArray(existing.options) && Array.isArray(setting.options)) {
              setting.options.forEach(function(option) { if (!existing.options.some(function(current) { return current.value === option.value; })) existing.options.push(option); });
            }
          });
        });
        return out;
      });
    };
  }
  return merged;
}
function cloudbankMergedBudgetFetch(nativeFetch, deadline) {
  function bounded(run) {
    var remaining = Math.min(2200, deadline - Date.now());
    if (remaining <= 0) return Promise.reject(new Error('Merged engine budget exhausted'));
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error('Merged engine request timeout')); }, remaining);
      Promise.resolve().then(run).then(function(value) { clearTimeout(timer); resolve(value); }, function(error) { clearTimeout(timer); reject(error); });
    });
  }
  return function(url, options) {
    return bounded(function() { return nativeFetch(url, options); }).then(function(response) {
      return { ok: response.ok, status: response.status, statusText: response.statusText, url: response.url, headers: response.headers,
        text: function() { return bounded(function() { return response.text(); }); },
        json: function() { return bounded(function() { return response.json(); }); },
        arrayBuffer: function() { return bounded(function() { return response.arrayBuffer(); }); } };
    });
  };
}
function cloudbankMergedMetadataFetch(nativeFetch) {
  return function(url, options) {
    var raw = typeof url === 'string' ? url : url && url.url;
    var match = typeof raw === 'string' && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(raw);
    if (!match || options && options.method && String(options.method).toUpperCase() !== 'GET' || typeof vueoSharedTmdb !== 'function') return nativeFetch(url, options);
    var context = typeof globalThis !== 'undefined' ? globalThis.VUEO_DISCOVERY_CONTEXT : null;
    if (typeof context === 'string') { try { context = JSON.parse(context); } catch (_) { context = null; } }
    var contextId = context && (context.tmdbId || context.tmdb && context.tmdb.id);
    if (contextId && String(contextId) !== match[2]) return nativeFetch(url, options);
    return vueoSharedTmdb(raw, function() {
      return nativeFetch(url, options).then(function(response) { if (!response.ok) throw new Error('TMDB HTTP ' + response.status); return response.json(); });
    }).then(function(data) {
      var body = JSON.stringify(data);
      return { ok: true, status: 200, url: raw, headers: { get: function(name) { return String(name).toLowerCase() === 'content-type' ? 'application/json' : null; } },
        json: function() { return Promise.resolve(JSON.parse(body)); }, text: function() { return Promise.resolve(body); } };
    });
  };
}
/* CLOUDBANK_VERSION_MERGE_ADAPTER_END */

var cloudbankMergedEngines = [{ id: "moviesmod", enabled: true, disabledPlatforms: [], provider: module.exports }];
cloudbankMergedEngines.push({ id: "moviesmod-v2", enabled: true, disabledPlatforms: [], provider: (function() {
  function createEngine(deadline) {
  var embedded = { exports: {} };
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported merged module: " + name);
    return require(name);
  }
  (function(module, exports, require, fetch, global) {
/* CLOUDBANK_MERGED_ENGINE_START:moviesmod-v2 */
/**
 * moviesmod - Built from src/moviesmod/
 * Generated: 2026-06-01T21:56:44.544Z
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

// src/moviesmod/index.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));

// src/moviesmod/constants.js
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var FALLBACK_DOMAIN = "https://moviesmod.cc";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

// src/moviesmod/utils.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
var cachedDomain = "";
function getMainUrl() {
  return __async(this, null, function* () {
    if (cachedDomain)
      return cachedDomain;
    try {
      const response = yield fetch(DOMAINS_URL);
      const data = yield response.json();
      cachedDomain = data.moviesmod || FALLBACK_DOMAIN;
      return cachedDomain;
    } catch (e) {
      return FALLBACK_DOMAIN;
    }
  });
}
function getBaseUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch (e) {
    return "";
  }
}
function fixUrl(url, domain) {
  if (!url)
    return "";
  if (url.startsWith("http"))
    return url;
  if (url.startsWith("//"))
    return `https:${url}`;
  if (url.startsWith("/"))
    return domain + url;
  return `${domain}/${url}`;
}
function bypassHrefli(url) {
  return __async(this, null, function* () {
    const host = getBaseUrl(url);
    try {
      const res1 = yield fetch(url, { headers: HEADERS });
      const html1 = yield res1.text();
      const $1 = import_cheerio_without_node_native.default.load(html1);
      const formUrl1 = $1("form#landing").attr("action");
      const formData1 = {};
      $1("form#landing input").each((_, el) => {
        formData1[$1(el).attr("name")] = $1(el).attr("value") || "";
      });
      const res2 = yield fetch(formUrl1, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), { "Content-Type": "application/x-www-form-urlencoded" }),
        body: new URLSearchParams(formData1).toString()
      });
      const html2 = yield res2.text();
      const $2 = import_cheerio_without_node_native.default.load(html2);
      const formUrl2 = $2("form#landing").attr("action");
      const formData2 = {};
      $2("form#landing input").each((_, el) => {
        formData2[$2(el).attr("name")] = $2(el).attr("value") || "";
      });
      const res3 = yield fetch(formUrl2, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), { "Content-Type": "application/x-www-form-urlencoded" }),
        body: new URLSearchParams(formData2).toString()
      });
      const html3 = yield res3.text();
      const $3 = import_cheerio_without_node_native.default.load(html3);
      const script = $3("script:contains(?go=)").html() || "";
      const skTokenMatch = script.match(/\?go=([^"]+)/);
      if (!skTokenMatch)
        return null;
      const skToken = skTokenMatch[1];
      const wpHttp2 = formData2["_wp_http2"] || "";
      const res4 = yield fetch(`${host}?go=${skToken}`, {
        headers: __spreadProps(__spreadValues({}, HEADERS), { "Cookie": `${skToken}=${wpHttp2}` })
      });
      const html4 = yield res4.text();
      const $4 = import_cheerio_without_node_native.default.load(html4);
      const metaRefresh = $4('meta[http-equiv="refresh"]').attr("content") || "";
      const driveUrlMatch = metaRefresh.match(/url=(.+)/);
      if (!driveUrlMatch)
        return null;
      const driveUrl = driveUrlMatch[1];
      const res5 = yield fetch(driveUrl, { headers: HEADERS });
      const html5 = yield res5.text();
      const pathMatch = html5.match(/replace\("([^"]+)"\)/);
      if (!pathMatch || pathMatch[1] === "/404")
        return null;
      return fixUrl(pathMatch[1], getBaseUrl(driveUrl));
    } catch (e) {
      return null;
    }
  });
}
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        imdbId: (_a = data.external_ids) == null ? void 0 : _a.imdb_id
      };
    } catch (e) {
      return null;
    }
  });
}
function getIndexQuality(str) {
  if (!str)
    return "Unknown";
  const match = str.match(/(\d{3,4})[pP]/);
  if (match)
    return match[1] + "p";
  if (str.toUpperCase().includes("4K") || str.toUpperCase().includes("UHD"))
    return "2160p";
  return "Unknown";
}
function extractDriveseedPage(url) {
  return __async(this, null, function* () {
    const streams = [];
    try {
      let pageUrl = url;
      if (url.includes("r?key=")) {
        const res2 = yield fetch(url, { headers: HEADERS });
        const html2 = yield res2.text();
        const redirectMatch = html2.match(/replace\("([^"]+)"\)/);
        if (redirectMatch) {
          pageUrl = getBaseUrl(url) + redirectMatch[1];
        }
      }
      const res = yield fetch(pageUrl, { headers: HEADERS });
      const html = yield res.text();
      const $ = import_cheerio_without_node_native.default.load(html);
      const baseDomain = getBaseUrl(pageUrl);
      const qualityText = $("li.list-group-item").first().text() || "";
      const size = $("li:nth-child(3)").text().replace("Size : ", "").trim();
      const quality = getIndexQuality(qualityText);
      const elements = $("div.text-center > a").get();
      for (const el of elements) {
        const text = $(el).text().toLowerCase();
        const href = $(el).attr("href");
        if (!href)
          continue;
        if (text.includes("instant download")) {
          const instantRes = yield fetch(href, { headers: HEADERS, redirect: "follow" });
          if (instantRes.url && instantRes.url.includes("url=")) {
            streams.push({ name: "Driveseed Instant", url: instantRes.url.split("url=")[1], quality, size });
          }
        } else if (text.includes("resume cloud")) {
          const cloudRes = yield fetch(baseDomain + href, { headers: HEADERS });
          const cloudHtml = yield cloudRes.text();
          const link = import_cheerio_without_node_native.default.load(cloudHtml)("a.btn-success").first().attr("href");
          if (link)
            streams.push({ name: "Driveseed Cloud", url: link, quality, size });
        } else if (text.includes("cloud download")) {
          streams.push({ name: "Driveseed Cloud", url: href, quality, size });
        }
      }
    } catch (e) {
    }
    return streams;
  });
}

// src/moviesmod/index.js
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MoviesMod] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details)
      return [];
    const mainUrl = yield getMainUrl();
    console.log(`[MoviesMod] Main URL: ${mainUrl}`);
    const query = details.imdbId ? details.imdbId : details.title;
    const searchUrl = mediaType === "movie" ? `${mainUrl.replace(/\/$/, "")}/search/${encodeURIComponent(query)}` : `${mainUrl.replace(/\/$/, "")}/search/${encodeURIComponent(query)} ${seasonNum}`;
    try {
      console.log(`[MoviesMod] Searching at: ${searchUrl}`);
      const searchRes = yield fetch(searchUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }) });
      const searchHtml = yield searchRes.text();
      const $search = import_cheerio_without_node_native2.default.load(searchHtml);
      let targetUrl = $search("#content_box article > a").first().attr("href");
      if (!targetUrl) {
        console.log("[MoviesMod] No search result found");
        return [];
      }
      const pageRes = yield fetch(targetUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }) });
      const pageHtml = yield pageRes.text();
      const $ = import_cheerio_without_node_native2.default.load(pageHtml);
      const allStreams = [];
      const contentBox = $(".thecontent");
      const hTag = mediaType === "movie" ? "h4" : "h3";
      const aTag = mediaType === "movie" ? "Download" : "Episode";
      const sTag = mediaType === "movie" ? "" : `(S0${seasonNum}|Season ${seasonNum})`;
      const qualityRegex = new RegExp(`${sTag}.*(480p|720p|1080p|2160p)`, "i");
      const entries = contentBox.find(hTag).filter((i, el) => {
        const text = $(el).text();
        return qualityRegex.test(text) && !text.includes("MoviesMod");
      });
      for (const entry of entries.get()) {
        const quality = getIndexQuality($(entry).text());
        const nextHref = cloudbankMoviesModFollowingHref($, entry, aTag);
        if (nextHref) {
          const streams = yield processModLink(nextHref, targetUrl, quality);
          allStreams.push(...streams);
        }
      }
      return allStreams;
    } catch (e) {
      console.error("[MoviesMod] Error:", e.message);
      return [];
    }
  });
}
function processModLink(url, referer, quality) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
      const html = yield res.text();
      const $ = import_cheerio_without_node_native2.default.load(html);
      const links = [];
      $('a[href*="driveseed.org"], a[href*="tech.unblockedgames.world"]').each((i, el) => {
        links.push($(el).attr("href"));
      });
      const results = [];
      for (const link of [...new Set(links)]) {
        let finalLink = link;
        if (link.includes("unblockedgames")) {
          finalLink = yield bypassHrefli(link);
        }
        if (finalLink && finalLink.includes("driveseed")) {
          const streams = yield extractDriveseedPage(finalLink);
          results.push(...streams.map((s) => __spreadProps(__spreadValues({}, s), {
            name: `MoviesMod [${s.name}]`,
            title: `MoviesMod - ${s.quality} ${s.size ? `[${s.size}]` : ""}`,
            quality: s.quality || quality,
            provider: "moviesmod"
          })));
        }
      }
      return results;
    } catch (e) {
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_MERGED_ENGINE_END:moviesmod-v2 */
  })(embedded, embedded.exports, portableRequire, cloudbankMergedBudgetFetch(cloudbankMergedMetadataFetch(fetch), deadline), typeof globalThis !== "undefined" ? globalThis : global);
  return Object.assign({}, embedded.exports);
  }
  var settingsProvider = createEngine(Date.now() + 6000);
  return Object.assign({}, settingsProvider, { getStreams: function() {
    // A fresh request scope prevents an expired scan from borrowing a later scan's deadline.
    var engine = createEngine(Date.now() + 6000);
    return engine.getStreams.apply(engine, arguments);
  } });
})() });
module.exports = cloudbankVersionMerge(cloudbankMergedEngines, "moviesmod");
if (typeof globalThis !== "undefined") { globalThis.getStreams = module.exports.getStreams; if (module.exports.onSettings) globalThis.onSettings = module.exports.onSettings; }

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
module.exports = cloudbankDisplayInstall(module.exports, "MoviesMod", "moviesmod");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
