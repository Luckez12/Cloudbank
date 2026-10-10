// Imported provider: showbox-v2; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
const cheerio = require("cheerio-without-node-native");
const CryptoJS = require("crypto-js");
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_API_BASE = "https://id-mapping-api-showbox-proxy.hf.space/api/media";
const WORKING_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json"
};
function getUiToken() {
  try {
    let rawToken = "";
    if (typeof global !== "undefined" && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.uiToken) {
      rawToken = String(global.SCRAPER_SETTINGS.uiToken).trim();
    } else if (typeof window !== "undefined" && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.uiToken) {
      rawToken = String(window.SCRAPER_SETTINGS.uiToken).trim();
    }
    if (!rawToken)
      return "";
    if (rawToken.startsWith("eyJ")) {
      console.log("[ShowBox] Base64 JWT/JSON token detected. Attempting automatic decryption...");
      try {
        const parsedWords = CryptoJS.enc.Base64.parse(rawToken);
        const decodedStr = parsedWords.toString(CryptoJS.enc.Utf8);
        const parsed = JSON.parse(decodedStr);
        if (parsed && parsed.encrypt_data) {
          const IV_KEY = "wEiphTn!";
          const DES_KEY = "123d6cedf626dy54233aa1w6";
          const key = CryptoJS.enc.Utf8.parse(DES_KEY);
          const iv = CryptoJS.enc.Utf8.parse(IV_KEY);
          const decrypted = CryptoJS.TripleDES.decrypt(
            parsed.encrypt_data,
            key,
            {
              iv,
              mode: CryptoJS.mode.CBC,
              padding: CryptoJS.pad.Pkcs7
            }
          );
          const decryptedText = decrypted.toString(CryptoJS.enc.Utf8);
          console.log("[ShowBox] Decrypted successfully:", decryptedText);
          const decryptedJson = JSON.parse(decryptedText);
          if (decryptedJson && decryptedJson.uid) {
            console.log("[ShowBox] Extracted UID from payload:", decryptedJson.uid);
            return String(decryptedJson.uid);
          }
        }
      } catch (err) {
        console.error("[ShowBox] Failed to decrypt base64 uiToken:", err.message);
      }
    }
    return rawToken;
  } catch (e) {
  }
  return "";
}
function getOssGroup() {
  try {
    if (typeof global !== "undefined" && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.ossGroup) {
      return String(global.SCRAPER_SETTINGS.ossGroup);
    }
    if (typeof window !== "undefined" && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.ossGroup) {
      return String(window.SCRAPER_SETTINGS.ossGroup);
    }
  } catch (e) {
  }
  return null;
}
function getApiBase() {
  try {
    if (typeof global !== "undefined" && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.apiBase) {
      return String(global.SCRAPER_SETTINGS.apiBase);
    }
    if (typeof window !== "undefined" && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.apiBase) {
      return String(window.SCRAPER_SETTINGS.apiBase);
    }
  } catch (e) {
  }
  return DEFAULT_API_BASE;
}
function getQualityFromName(qualityStr) {
  if (!qualityStr)
    return "Unknown";
  const quality = qualityStr.toUpperCase();
  if (quality === "ORG" || quality === "ORIGINAL")
    return "Original";
  if (quality === "4K" || quality === "2160P")
    return "4K";
  if (quality === "1440P" || quality === "2K")
    return "1440p";
  if (quality === "1080P" || quality === "FHD")
    return "1080p";
  if (quality === "720P" || quality === "HD")
    return "720p";
  if (quality === "480P" || quality === "SD")
    return "480p";
  if (quality === "360P")
    return "360p";
  if (quality === "240P")
    return "240p";
  const match = qualityStr.match(/(\d{3,4})[pP]?/);
  if (match) {
    const resolution = parseInt(match[1]);
    if (resolution >= 2160)
      return "4K";
    if (resolution >= 1440)
      return "1440p";
    if (resolution >= 1080)
      return "1080p";
    if (resolution >= 720)
      return "720p";
    if (resolution >= 480)
      return "480p";
    if (resolution >= 360)
      return "360p";
    return "240p";
  }
  return "Unknown";
}
function formatFileSize(sizeStr) {
  if (!sizeStr)
    return "Unknown";
  if (typeof sizeStr === "string" && (sizeStr.includes("GB") || sizeStr.includes("MB") || sizeStr.includes("KB"))) {
    return sizeStr;
  }
  if (typeof sizeStr === "number") {
    const gb = sizeStr / (1024 * 1024 * 1024);
    if (gb >= 1)
      return `${gb.toFixed(2)} GB`;
    const mb = sizeStr / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }
  return sizeStr;
}
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    try {
      const response = yield fetch(url);
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
      const data = yield response.json();
      const title = mediaType === "tv" ? data.name : data.title;
      const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
      const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
      return { title, year };
    } catch (e) {
      console.log(`[ShowBox] TMDB details query failed: ${e.message}`);
      return { title: `TMDB ID ${tmdbId}`, year: null };
    }
  });
}
function extractFebBoxShare(showboxId, mediaType, seasonNum, episodeNum, uiToken) {
  return __async(this, null, function* () {
    const streams = [];
    try {
      const boxType = mediaType === "tv" ? 2 : 1;
      const sharePageUrl = `https://www.febbox.com/mbp/to_share_page?box_type=${boxType}&mid=${showboxId}&json=1`;
      console.log(`[ShowBox] Requesting FebBox share link: ${sharePageUrl}`);
      const shareRes = yield fetch(sharePageUrl).then((res) => res.json());
      if (!shareRes || shareRes.code !== 1 || !shareRes.data) {
        console.log(`[ShowBox] FebBox share link not found for ShowBox ID: ${showboxId}`);
        return [];
      }
      const shareLink = shareRes.data.share_link || shareRes.data.shareLink;
      if (!shareLink)
        return [];
      const shareKey = shareLink.split("/").pop();
      console.log(`[ShowBox] Resolved FebBox Share Key: ${shareKey}`);
      const listUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}`;
      const listRes = yield fetch(listUrl, { headers: { "Accept-Language": "en" } }).then((res) => res.json());
      if (!listRes || listRes.code !== 1 || !listRes.data || !listRes.data.file_list) {
        console.log(`[ShowBox] Failed to list files for Share Key: ${shareKey}`);
        return [];
      }
      let fids = [];
      if (mediaType === "movie") {
        fids = listRes.data.file_list;
      } else {
        const seasonName = `season ${seasonNum}`;
        const seasonFolder = listRes.data.file_list.find((f) => f.file_name && f.file_name.toLowerCase() === seasonName);
        if (!seasonFolder) {
          console.log(`[ShowBox] Season folder not found: ${seasonName}`);
          return [];
        }
        const seasonListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${seasonFolder.fid}&page=1`;
        const seasonRes = yield fetch(seasonListUrl, { headers: { "Accept-Language": "en" } }).then((res) => res.json());
        if (!seasonRes || seasonRes.code !== 1 || !seasonRes.data || !seasonRes.data.file_list) {
          console.log(`[ShowBox] Failed to list episodes under season folder`);
          return [];
        }
        const seasonSlug = String(seasonNum).padStart(2, "0");
        const episodeSlug = String(episodeNum).padStart(2, "0");
        fids = seasonRes.data.file_list.filter(
          (f) => f.file_name && (f.file_name.toLowerCase().includes(`s${seasonSlug}e${episodeSlug}`) || f.file_name.toLowerCase().includes(`s${seasonNum}e${episodeNum}`))
        );
      }
      console.log(`[ShowBox] Found ${fids.length} matching file(s) in FebBox share`);
      const videoHeaders = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.8",
        "Connection": "keep-alive",
        "Range": "bytes=0-",
        "Referer": "https://www.febbox.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      };
      const formattedCookie = uiToken.startsWith("ui=") ? uiToken : `ui=${uiToken}`;
      for (const file of fids) {
        const qualityUrl = `https://www.febbox.com/console/video_quality_list?fid=${file.fid}&share_key=${shareKey}`;
        console.log(`[ShowBox] Fetching video qualities for file: ${file.file_name}`);
        const qualityRes = yield fetch(qualityUrl, {
          headers: {
            "Cookie": formattedCookie
          }
        }).then((res) => res.json()).catch(() => null);
        if (!qualityRes || !qualityRes.html) {
          console.log(`[ShowBox] Failed to fetch qualities (is your FebBox UI Token cookie expired?)`);
          continue;
        }
        const $ = cheerio.load(qualityRes.html);
        $("div.file_quality").each((i, el) => {
          const $quality = $(el);
          const streamUrl = $quality.attr("data-url");
          const qualityLabel = $quality.attr("data-quality");
          const sizeText = $quality.find(".size").text().trim();
          if (streamUrl) {
            const normalizedQuality = getQualityFromName(qualityLabel);
            streams.push({
              name: `ShowBox FebBox [${normalizedQuality}]`,
              title: file.file_name,
              url: streamUrl,
              quality: normalizedQuality,
              size: sizeText || file.file_size || "Unknown",
              headers: videoHeaders,
              provider: "showbox"
            });
            console.log(`[ShowBox] Extracted in-built FebBox stream: ${normalizedQuality} (${sizeText})`);
          }
        });
      }
    } catch (e) {
      console.error(`[ShowBox] In-built share extraction error: ${e.message}`);
    }
    return streams;
  });
}
function processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum) {
  const streams = [];
  try {
    if (!data || !data.success)
      return streams;
    if (!data.versions || !Array.isArray(data.versions) || data.versions.length === 0)
      return streams;
    let streamTitle = mediaInfo.title || "Unknown Title";
    if (mediaInfo.year)
      streamTitle += ` (${mediaInfo.year})`;
    if (mediaType === "tv" && seasonNum && episodeNum) {
      streamTitle = `${mediaInfo.title || "Unknown"} S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
      if (mediaInfo.year)
        streamTitle += ` (${mediaInfo.year})`;
    }
    data.versions.forEach(function(version, versionIndex) {
      const versionName = version.name || `Version ${versionIndex + 1}`;
      const versionSize = version.size || "Unknown";
      if (version.links && Array.isArray(version.links)) {
        version.links.forEach(function(link) {
          if (!link.url)
            return;
          const normalizedQuality = getQualityFromName(link.quality || "Unknown");
          const linkSize = link.size || versionSize;
          let streamName = "ShowBox";
          if (data.versions.length > 1) {
            streamName += ` V${versionIndex + 1}`;
          }
          streamName += ` ${normalizedQuality}`;
          streams.push({
            name: streamName,
            title: streamTitle,
            url: link.url,
            quality: normalizedQuality,
            size: formatFileSize(linkSize),
            provider: "showbox",
            speed: link.speed || null
          });
        });
      }
    });
  } catch (error) {
    console.error(`[ShowBox] Error processing response: ${error.message}`);
  }
  return streams;
}
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  return __async(this, null, function* () {
    console.log(`[ShowBox] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    const uiToken = getUiToken();
    const ossGroup = getOssGroup();
    const apiBase = getApiBase();
    if (!uiToken) {
      console.error("[ShowBox] No UI token (cookie) found in settings. Go to Scraper Settings to configure.");
      return [];
    }
    try {
      const mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      let proxyUrl;
      if (mediaType === "tv" && seasonNum && episodeNum) {
        if (ossGroup) {
          proxyUrl = `${apiBase}/tv/${tmdbId}/oss=${ossGroup}/${seasonNum}/${episodeNum}?cookie=${encodeURIComponent(uiToken)}`;
        } else {
          proxyUrl = `${apiBase}/tv/${tmdbId}/${seasonNum}/${episodeNum}?cookie=${encodeURIComponent(uiToken)}`;
        }
      } else {
        proxyUrl = `${apiBase}/movie/${tmdbId}?cookie=${encodeURIComponent(uiToken)}`;
      }
      console.log(`[ShowBox] Querying proxy API: ${proxyUrl}`);
      let showboxId = null;
      let streams = [];
      try {
        const response = yield fetch(proxyUrl, { headers: WORKING_HEADERS });
        if (response.ok) {
          const data = yield response.json();
          streams = processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum);
          if (data.id || data.mid) {
            showboxId = data.id || data.mid;
          } else if (data.data && (data.data.id || data.data.mid)) {
            showboxId = data.data.id || data.data.mid;
          }
        }
      } catch (e) {
        console.log(`[ShowBox] Proxy server lookup failed/offline: ${e.message}`);
      }
      if (showboxId) {
        console.log(`[ShowBox] Resolving direct streams using in-built FebBox share extractor for ShowBox ID: ${showboxId}`);
        const directStreams = yield extractFebBoxShare(showboxId, mediaType, seasonNum, episodeNum, uiToken);
        if (directStreams.length > 0) {
          streams = streams.concat(directStreams);
        }
      }
      if (streams.length === 0) {
        console.log(`[ShowBox] No streams found.`);
        return [];
      }
      streams.sort(function(a, b) {
        const qualityOrder = {
          "Original": 6,
          "4K": 5,
          "1440p": 4,
          "1080p": 3,
          "720p": 2,
          "480p": 1,
          "360p": 0,
          "240p": -1,
          "Unknown": -2
        };
        return (qualityOrder[b.quality] || -2) - (qualityOrder[a.quality] || -2);
      });
      return streams;
    } catch (error) {
      console.error(`[ShowBox] Scraper execution failure: ${error.message}`);
      return [];
    }
  });
}
function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "ShowBox Configuration" },
      {
        type: "text",
        isPassword: true,
        key: "uiToken",
        label: "FebBox UI Token (Cookie)",
        placeholder: "ui=...",
        description: "Go to febbox.com, login, and copy your 'ui' cookie value from your browser."
      },
      {
        type: "text",
        key: "ossGroup",
        label: "FebBox OSS Group (Optional)",
        placeholder: "",
        description: "Optional OSS group parameter."
      }
    ];
  });
}
module.exports = { getStreams, onSettings };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "showbox-v2", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "ShowBox V2", "showbox-v2");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
/* CLOUDBANK_STREAM_DISPLAY_END */
