// Imported provider: moviesdrive-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
 * moviesdrive - Built from src/moviesdrive/
 * Generated: 2026-06-01T21:56:44.531Z
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

// src/moviesdrive/index.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));

// src/moviesdrive/constants.js
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive"
};

// src/moviesdrive/utils.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
var cachedMainUrl = "";
function getMainUrl() {
  return __async(this, null, function* () {
    if (cachedMainUrl)
      return cachedMainUrl;
    try {
      const response = yield fetch(DOMAINS_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
      const data = yield response.json();
      cachedMainUrl = data.moviesdrive || "https://new3.moviesdrives.my";
      return cachedMainUrl;
    } catch (e) {
      return "https://new3.moviesdrives.my";
    }
  });
}
function hubCloudExtractor(url, referer) {
  return __async(this, null, function* () {
    var _a;
    try {
      let currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
      const pageResponse = yield fetch(currentUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
      let pageData = yield pageResponse.text();
      let finalUrl = currentUrl;
      if (!currentUrl.includes("hubcloud.php")) {
        let nextHref = "";
        const $first = import_cheerio_without_node_native.default.load(pageData);
        const downloadBtn = $first("#download");
        if (downloadBtn.length) {
          nextHref = downloadBtn.attr("href");
        } else {
          const scriptUrlMatch = pageData.match(/var url = '([^']*)'/);
          if (scriptUrlMatch)
            nextHref = scriptUrlMatch[1];
        }
        if (nextHref) {
          if (!nextHref.startsWith("http")) {
            const urlObj = new URL(currentUrl);
            nextHref = `${urlObj.protocol}//${urlObj.hostname}/${nextHref.replace(/^\//, "")}`;
          }
          finalUrl = nextHref;
          const secondResponse = yield fetch(finalUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: currentUrl }) });
          pageData = yield secondResponse.text();
        }
      }
      const $ = import_cheerio_without_node_native.default.load(pageData);
      const size = $("i#size").text().trim();
      const header = $("div.card-header").text().trim();
      const qualityStr = (_a = header.match(/(\d{3,4})[pP]/)) == null ? void 0 : _a[1];
      const quality = qualityStr ? parseInt(qualityStr) : 1080;
      const links = [];
      const elements = $("a.btn").get();
      for (const element of elements) {
        const link = $(element).attr("href");
        const text = $(element).text().toLowerCase();
        if (text.includes("download file") || text.includes("fsl server") || text.includes("s3 server") || text.includes("fslv2") || text.includes("mega server") || link && link.includes("r2.dev")) {
          let label = "HubCloud";
          if (link && link.includes("r2.dev"))
            label = "Direct R2";
          else if (link && link.includes("workers.dev"))
            label = "ZipDisk Server";
          else if (text.includes("fsl server"))
            label = "HubCloud - FSL";
          else if (text.includes("s3 server"))
            label = "HubCloud - S3";
          else if (text.includes("fslv2"))
            label = "HubCloud - FSLv2";
          else if (text.includes("mega server"))
            label = "HubCloud - Mega";
          links.push({ name: label, quality, url: link, size });
        }
      }
      return links;
    } catch (e) {
      return [];
    }
  });
}
function loadExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      const hostname = new URL(url).hostname;
      if (hostname.includes("hubcloud"))
        return yield hubCloudExtractor(url, referer);
      if (hostname.includes("gdflix") || hostname.includes("gdlink"))
        return [{ name: "Google Drive", quality: 1080, url }];
      return [];
    } catch (e) {
      return [];
    }
  });
}

// src/moviesdrive/index.js
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    var _a;
    console.log(`[MoviesDrive] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}`);
    const tmdbApiKey = "1865f43a0549ca50d341dd9ab8b29f49";
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
    const tmdbRes = yield fetch(tmdbUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Connection": "keep-alive"
      }
    });
    const tmdbData = yield tmdbRes.json();
    const imdbId = (_a = tmdbData.external_ids) == null ? void 0 : _a.imdb_id;
    if (!imdbId) {
      console.error("[MoviesDrive] Failed to get IMDB ID");
      return [];
    }
    const mainUrl = yield getMainUrl();
    const searchUrl = `${mainUrl}/search.php?q=${imdbId}`;
    try {
      console.log(`[MoviesDrive] Searching at: ${searchUrl}`);
      const searchRes = yield fetch(searchUrl, { headers: HEADERS });
      if (!searchRes.ok) {
        console.error(`[MoviesDrive] Search request failed: ${searchRes.status}`);
        return [];
      }
      const searchData = yield searchRes.json();
      if (!searchData.hits || searchData.hits.length === 0) {
        console.log("[MoviesDrive] No hits found");
        return [];
      }
      const match = searchData.hits.map((h) => h.document).find((d) => d.imdb_id === imdbId);
      if (!match) {
        console.log("[MoviesDrive] No exact IMDB match found");
        return [];
      }
      const permalink = match.permalink;
      const href = permalink.startsWith("http") ? permalink : `${mainUrl}${permalink}`;
      const pageRes = yield fetch(href, { headers: HEADERS });
      const pageHtml = yield pageRes.text();
      const $ = import_cheerio_without_node_native2.default.load(pageHtml);
      const allLinks = [];
      if (mediaType === "movie") {
        const downloadLinks = $("h5 > a").map((i, el) => $(el).attr("href")).get();
        for (const dLink of [...new Set(downloadLinks)]) {
          const extracted = yield extractMdrive(dLink);
          for (const server of extracted) {
            const streams = yield loadExtractor(server, href);
            allLinks.push(...streams.map((s) => __spreadProps(__spreadValues({}, s), {
              title: `${tmdbData.title || tmdbData.name} - ${s.name} [${s.quality}p]`,
              provider: "moviesdrive"
            })));
          }
        }
      } else {
        const stag = `Season ${seasonNum}`;
        const sep = `Ep${String(episodeNum).padStart(2, "0")}|Ep${episodeNum}`;
        const entries = $("h5").filter((i, el) => new RegExp(stag, "i").test($(el).text()));
        for (const entry of entries.get()) {
          const nextHref = $(entry).next().find("a").attr("href");
          if (nextHref) {
            const epPageRes = yield fetch(nextHref, { headers: HEADERS });
            const epPageHtml = yield epPageRes.text();
            const $ep = import_cheerio_without_node_native2.default.load(epPageHtml);
            const epEntries = $ep("h5").filter((i, el) => new RegExp(sep, "i").test($ep(el).text()));
            for (const epEntry of epEntries.get()) {
              const link1 = $ep(epEntry).next().find("a").attr("href");
              const link2 = $ep(epEntry).next().next().find("a").attr("href");
              const epLinks = [link1, link2].filter((l) => !!l);
              for (const epLink of epLinks) {
                const streams = yield loadExtractor(epLink, nextHref);
                allLinks.push(...streams.map((s) => __spreadProps(__spreadValues({}, s), {
                  title: `${tmdbData.title || tmdbData.name} S${seasonNum}E${episodeNum} - ${s.name} [${s.quality}p]`,
                  provider: "moviesdrive"
                })));
              }
            }
          }
        }
      }
      return allLinks;
    } catch (e) {
      console.error("[MoviesDrive] Error:", e.message);
      return [];
    }
  });
}
function extractMdrive(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }) });
      const html = yield res.text();
      if (url.includes("search-recover.php")) {
        const qMatch = html.match(/const Q_INITIAL\s*=\s*"([^"]+)"/);
        const tokenMatch = html.match(/const FROM_AC_TOKEN\s*=\s*"([^"]+)"/);
        if (qMatch && tokenMatch) {
          const apiBase = url.split("?")[0];
          const searchParams = new URLSearchParams({
            api: "search",
            q: qMatch[1],
            page: "1",
            from_ac: tokenMatch[1]
          });
          const apiRes = yield fetch(`${apiBase}?${searchParams.toString()}`, {
            headers: __spreadProps(__spreadValues({}, HEADERS), { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" })
          });
          const data = yield apiRes.json();
          if (data.hits) {
            return data.hits.map((h) => h.url).filter((u) => !!u);
          }
        }
      }
      const $ = import_cheerio_without_node_native2.default.load(html);
      const regex = /hubcloud|gdflix|gdlink/i;
      return $("a[href]").map((i, el) => $(el).attr("href")).get().filter((href) => regex.test(href));
    } catch (e) {
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "moviesdrive-v2", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();
