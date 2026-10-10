// Imported provider: animesalt; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
 * animesalt - Built from src/animesalt/
 * Generated: 2026-09-22T20:41:44.444Z
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

// src/animesalt/index.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));

// src/animesalt/constants.js
var MAIN_URL = "https://animesalt.cx";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.5"
};

// src/animesalt/utils.js
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    const endpoint = mediaType === "movie" ? "movie" : "tv";
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    try {
      const res = yield fetch(url, { headers: HEADERS });
      if (!res.ok)
        return null;
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        year: parseInt((data.release_date || data.first_air_date || "").substring(0, 4)) || null,
        imdbId: ((_a = data.external_ids) == null ? void 0 : _a.imdb_id) || null
      };
    } catch (e) {
      return null;
    }
  });
}
function cleanTitle(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function titleSimilarity(a, b) {
  const cleanA = cleanTitle(a);
  const cleanB = cleanTitle(b);
  if (!cleanA || !cleanB)
    return 0;
  if (cleanA === cleanB)
    return 1;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA))
    return 0.8;
  const wordsA = new Set(cleanA.split(" "));
  const wordsB = new Set(cleanB.split(" "));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w))
      intersection++;
  }
  return intersection * 2 / (wordsA.size + wordsB.size);
}
function unpack(code) {
  try {
    const match = code.match(/}\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\((['"])\|\7\)/);
    if (match) {
      let [_, quote1, p, a, c, quote2, kStr] = match;
      p = p.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      const radix = parseInt(a);
      let count = parseInt(c);
      const k = kStr.split("|");
      const e = (c2) => (c2 < radix ? "" : e(parseInt(c2 / radix))) + ((c2 = c2 % radix) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
      const d = {};
      while (count--)
        d[e(count)] = k[count] || e(count);
      return p.replace(/\b\w+\b/g, (w) => d[w]);
    }
  } catch (e) {
  }
  return code;
}
function isRealStreamUrl(url) {
  if (!url || typeof url !== "string")
    return false;
  if (!url.startsWith("http://") && !url.startsWith("https://"))
    return false;
  const lowercase = url.toLowerCase();
  if (lowercase.includes("/embed/") || lowercase.includes("/embed-") || lowercase.includes("/e/") || lowercase.includes("/play.php") || lowercase.includes("/player.php") || lowercase.includes("abyssplayer.com") || lowercase.includes("short.icu") || lowercase.includes("cloudy.upns.one") || lowercase.includes("vidcloud.upns.ink") || lowercase.includes("filesforever.link") || lowercase.includes("strmup.to") || lowercase.includes("emturbovid.com") || lowercase.includes("animedekho.app") || lowercase.includes("animesalt.cx") || lowercase.includes("youtube.com") || lowercase.includes("youtu.be") || lowercase.includes("vimeo.com") || lowercase.includes(".html") || lowercase.includes(".htm") || lowercase.includes(".php") || lowercase.includes("#")) {
    return false;
  }
  const isHls = lowercase.includes(".m3u8");
  const isMp4 = lowercase.includes(".mp4") || lowercase.includes("/sora/") || lowercase.includes("/stream/");
  return isHls || isMp4 || lowercase.includes(".mkv") || lowercase.includes(".mpd");
}
function isPlayableStream(stream) {
  return __async(this, null, function* () {
    if (!isRealStreamUrl(stream == null ? void 0 : stream.url))
      return false;
    try {
      const headers = __spreadProps(__spreadValues({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
      }, stream.headers || {}), {
        "Range": "bytes=0-10"
      });
      const res = yield fetch(stream.url, {
        headers,
        signal: AbortSignal.timeout(3e3)
      });
      if (!res.ok && res.status !== 206)
        return false;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/html"))
        return false;
      return true;
    } catch (e) {
      return false;
    }
  });
}

// src/animesalt/extractors.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
var import_crypto_js = __toESM(require("crypto-js"));
function extractAwsStream(url) {
  return __async(this, null, function* () {
    try {
      const hash = url.split("/").filter(Boolean).pop();
      if (!hash)
        return null;
      const origin = new URL(url).origin;
      const res = yield fetch(url, { headers: HEADERS });
      if (!res.ok)
        return null;
      const html = yield res.text();
      const postUrl = `${origin}/player/index.php?data=${hash}&do=getVideo`;
      const postRes = yield fetch(postUrl, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), {
          "x-requested-with": "XMLHttpRequest",
          "Origin": origin,
          "Referer": url,
          "Content-Type": "application/x-www-form-urlencoded"
        }),
        body: `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(origin)}`
      });
      if (!postRes.ok)
        return null;
      const json = yield postRes.json();
      const m3u8 = json == null ? void 0 : json.videoSource;
      if (!m3u8)
        return null;
      let subtitle = null;
      const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(['"]\|['"]\)\)/);
      if (packedMatch) {
        const unpacked = unpack(packedMatch[0]);
        const subMatch = unpacked.match(/"kind":\s*"captions"\s*,\s*"file":\s*"(https?:\/\/[^"]+)"/);
        if (subMatch) {
          subtitle = subMatch[1].replace(/\\/g, "");
        }
      }
      return {
        url: m3u8,
        headers: {
          "Referer": `${origin}/`,
          "Origin": origin,
          "User-Agent": HEADERS["User-Agent"]
        },
        subtitles: subtitle ? [{ lang: "English", url: subtitle }] : []
      };
    } catch (e) {
      return null;
    }
  });
}
function extractAbyss(url, langName = "Default") {
  return __async(this, null, function* () {
    var _a;
    try {
      const cleanUrl = url.replace("https://short.icu", "https://abyssplayer.com");
      const reqHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Origin": "https://playhydrax.com",
        "Referer": "https://playhydrax.com/"
      };
      const res = yield fetch(cleanUrl, { headers: reqHeaders });
      if (!res.ok)
        return [];
      const html = yield res.text();
      const match = html.match(/const\s+datas\s*=\s*"([^"]*)"/);
      if (!match || !match[1])
        return [];
      const decRes = yield fetch("https://enc-dec.app/api/dec-abyss", {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, reqHeaders), {
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({ text: match[1] })
      });
      if (!decRes.ok)
        return [];
      const decData = yield decRes.json();
      const sources = ((_a = decData == null ? void 0 : decData.result) == null ? void 0 : _a.sources) || [];
      return sources.filter((s) => s && s.url && s.status).map((s) => {
        const codec = (s.codec || "MP4").toUpperCase();
        const quality = s.type || "720p";
        return {
          name: `AnimeSalt [${langName}] (${codec} ${quality})`,
          url: s.url,
          quality,
          headers: {
            "Referer": "https://playhydrax.com/",
            "Origin": "https://playhydrax.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
          },
          type: s.url.includes(".m3u8") ? "m3u8" : "mp4"
        };
      });
    } catch (e) {
      return [];
    }
  });
}
function extractMultiLang(dataParam) {
  return __async(this, null, function* () {
    try {
      let decodedStr = "";
      if (typeof atob === "function") {
        decodedStr = atob(dataParam);
      } else {
        decodedStr = Buffer.from(dataParam, "base64").toString("utf-8");
      }
      const list = JSON.parse(decodedStr);
      if (!Array.isArray(list))
        return [];
      const streamPromises = list.map((item) => {
        const lang = item.language || "Default";
        const link = item.link;
        if (!link)
          return Promise.resolve([]);
        return extractAbyss(link, lang);
      });
      const nested = yield Promise.all(streamPromises);
      return nested.flat();
    } catch (e) {
      return [];
    }
  });
}
function extractMegaPlay(url) {
  return __async(this, null, function* () {
    var _a;
    try {
      let streamPageUrl = url;
      if (!url.includes("/stream/s-")) {
        const pageRes = yield fetch(url, { headers: HEADERS });
        if (!pageRes.ok)
          return [];
        const html = yield pageRes.text();
        const $ = import_cheerio_without_node_native.default.load(html);
        const embedSrc = $("iframe.s5-embed").attr("src");
        if (!embedSrc)
          return [];
        streamPageUrl = embedSrc;
      }
      const idMatch = streamPageUrl.match(/\/stream\/s-\d+\/(\d+)\//);
      if (!idMatch || !idMatch[1])
        return [];
      const id = idMatch[1];
      const origin = new URL(streamPageUrl).origin;
      const apiHeaders = {
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": origin,
        "User-Agent": HEADERS["User-Agent"]
      };
      const apiRes = yield fetch(`${origin}/stream/getSources?id=${id}`, { headers: apiHeaders });
      if (!apiRes.ok)
        return [];
      const resJson = yield apiRes.json();
      let file = (_a = resJson == null ? void 0 : resJson.sources) == null ? void 0 : _a.file;
      const enc = resJson == null ? void 0 : resJson.enc;
      if (!file && enc) {
        const keyStr = "i?LMTAx0Q6,:}50U";
        const keyHex = import_crypto_js.default.enc.Utf8.parse(keyStr).toString(import_crypto_js.default.enc.Hex).padEnd(64, "0");
        const key = import_crypto_js.default.enc.Hex.parse(keyHex);
        const iv = import_crypto_js.default.enc.Utf8.parse("W0;27ToaUpl_P%'c");
        const normalized = enc.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
        const decrypted = import_crypto_js.default.AES.decrypt(padded, key, {
          iv,
          mode: import_crypto_js.default.mode.CBC,
          padding: import_crypto_js.default.pad.Pkcs7
        });
        const decObj = JSON.parse(decrypted.toString(import_crypto_js.default.enc.Utf8));
        file = decObj == null ? void 0 : decObj.file;
      }
      if (!file)
        return [];
      const tokenMatch = file.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
      if (tokenMatch && !file.includes("token=")) {
        const secret = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
        const expires = Math.floor(Date.now() / 1e3) + 90;
        const payload = `${expires}|${tokenMatch[1]}/${tokenMatch[2]}`;
        const hash = import_crypto_js.default.HmacSHA256(payload, secret);
        const b64Payload = import_crypto_js.default.enc.Base64.stringify(import_crypto_js.default.enc.Utf8.parse(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const b64Sig = import_crypto_js.default.enc.Base64.stringify(hash).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const token = `${b64Payload}.${b64Sig}`;
        file = `${file}${file.includes("?") ? "&" : "?"}token=${token}`;
      }
      const subtitles = ((resJson == null ? void 0 : resJson.tracks) || []).filter((t) => t.file && t.kind !== "thumbnails").map((t) => ({ lang: t.label || "English", url: t.file }));
      return [{
        name: "AnimeSalt [MegaPlay] (Auto M3U8)",
        url: file,
        quality: "1080p",
        headers: {
          "Referer": `${origin}/`,
          "Origin": origin,
          "User-Agent": HEADERS["User-Agent"]
        },
        subtitles,
        type: "m3u8"
      }];
    } catch (e) {
      return [];
    }
  });
}
function extractStreamWish(url) {
  return __async(this, null, function* () {
    try {
      const embedUrl = url.includes("/e/") ? url : url.replace("/f/", "/e/");
      const res = yield fetch(embedUrl, { headers: HEADERS });
      if (!res.ok)
        return null;
      const html = yield res.text();
      const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\(['"]\|['"]\)\)/);
      if (packedMatch) {
        const unpacked = unpack(packedMatch[0]);
        const fileMatch = unpacked.match(/file\s*:\s*["'](https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?)["']/);
        if (fileMatch) {
          const origin = new URL(embedUrl).origin;
          return {
            name: "AnimeSalt [StreamWish] (Auto M3U8)",
            url: fileMatch[1],
            quality: "720p",
            headers: {
              "Referer": `${origin}/`,
              "Origin": origin,
              "User-Agent": HEADERS["User-Agent"]
            },
            type: "m3u8"
          };
        }
      }
    } catch (e) {
    }
    return null;
  });
}

// src/animesalt/index.js
function searchAnimeSalt(query) {
  return __async(this, null, function* () {
    var _a;
    try {
      const body = `action=torofilm_infinite_scroll&page=1&per_page=12&query_type=search&query_args[s]=${encodeURIComponent(query)}`;
      const res = yield fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${MAIN_URL}/`
        }),
        body
      });
      if (!res.ok)
        return [];
      const json = yield res.json();
      if (!(json == null ? void 0 : json.success) || !((_a = json == null ? void 0 : json.data) == null ? void 0 : _a.content))
        return [];
      const $ = import_cheerio_without_node_native2.default.load(json.data.content);
      const results = [];
      $("article").each((_, el) => {
        const title = $(el).find("header h2").text().trim();
        const href = $(el).find("a").first().attr("href");
        if (title && href) {
          results.push({ title, href });
        }
      });
      return results;
    } catch (e) {
      return [];
    }
  });
}
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    try {
      const details = yield fetchTmdbDetails(tmdbId, mediaType);
      if (!details || !details.title)
        return [];
      let results = yield searchAnimeSalt(details.title);
      if (results.length === 0) {
        const cleaned = cleanTitle(details.title);
        if (cleaned && cleaned !== details.title.toLowerCase()) {
          results = yield searchAnimeSalt(cleaned);
        }
      }
      if (results.length === 0)
        return [];
      let bestMatch = null;
      let highestSim = 0;
      for (const item of results) {
        const sim = titleSimilarity(details.title, item.title);
        if (sim > highestSim) {
          highestSim = sim;
          bestMatch = item;
        }
      }
      if (!bestMatch || highestSim < 0.2) {
        bestMatch = results[0];
      }
      let targetUrl = bestMatch.href;
      if (mediaType === "tv") {
        const seriesRes = yield fetch(bestMatch.href, { headers: HEADERS });
        if (!seriesRes.ok)
          return [];
        const seriesHtml = yield seriesRes.text();
        const $series = import_cheerio_without_node_native2.default.load(seriesHtml);
        let seasonBtn = $series(`div.season-buttons a[data-season="${seasonNum}"]`);
        if (seasonBtn.length === 0) {
          seasonBtn = $series("div.season-buttons a").first();
        }
        const postId = seasonBtn.attr("data-post");
        const dataSeason = seasonBtn.attr("data-season") || seasonNum;
        if (postId) {
          const epRes = yield fetch(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
            method: "POST",
            headers: __spreadProps(__spreadValues({}, HEADERS), {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": bestMatch.href
            }),
            body: `action=action_select_season&season=${dataSeason}&post=${postId}`
          });
          if (epRes.ok) {
            const epHtml = yield epRes.text();
            const $ep = import_cheerio_without_node_native2.default.load(epHtml);
            const epArticles = $ep("li article");
            let targetEp = null;
            epArticles.each((idx, el) => {
              const epText = $ep(el).find("h2.entry-title").text();
              if (epText.includes(`x${episodeNum}`) || epText.includes(`Episode ${episodeNum}`)) {
                targetEp = $ep(el).find("a").first().attr("href");
              }
            });
            if (!targetEp && epArticles.length >= episodeNum) {
              targetEp = $ep(epArticles[episodeNum - 1]).find("a").first().attr("href");
            }
            if (targetEp) {
              targetUrl = targetEp;
            }
          }
        }
      }
      const pageRes = yield fetch(targetUrl, { headers: HEADERS });
      if (!pageRes.ok)
        return [];
      const pageHtml = yield pageRes.text();
      const $page = import_cheerio_without_node_native2.default.load(pageHtml);
      const iframeUrls = /* @__PURE__ */ new Set();
      $page("iframe").each((_, el) => {
        const src = $page(el).attr("data-src") || $page(el).attr("src");
        if (src && !src.startsWith("about:") && !src.startsWith("javascript:")) {
          const fullUrl = src.startsWith("//") ? `https:${src}` : src.startsWith("http") ? src : `${MAIN_URL}${src}`;
          iframeUrls.add(fullUrl);
        }
      });
      const streams = [];
      const promises = [];
      for (const iframeUrl of iframeUrls) {
        if (iframeUrl.includes("multi-lang-plyr/player.php")) {
          const urlObj = new URL(iframeUrl);
          const dataParam = urlObj.searchParams.get("data");
          if (dataParam) {
            promises.push(
              extractMultiLang(dataParam).then((res) => {
                if (Array.isArray(res))
                  streams.push(...res);
              })
            );
          }
        } else if (iframeUrl.includes("as-cdn") || iframeUrl.includes("awstream") || iframeUrl.includes("zephyrflick")) {
          promises.push(
            extractAwsStream(iframeUrl).then((res) => {
              if (res && res.url) {
                streams.push({
                  name: "AnimeSalt [AWSStream] (Auto M3U8)",
                  url: res.url,
                  quality: "1080p",
                  headers: res.headers,
                  subtitles: res.subtitles,
                  type: "m3u8"
                });
              }
            })
          );
        } else if (iframeUrl.includes("abyssplayer.com") || iframeUrl.includes("short.icu")) {
          promises.push(
            extractAbyss(iframeUrl, "Default").then((res) => {
              if (Array.isArray(res))
                streams.push(...res);
            })
          );
        } else if (iframeUrl.includes("megaplay.buzz") || iframeUrl.includes("rapid-cloud.co")) {
          promises.push(
            extractMegaPlay(iframeUrl).then((res) => {
              if (Array.isArray(res))
                streams.push(...res);
            })
          );
        } else if (iframeUrl.includes("pixdrive") || iframeUrl.includes("ghbrisk") || iframeUrl.includes("streamwish") || iframeUrl.includes("filesim")) {
          promises.push(
            extractStreamWish(iframeUrl).then((res) => {
              if (res)
                streams.push(res);
            })
          );
        }
      }
      yield Promise.allSettled(promises);
      const seenUrls = /* @__PURE__ */ new Set();
      const candidateStreams = [];
      for (const s of streams) {
        if (s && s.url && !seenUrls.has(s.url) && isRealStreamUrl(s.url)) {
          seenUrls.add(s.url);
          candidateStreams.push({
            name: s.name || "AnimeSalt",
            title: mediaType === "movie" ? details.title : `${details.title} - S${seasonNum}E${episodeNum}`,
            url: s.url,
            quality: s.quality || "Auto",
            headers: s.headers,
            subtitles: s.subtitles || [],
            provider: "animesalt",
            type: s.type || "m3u8"
          });
        }
      }
      const probeResults = yield Promise.all(
        candidateStreams.map((s) => __async(this, null, function* () {
          return { stream: s, playable: yield isPlayableStream(s) };
        }))
      );
      let finalStreams = probeResults.filter((r) => r.playable).map((r) => r.stream);
      if (finalStreams.length === 0)
        finalStreams = candidateStreams;
      const qualityOrder = { "1080p": 4, "720p": 3, "480p": 2, "360p": 1, "Auto": 0 };
      return finalStreams.sort((a, b) => {
        var _a, _b;
        return ((_a = qualityOrder[b.quality]) != null ? _a : 0) - ((_b = qualityOrder[a.quality]) != null ? _b : 0);
      });
    } catch (e) {
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "animesalt", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "AnimeSalt", "animesalt");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
