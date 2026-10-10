// Imported provider: moviesdrive; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
 * Generated: 2026-09-26T06:11:02.295Z
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
var MAIN_URL = "https://new4.moviesdrive.christmas";
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
      cachedMainUrl = data.moviesdrive || MAIN_URL;
      return cachedMainUrl;
    } catch (e) {
      return MAIN_URL;
    }
  });
}
function getIndexQuality(str) {
  if (!str)
    return 1080;
  const match = str.match(/(\d{3,4})[pP]/);
  if (match)
    return parseInt(match[1]);
  if (str.toUpperCase().includes("4K") || str.toUpperCase().includes("2160P") || str.toUpperCase().includes("UHD"))
    return 2160;
  return 1080;
}
function extractMdrive(url) {
  return __async(this, null, function* () {
    if (!url)
      return [];
    const regex = /hubcloud|gdflix|gdlink/i;
    if (!url.includes("search-recover.php") && regex.test(url) && (url.includes("/drive/") || url.includes("/file/"))) {
      return [url];
    }
    try {
      const res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }) });
      const html = yield res.text();
      if (url.includes("search-recover.php")) {
        const qMatch = html.match(/const\s+Q_INITIAL\s*=\s*["']([^"']+)["']/);
        const tokenMatch = html.match(/const\s+FROM_AC_TOKEN\s*=\s*["']([^"']+)["']/);
        if (qMatch && tokenMatch) {
          const apiBase = url.split("/drive/")[0];
          const searchParams = new URLSearchParams({
            api: "search",
            q: qMatch[1],
            page: "1",
            from_ac: tokenMatch[1]
          });
          const apiRes = yield fetch(`${apiBase}/drive/search-recover.php?${searchParams.toString()}`, {
            headers: __spreadProps(__spreadValues({}, HEADERS), { "Accept": "application/json", Referer: url, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" })
          });
          const data = yield apiRes.json();
          if (data.hits) {
            return data.hits.map((h) => h.url).filter(Boolean);
          }
        }
      }
      const $ = import_cheerio_without_node_native.default.load(html);
      return $("a[href]").map((i, el) => $(el).attr("href")).get().filter((href) => regex.test(href));
    } catch (e) {
      return [];
    }
  });
}
function hubCloudExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      let currentUrl = url;
      const pageResponse = yield fetch(currentUrl, {
        headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer })
      });
      let pageData = yield pageResponse.text();
      let finalUrl = currentUrl;
      if (!currentUrl.includes("hubcloud.php")) {
        let nextHref = "";
        const $first = import_cheerio_without_node_native.default.load(pageData);
        const phpLink = $first('a[href*="hubcloud.php"]').attr("href");
        if (phpLink) {
          nextHref = phpLink;
        } else {
          const downloadBtn = $first("#download");
          if (downloadBtn.length) {
            nextHref = downloadBtn.attr("href");
          } else {
            const scriptUrlMatch = pageData.match(/var url = ["']([^"']*)["']/);
            if (scriptUrlMatch)
              nextHref = scriptUrlMatch[1];
          }
        }
        if (nextHref) {
          if (!nextHref.startsWith("http")) {
            const urlObj = new URL(currentUrl);
            nextHref = `${urlObj.protocol}//${urlObj.hostname}/${nextHref.replace(/^\//, "")}`;
          }
          finalUrl = nextHref;
          const secondResponse = yield fetch(finalUrl, {
            headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: currentUrl })
          });
          pageData = yield secondResponse.text();
        }
      }
      const $ = import_cheerio_without_node_native.default.load(pageData);
      const size = $("i#size").text().trim();
      const header = $("div.card-header").text().trim();
      const quality = getIndexQuality(header);
      const pxlMatch = pageData.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
      const links = [];
      const elements = $("a[href]").get();
      const blocked = ["tinyurl", "telegram", "hubcloud.cx/tg", "hubcloud.foo/tg"];
      for (const el of elements) {
        let link = $(el).attr("href");
        const text = $(el).text().toLowerCase().trim();
        if (!link || blocked.some((b) => link.includes(b)))
          continue;
        if (link.includes("negn6f") && pxlMatch) {
          link = pxlMatch[1];
        }
        if (text.includes("fslv2")) {
          links.push({ name: "HubCloud - FSLv2", quality, url: link, size });
        } else if (text.includes("fsl server") || text.includes("fsl") && !text.includes("v2")) {
          links.push({ name: "HubCloud - FSL Server", quality, url: link, size });
        } else if (text.includes("download file") || text.includes("instant download") || text.includes("instant") || text.includes("10gbps")) {
          let streamUrl = link;
          if (streamUrl.includes("link=")) {
            streamUrl = streamUrl.split("link=")[1];
          } else {
            try {
              const res = yield fetch(link, {
                headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: finalUrl }),
                redirect: "follow"
              });
              if (res.url && res.url.startsWith("http")) {
                streamUrl = res.url;
                if (streamUrl.includes("link=")) {
                  streamUrl = streamUrl.split("link=")[1];
                }
              }
            } catch (e) {
            }
          }
          if (streamUrl && streamUrl.startsWith("http")) {
            links.push({ name: "HubCloud - Instant", quality, url: streamUrl, size });
          }
        } else if (text.includes("pixeldra") || text.includes("pixelserver") || text.includes("pixeldrain") || link.includes("pixeldrain")) {
          let pUrl = link;
          if (pUrl.includes("/u/")) {
            const fileId = pUrl.split("/u/")[1].split("?")[0].replace("/", "");
            pUrl = `https://pixeldrain.dev/api/file/${fileId}?download`;
          }
          links.push({ name: "HubCloud - Pixeldrain", quality, url: pUrl, size });
        } else if (text.includes("buzzserver") || text.includes("buzz server") || text.includes("buzz") || text.includes("fuckingfast")) {
          try {
            const dlRes = yield fetch(link, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              }
            });
            const dlHtml = yield dlRes.text();
            const copyMatch = dlHtml.match(/copyDownloadLink\(['"]([^'"]+)['"]\)/);
            const dlPath = copyMatch ? copyMatch[1].replace(/\\\//g, "/") : null;
            const base = new URL(link).origin;
            const dlUrl = dlPath ? dlPath.startsWith("http") ? dlPath : `${base}${dlPath}` : link.endsWith("/download") ? link : `${link}/download`;
            const resp = yield fetch(dlUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Referer": link,
                "HX-Request": "true"
              },
              redirect: "manual"
            });
            const dlink = resp.headers.get("hx-redirect") || resp.headers.get("location");
            if (dlink) {
              links.push({ name: "HubCloud - BuzzServer", quality, url: dlink, size });
            }
          } catch (e) {
          }
        } else if (text.includes("s3 server")) {
          links.push({ name: "HubCloud - S3", quality, url: link, size });
        } else if (text.includes("mega server")) {
          links.push({ name: "HubCloud - Mega", quality, url: link, size });
        } else if (link.includes("r2.dev")) {
          links.push({ name: "Direct R2", quality, url: link, size });
        } else if (link.includes("workers.dev")) {
          links.push({ name: "ZipDisk Server", quality, url: link, size });
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
        return [{ name: "GDFlix", quality: 1080, url }];
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
        "Accept": "application/json"
      }
    });
    const tmdbData = yield tmdbRes.json();
    const imdbId = (_a = tmdbData.external_ids) == null ? void 0 : _a.imdb_id;
    const cleanTitle = tmdbData.title || tmdbData.name || "";
    const mainUrl = yield getMainUrl();
    let match = null;
    const findMatch = (hits) => {
      if (!hits || !hits.length)
        return null;
      if (mediaType === "tv") {
        const sSlug = String(seasonNum).padStart(2, "0");
        const seasonPatterns = [
          new RegExp(`\\bseason\\s*0?${seasonNum}\\b`, "i"),
          new RegExp(`\\bs0?${seasonNum}\\b`, "i"),
          new RegExp(`\\bseason\\s*${sSlug}\\b`, "i")
        ];
        return hits.find((doc) => {
          const postTitle = (doc.post_title || "").toLowerCase();
          const permalink2 = (doc.permalink || "").toLowerCase();
          const normDocTitle = postTitle.replace(/[^a-z0-9]/g, "");
          const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
          const titleMatches = normDocTitle.includes(normTitle) || postTitle.includes(cleanTitle.toLowerCase()) || permalink2.includes(cleanTitle.toLowerCase().replace(/ /g, "-"));
          const seasonMatches = seasonPatterns.some((pat) => pat.test(postTitle) || pat.test(permalink2));
          return titleMatches && seasonMatches;
        });
      } else {
        return hits.find((d) => imdbId && d.imdb_id === imdbId) || hits.find((doc) => {
          const postTitle = (doc.post_title || "").toLowerCase();
          const permalink2 = (doc.permalink || "").toLowerCase();
          const normDocTitle = postTitle.replace(/[^a-z0-9]/g, "");
          const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
          return normDocTitle.includes(normTitle) || postTitle.includes(cleanTitle.toLowerCase()) || permalink2.includes(cleanTitle.toLowerCase().replace(/ /g, "-"));
        }) || hits[0];
      }
    };
    if (imdbId) {
      try {
        const searchUrl = `${mainUrl}/search.php?q=${imdbId}&page=1`;
        const searchRes = yield fetch(searchUrl, { headers: HEADERS });
        if (searchRes.ok) {
          const searchData = yield searchRes.json();
          match = findMatch((searchData.hits || []).map((h) => h.document));
        }
      } catch (e) {
      }
    }
    if (!match && cleanTitle) {
      try {
        const searchUrl = `${mainUrl}/search.php?q=${encodeURIComponent(cleanTitle)}&page=1`;
        const searchRes = yield fetch(searchUrl, { headers: HEADERS });
        if (searchRes.ok) {
          const searchData = yield searchRes.json();
          match = findMatch((searchData.hits || []).map((h) => h.document));
        }
      } catch (e) {
      }
    }
    if (!match) {
      console.log("[MoviesDrive] No matching post found");
      return [];
    }
    const permalink = match.permalink;
    const href = permalink.startsWith("http") ? permalink : `${mainUrl}${permalink}`;
    try {
      const pageRes = yield fetch(href, { headers: HEADERS });
      const pageHtml = yield pageRes.text();
      const $ = import_cheerio_without_node_native2.default.load(pageHtml);
      const allStreams = [];
      if (mediaType === "movie") {
        const links = [];
        $("h5 a").each((_, a) => {
          const h = $(a).attr("href");
          if (h)
            links.push(h);
        });
        for (const link of [...new Set(links)]) {
          const extracted = yield extractMdrive(link);
          for (const server of extracted) {
            const streams = yield loadExtractor(server, href);
            allStreams.push(...streams.map((s) => __spreadProps(__spreadValues({}, s), {
              title: `${cleanTitle} - ${s.name} [${s.quality}p]`,
              provider: "moviesdrive"
            })));
          }
        }
      } else {
        const sSlug = String(seasonNum).padStart(2, "0");
        const stag = `Season ${seasonNum}|S${sSlug}`;
        const sepRegex = new RegExp(`\\b(?:ep|episode|e)\\s*0?${episodeNum}\\b|s0?${seasonNum}\\s*e0?${episodeNum}\\b`, "i");
        const stopRegex = /^\s*(EP\d+|Episode\s*\d+|S\d+E\d+)/i;
        const entries = $("h5").filter((i, el) => new RegExp(stag, "i").test($(el).text()));
        for (const entry of entries.get()) {
          const nextHref = $(entry).next().find("a").attr("href") || $(entry).find("a").attr("href");
          if (!nextHref)
            continue;
          const epPageRes = yield fetch(nextHref, { headers: HEADERS });
          const epPageHtml = yield epPageRes.text();
          const $ep = import_cheerio_without_node_native2.default.load(epPageHtml);
          const epEntries = $ep("h5").filter((i, el) => sepRegex.test($ep(el).text()));
          for (const epEntry of epEntries.get()) {
            const epLinks = [];
            let sibling = $ep(epEntry).next();
            while (sibling.length && !stopRegex.test(sibling.text().trim())) {
              sibling.find("a[href]").each((_, a) => {
                const h = $ep(a).attr("href");
                if (h)
                  epLinks.push(h);
              });
              sibling = sibling.next();
            }
            if (epLinks.length === 0) {
              const l1 = $ep(epEntry).next().find("a").attr("href");
              const l2 = $ep(epEntry).next().next().find("a").attr("href");
              [l1, l2].forEach((l) => l && epLinks.push(l));
            }
            for (const epLink of [...new Set(epLinks)]) {
              const extracted = yield extractMdrive(epLink);
              for (const server of extracted) {
                const streams = yield loadExtractor(server, nextHref);
                allStreams.push(...streams.map((s) => __spreadProps(__spreadValues({}, s), {
                  title: `${cleanTitle} S${seasonNum}E${episodeNum} - ${s.name} [${s.quality}p]`,
                  provider: "moviesdrive"
                })));
              }
            }
          }
        }
      }
      return allStreams;
    } catch (e) {
      console.error("[MoviesDrive] Error:", e.message);
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "moviesdrive", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "MoviesDrive", "moviesdrive");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
