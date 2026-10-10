// Imported provider: mycima; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
 * mycima - Built from src/mycima/
 * Generated: 2026-06-01T14:20:20.835Z
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

// src/mycima/index.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));

// src/mycima/constants.js
var MAIN_URL = "https://mycima.red";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": MAIN_URL + "/",
  "X-Requested-With": "XMLHttpRequest"
};
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// src/mycima/utils.js
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    const response = yield fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok)
      throw new Error(`TMDB API error: ${response.status}`);
    const data = yield response.json();
    const title = mediaType === "tv" ? data.name : data.title;
    const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
    return { title, year, imdbId: ((_a = data.external_ids) == null ? void 0 : _a.imdb_id) || null };
  });
}
function normalizeTitle(title) {
  if (!title)
    return "";
  return title.toLowerCase().replace(/\b(the|a|an)\b/g, "").replace(/[:\-_]/g, " ").replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}
function calculateTitleSimilarity(title1, title2) {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);
  if (norm1 === norm2)
    return 1;
  const words1 = norm1.split(/\s+/).filter((w) => w.length > 0);
  const words2 = norm2.split(/\s+/).filter((w) => w.length > 0);
  if (words1.length === 0 || words2.length === 0)
    return 0;
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = words1.filter((w) => set2.has(w));
  const union = /* @__PURE__ */ new Set([...words1, ...words2]);
  const jaccard = intersection.length / union.size;
  const extraWordsCount = words2.filter((w) => !set1.has(w)).length;
  let score = jaccard - extraWordsCount * 0.05;
  if (words1.length > 0 && words1.every((w) => set2.has(w))) {
    score += 0.2;
  }
  return score;
}
function findBestTitleMatch(mediaInfo, searchResults, mediaType, season) {
  if (!searchResults || searchResults.length === 0)
    return null;
  let bestMatch = null;
  let bestScore = 0;
  for (const result of searchResults) {
    let score = calculateTitleSimilarity(mediaInfo.title, result.title);
    if (mediaInfo.year && result.year) {
      const yearDiff = Math.abs(mediaInfo.year - result.year);
      if (yearDiff === 0)
        score += 0.2;
      else if (yearDiff <= 1)
        score += 0.1;
      else if (yearDiff > 5)
        score -= 0.3;
    }
    if (score > bestScore && score > 0.3) {
      bestScore = score;
      bestMatch = result;
    }
  }
  return bestMatch;
}
var BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function atob(value) {
  if (!value)
    return "";
  let input = String(value).replace(/=+$/, "");
  let output = "";
  let bc = 0, bs, buffer, idx = 0;
  while (buffer = input.charAt(idx++)) {
    buffer = BASE64_CHARS.indexOf(buffer);
    if (~buffer) {
      bs = bc % 4 ? bs * 64 + buffer : buffer;
      if (bc++ % 4) {
        output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
      }
    }
  }
  return output;
}
function getImageURL(style) {
  if (!style)
    return null;
  const match = style.match(/url\((.*?)\)/);
  if (!match)
    return null;
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}
function jsUnpack(code) {
  try {
    let unbase = function(n, base) {
      const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      if (base <= 36)
        return parseInt(n, base).toString(36);
      let dict = {};
      for (let i = 0; i < base; i++)
        dict[alphabet[i]] = i;
      let res = 0;
      for (let i = 0; i < n.length; i++) {
        res = res * base + alphabet.indexOf(n[i]);
      }
      return res;
    };
    const match = code.match(/}\s*\(\s*['"](.+?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.+?)['"]\.split\(['"]\|['"]\)/);
    if (!match)
      return code;
    let [, p, a, c, k] = match;
    a = parseInt(a);
    c = parseInt(c);
    k = k.split("|");
    while (c--) {
      if (k[c]) {
        const word = unbase(c, a);
        const regex = new RegExp("\\b" + word + "\\b", "g");
        p = p.replace(regex, k[c]);
      }
    }
    return p;
  } catch (e) {
    return code;
  }
}

// src/mycima/extractors.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
var import_crypto_js = __toESM(require("crypto-js"));
function hexDecode(hex) {
  let str = "";
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
}
function getEmbedUrl(url) {
  if (url.includes("/d/"))
    return url.replace("/d/", "/v/");
  if (url.includes("/download/"))
    return url.replace("/download/", "/v/");
  if (url.includes("/file/"))
    return url.replace("/file/", "/v/");
  if (url.includes("/f/"))
    return url.replace("/f/", "/v/");
  if (url.includes("/e/"))
    return url.replace("/e/", "/v/");
  if (url.includes("/embed/"))
    return url.replace("/embed/", "/v/");
  return url;
}
function vidStackExtractor(url) {
  return __async(this, null, function* () {
    try {
      let hash = "";
      if (url.includes("#")) {
        hash = url.split("#").pop();
      } else {
        hash = url.split("/").filter(Boolean).pop();
      }
      if (!hash)
        return [];
      const urlObj = new URL(url);
      const baseurl = `${urlObj.protocol}//${urlObj.hostname}`;
      const apiUrl = `${baseurl}/api/v1/video?id=${hash}`;
      const response = yield fetch(apiUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      if (!response.ok) {
        const altApiUrl = `${baseurl}/api/video?id=${hash}`;
        const altRes = yield fetch(altApiUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
        if (!altRes.ok)
          return [];
        const encoded2 = (yield altRes.text()).trim();
        return yield decryptVidStack(encoded2, url);
      }
      const encoded = (yield response.text()).trim();
      return yield decryptVidStack(encoded, url);
    } catch (e) {
      return [];
    }
  });
}
function decryptVidStack(encoded, url) {
  return __async(this, null, function* () {
    var _a, _b;
    const key = import_crypto_js.default.enc.Utf8.parse("kiemtienmua911ca");
    const ivs = ["1234567890oiuytr", "0123456789abcdef"];
    for (const ivStr of ivs) {
      try {
        const iv = import_crypto_js.default.enc.Utf8.parse(ivStr);
        const decrypted = import_crypto_js.default.AES.decrypt(
          { ciphertext: import_crypto_js.default.enc.Hex.parse(encoded) },
          key,
          { iv, mode: import_crypto_js.default.mode.CBC, padding: import_crypto_js.default.pad.Pkcs7 }
        );
        const decryptedText = decrypted.toString(import_crypto_js.default.enc.Utf8);
        if (decryptedText && decryptedText.includes("source")) {
          const m3u8 = (_b = (_a = decryptedText.match(/"source":"(.*?)"/)) == null ? void 0 : _a[1]) == null ? void 0 : _b.replace(/\\/g, "");
          if (m3u8) {
            return [{
              source: "Vidstack",
              quality: "M3U8",
              url: m3u8,
              headers: { "Referer": url }
            }];
          }
        }
      } catch (e) {
      }
    }
    return [];
  });
}
function vidHideExtractor(url) {
  return __async(this, null, function* () {
    try {
      const embedUrl = getEmbedUrl(url);
      const res = yield fetch(embedUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      if (!res.ok)
        return [];
      const html = yield res.text();
      if (html.includes("File is no longer available"))
        return [];
      let content = html;
      if (html.includes("eval(function(p,a,c,k,e,d)")) {
        content = jsUnpack(html);
      }
      const m3u8Matches = [...content.matchAll(/:\s*["'](.*?m3u8.*?)["']/g)];
      const streams = [];
      for (const match of m3u8Matches) {
        let m3u8Url = match[1];
        if (m3u8Url.startsWith("//"))
          m3u8Url = "https:" + m3u8Url;
        streams.push({
          source: "VidHide",
          quality: "Unknown",
          url: m3u8Url,
          headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: embedUrl })
        });
      }
      if (streams.length > 0)
        return streams;
      const $ = import_cheerio_without_node_native.default.load(html);
      const form = $("form#F1");
      if (form.length > 0) {
        const action = form.attr("action");
        const formData = new URLSearchParams();
        form.find("input[type=hidden]").each((i, el) => {
          formData.append($(el).attr("name"), $(el).attr("value"));
        });
        if (!formData.get("file_code")) {
          const code = embedUrl.split("/").filter(Boolean).pop();
          formData.set("file_code", code);
        }
        const urlObj = new URL(embedUrl);
        const postUrl = action.startsWith("http") ? action : `${urlObj.protocol}//${urlObj.hostname}${action}`;
        const postRes = yield fetch(postUrl, {
          method: "POST",
          headers: __spreadProps(__spreadValues({}, HEADERS), { "Content-Type": "application/x-www-form-urlencoded", Referer: embedUrl }),
          body: formData.toString()
        });
        if (postRes.ok) {
          const postHtml = yield postRes.text();
          return yield genericExtractor(postHtml, postUrl);
        }
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}
function doodStreamExtractor(url) {
  return __async(this, null, function* () {
    var _a;
    try {
      const res = yield fetch(url, { headers: HEADERS });
      const html = yield res.text();
      const md5 = (_a = html.match(/\/pass_md5\/([^'"]+)/)) == null ? void 0 : _a[1];
      if (!md5)
        return [];
      const passRes = yield fetch(`https://dood.re/pass_md5/${md5}`, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      const passContent = yield passRes.text();
      const finalUrl = passContent + "abc?token=" + md5 + "&expiry=" + Date.now();
      return [{
        source: "DoodStream",
        quality: "Unknown",
        url: finalUrl,
        headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url })
      }];
    } catch (e) {
      return [];
    }
  });
}
function streamTapeExtractor(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: HEADERS });
      const html = yield res.text();
      const match = html.match(/id="videolink">([^<]+)/);
      if (match) {
        let videoUrl = "https:" + match[1];
        return [{
          source: "StreamTape",
          quality: "Unknown",
          url: videoUrl,
          headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url })
        }];
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}
function mixDropExtractor(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: HEADERS });
      const html = yield res.text();
      if (html.includes("eval(function(p,a,c,k,e,d)")) {
        const unpacked = jsUnpack(html);
        const match = unpacked.match(/wurl="([^"]+)"/);
        if (match) {
          let videoUrl = match[1];
          if (videoUrl.startsWith("//"))
            videoUrl = "https:" + videoUrl;
          return [{
            source: "MixDrop",
            quality: "Unknown",
            url: videoUrl,
            headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url })
          }];
        }
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}
function filemoonExtractor(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      const html = yield res.text();
      let content = html;
      if (html.includes("eval(function(p,a,c,k,e,d)")) {
        content = jsUnpack(html);
      }
      const fileMatch = content.match(/file\s*:\s*["'](http[^"']+)["']/);
      if (fileMatch) {
        return [{ source: "Filemoon", quality: "Unknown", url: fileMatch[1], headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) }];
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}
function govidExtractor(url) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      const html = yield res.text();
      const hexMatch = html.match(/const\s+\w+\s*=\s*["']([0-9a-f]{20,})["']/i);
      if (hexMatch) {
        const decodedUrl = hexDecode(hexMatch[1]);
        if (decodedUrl.startsWith("http")) {
          return [{ source: "Govid", quality: "Unknown", url: decodedUrl, headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) }];
        }
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}
function genericExtractor(html, url) {
  return __async(this, null, function* () {
    try {
      let content = html;
      if (!content && url) {
        const res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
        content = yield res.text();
      }
      if (content.includes("eval(function(p,a,c,k,e,d)")) {
        content = jsUnpack(content);
      }
      const m3u8Match = content.match(/["'](http[^"']+\.m3u8[^"']*)["']/);
      if (m3u8Match) {
        return [{ source: "Generic HLS", quality: "Unknown", url: m3u8Match[1], headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) }];
      }
      const mp4Match = content.match(/["'](http[^"']+\.mp4[^"']*)["']/);
      if (mp4Match) {
        return [{ source: "Generic MP4", quality: "Unknown", url: mp4Match[1], headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) }];
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}
function loadExtractor(url) {
  return __async(this, null, function* () {
    try {
      const domain = new URL(url).hostname;
      if (domain.includes("fsdcmo") || domain.includes("hglink") || domain.includes("dingtezuni") || domain.includes("vidhide") || domain.includes("earnvids") || domain.includes("filelions") || domain.includes("smoothpre") || domain.includes("dhtpre") || domain.includes("peytonepre") || domain.includes("ryderjet") || domain.includes("abstream")) {
        return yield vidHideExtractor(url);
      }
      if (domain.includes("vidstack") || domain.includes("hubstream") || domain.includes("bigwarp") || domain.includes("mxdrop") || domain.includes("wasuytm") || domain.includes("upn.one") || domain.includes("server1.uns") || domain.includes("kumi.uns")) {
        return yield vidStackExtractor(url);
      }
      if (domain.includes("dood"))
        return yield doodStreamExtractor(url);
      if (domain.includes("streamtape"))
        return yield streamTapeExtractor(url);
      if (domain.includes("mixdrop"))
        return yield mixDropExtractor(url);
      if (domain.includes("filemoon"))
        return yield filemoonExtractor(url);
      if (domain.includes("govid"))
        return yield govidExtractor(url);
      return yield genericExtractor(null, url);
    } catch (e) {
      return [];
    }
  });
}

// src/mycima/index.js
function search(query) {
  return __async(this, null, function* () {
    const url = `${MAIN_URL}/filtering/?keywords=${encodeURIComponent(query)}`;
    const response = yield fetch(url, { headers: HEADERS });
    if (!response.ok)
      return [];
    const html = yield response.text();
    const $ = import_cheerio_without_node_native2.default.load(html);
    return $("div.GridItem").map((i, el) => {
      const $el = $(el);
      const link = $el.find("div.Thumb--GridItem a");
      const title = $el.find("div.Thumb--GridItem strong").text().trim();
      const url2 = link.attr("href");
      const poster = getImageURL($el.find("span.BG--GridItem").attr("data-lazy-style"));
      const yearMatch = $el.find("span.year").text().match(/\d+/);
      const year = yearMatch ? parseInt(yearMatch[0]) : null;
      return { title, url: url2, poster, year };
    }).get();
  });
}
function getStreams(tmdbId, mediaType = "movie", season = null, episode = null) {
  return __async(this, null, function* () {
    try {
      const mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      const searchResults = yield search(mediaInfo.title);
      if (searchResults.length === 0)
        return [];
      const bestMatch = findBestTitleMatch(mediaInfo, searchResults, mediaType, season);
      const selectedMedia = bestMatch || searchResults[0];
      const response = yield fetch(selectedMedia.url, { headers: HEADERS });
      const html = yield response.text();
      const $ = import_cheerio_without_node_native2.default.load(html);
      let finalPageUrl = selectedMedia.url;
      if (mediaType === "tv") {
        let postId = "";
        $("script").each((i, el) => {
          const scriptData = $(el).html() || "";
          const match = scriptData.match(/post_id:\s*'(\d+)'/);
          if (match)
            postId = match[1];
        });
        if (postId) {
          const seasonElements = $("div.SeasonsList ul li a[data-season]");
          let seasonId = "";
          seasonElements.each((i, el) => {
            const $el = $(el);
            const sText = $el.text();
            const sNumMatch = sText.match(/\d+/);
            const sNum = sNumMatch ? parseInt(sNumMatch[0]) : i + 1;
            if (sNum === season) {
              seasonId = $el.attr("data-season");
            }
          });
          if (!seasonId && seasonElements.length > 0) {
            seasonId = seasonElements.first().attr("data-season");
          }
          if (seasonId) {
            const ajaxUrl = `${MAIN_URL}/wp-content/themes/mycima/Ajaxt/Single/Episodes.php`;
            const formData = new URLSearchParams();
            formData.append("season", seasonId);
            formData.append("post_id", postId);
            const ajaxResponse = yield fetch(ajaxUrl, {
              method: "POST",
              headers: __spreadProps(__spreadValues({}, HEADERS), { "Content-Type": "application/x-www-form-urlencoded" }),
              body: formData.toString()
            });
            const ajaxHtml = yield ajaxResponse.text();
            const $ep = import_cheerio_without_node_native2.default.load(ajaxHtml);
            const episodesList = $ep("a");
            episodesList.each((i, el) => {
              const $el = $(el);
              const epTitle = $el.find(".EpisodeTitle").text().trim() || $el.text().trim();
              const epNumMatch = epTitle.match(/\d+/);
              const epNum = epNumMatch ? parseInt(epNumMatch[0]) : i + 1;
              if (epNum === episode) {
                finalPageUrl = $el.attr("href");
              }
            });
          }
        }
      }
      const finalResponse = yield fetch(finalPageUrl, { headers: HEADERS });
      const finalHtml = yield finalResponse.text();
      const $final = import_cheerio_without_node_native2.default.load(finalHtml);
      const streams = [];
      const generalQuality = $final("div.Quality a").text().trim() || "Unknown";
      const downloadLinks = $final("div.Download--Wecima--Single a");
      for (const el of downloadLinks.get()) {
        const $el = $(el);
        const url = $el.attr("href");
        const serverName = $el.find("quality").text().trim() || "Unknown";
        const resText = $el.find("resolution").text().trim();
        const qualityMatch = resText.match(/\d+p/i) || generalQuality.match(/\d+p/i);
        const quality = qualityMatch ? qualityMatch[0] : "Unknown";
        if (url && url.startsWith("http")) {
          if (url.includes(".mp4") || url.includes(".m3u8")) {
            streams.push({
              name: `MyCima ${serverName}`,
              title: `Server ${serverName} (${quality})`,
              url,
              quality,
              headers: HEADERS,
              provider: "mycima"
            });
          } else {
            const extracted = yield loadExtractor(url);
            extracted.forEach((s) => {
              streams.push(__spreadProps(__spreadValues({}, s), {
                name: `MyCima ${serverName} (${s.source})`,
                title: `Extracted ${s.source} (${s.quality === "Unknown" ? quality : s.quality})`,
                provider: "mycima"
              }));
            });
          }
        }
      }
      const watchItems = $final("ul#watch li");
      for (const item of watchItems.get()) {
        const encodedUrl = $final(item).attr("data-watch");
        const serverName = $final(item).text().trim() || "Server";
        if (encodedUrl && encodedUrl.includes("/play/")) {
          const base64String = encodedUrl.substring(encodedUrl.indexOf("/play/") + 6).replace(/\/$/, "");
          try {
            let decodedUrl = atob(base64String);
            if (decodedUrl && !decodedUrl.startsWith("http")) {
              if (decodedUrl.startsWith("//"))
                decodedUrl = "https:" + decodedUrl;
              else if (decodedUrl.startsWith("/"))
                decodedUrl = MAIN_URL + decodedUrl;
            }
            if (decodedUrl && decodedUrl.startsWith("http")) {
              const extracted = yield loadExtractor(decodedUrl);
              if (extracted.length > 0) {
                extracted.forEach((s) => {
                  streams.push(__spreadProps(__spreadValues({}, s), {
                    name: `MyCima ${serverName} (${s.source})`,
                    title: `Watch ${serverName} (${s.quality === "Unknown" ? generalQuality : s.quality})`,
                    provider: "mycima"
                  }));
                });
              }
            }
          } catch (e) {
          }
        }
      }
      return streams;
    } catch (error) {
      return [];
    }
  });
}
module.exports = { getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "mycima", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "MyCima", "mycima");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
