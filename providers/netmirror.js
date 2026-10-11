// Imported provider: netmirror; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
 * netmirror - Built from src/netmirror/
 * Generated: 2026-09-26T18:41:31.637Z
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
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

// src/netmirror/constants.js
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var PLATFORM_MAP = {
  netflix: {
    ott: "nf",
    search: "/mobile/search.php",
    post: "/mobile/post.php",
    episodes: "/mobile/episodes.php",
    playlist: "/mobile/playlist.php",
    img: "poster/v",
    epImg: "epimg/150"
  },
  primevideo: {
    ott: "pv",
    search: "/mobile/pv/search.php",
    post: "/mobile/pv/post.php",
    episodes: "/mobile/pv/episodes.php",
    playlist: "/mobile/pv/playlist.php",
    img: "pv/v",
    epImg: "pvepimg"
  },
  hotstar: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    img: "hs/v",
    epImg: "hsepimg"
  },
  disney: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    img: "hs/v",
    epImg: "hsepimg"
  }
};
var BASE_HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive",
  "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Android WebView";v="144"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Android"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0",
  "X-Requested-With": "XMLHttpRequest"
};

// src/netmirror/utils.js
var COOKIE_TTL = 54e6;
var VERIFY_ATTEMPTS = 7;
var VERIFY_DELAY = 1e4;
var APP_USER_AGENT = "Mozilla/5.0 (Linux; Android 12; RMX2117 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.55 Mobile Safari/537.36 /OS.Gatu v3.0";
var cookieValue = "";
var cookieTimestamp = 0;
var cookieJar = [];
var delayModeLogged = false;
function setCookieValues(headers) {
  var _a, _b;
  if (!headers)
    return [];
  if (typeof headers.getSetCookie === "function") {
    try {
      return headers.getSetCookie();
    } catch (e) {
    }
  }
  const raw = ((_a = headers.get) == null ? void 0 : _a.call(headers, "set-cookie")) || ((_b = headers.get) == null ? void 0 : _b.call(headers, "Set-Cookie")) || "";
  return raw.split(/,(?=\s*[^;,\s]+=)/g).map((value) => value.trim()).filter(Boolean);
}
function rememberResponseCookies(headers, responseUrl) {
  const host = new URL(responseUrl).hostname.toLowerCase();
  for (const raw of setCookieValues(headers)) {
    const pair = raw.split(";", 1)[0];
    const equals = pair.indexOf("=");
    if (equals <= 0)
      continue;
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    const domainMatch = raw.match(/(?:^|;)\s*domain=([^;]+)/i);
    const domain = (domainMatch ? domainMatch[1] : host).trim().replace(/^\./, "").toLowerCase();
    const index = cookieJar.findIndex((cookie2) => cookie2.name === name && cookie2.domain === domain);
    if (/max-age\s*=\s*0/i.test(raw) || !value) {
      if (index >= 0)
        cookieJar.splice(index, 1);
      continue;
    }
    const cookie = { name, value, domain };
    if (index >= 0)
      cookieJar[index] = cookie;
    else
      cookieJar.push(cookie);
  }
}
function cookieHeaderFor(url) {
  const host = new URL(url).hostname.toLowerCase();
  return cookieJar.filter((cookie) => host === cookie.domain || host.endsWith(`.${cookie.domain}`)).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
function request(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const headers = __spreadValues({}, options.headers || {});
    const cookieHeader = cookieHeaderFor(url);
    if (cookieHeader)
      headers.Cookie = cookieHeader;
    const response = yield fetch(url, __spreadProps(__spreadValues({}, options), { headers }));
    rememberResponseCookies(response.headers, response.url || url);
    return response;
  });
}
function getCookie(name) {
  var _a;
  return ((_a = cookieJar.find((cookie) => cookie.name === name)) == null ? void 0 : _a.value) || "";
}
function logDelayMode(mode) {
  if (delayModeLogged)
    return;
  delayModeLogged = true;
  console.log(`[NetMirror] Delay implementation: ${mode}`);
}
function delay(ms) {
  if (typeof setTimeout === "function") {
    logDelayMode("setTimeout (runtime timer)");
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return Promise.resolve().then(() => {
    if (typeof SharedArrayBuffer === "function" && typeof Atomics !== "undefined" && typeof Atomics.wait === "function") {
      try {
        logDelayMode("Atomics.wait fallback");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
        return;
      } catch (e) {
      }
    }
    logDelayMode("synchronous busy-wait fallback");
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
    }
  });
}
function bypass(mainUrl) {
  return __async(this, null, function* () {
    var _a;
    if (cookieValue && Date.now() - cookieTimestamp < COOKIE_TTL)
      return cookieValue;
    const base = String(mainUrl || "https://net52.cc").replace(/\/$/, "");
    const homeUrl = `${base}/mobile/home?app=1`;
    const appHeaders = {
      "User-Agent": APP_USER_AGENT,
      "X-Requested-With": "app.netmirror.netmirrornew"
    };
    try {
      console.log("[NetMirror] Starting mobile cookie verification...");
      cookieJar = [];
      const homeResponse = yield request(homeUrl, { headers: appHeaders });
      const homeHtml = yield homeResponse.text();
      if (!homeResponse.ok)
        throw new Error(`Mobile home returned HTTP ${homeResponse.status}`);
      const addhash = (_a = homeHtml.match(/data-addhash\s*=\s*["']([^"']+)["']/i)) == null ? void 0 : _a[1];
      if (!addhash)
        throw new Error("NetMirror mobile home did not provide data-addhash");
      const userverUrl = `https://userver.net52.cc/?hee5=${encodeURIComponent(addhash)}&a=y&t=${Math.random()}`;
      const userverResponse = yield request(userverUrl, { headers: appHeaders });
      yield userverResponse.text();
      const verifyUrl = `${base}/mobile/verify2.php`;
      const verifyHeaders = {
        "User-Agent": APP_USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded"
      };
      for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
        yield delay(VERIFY_DELAY);
        const response = yield request(verifyUrl, {
          method: "POST",
          headers: verifyHeaders,
          body: `verify=${encodeURIComponent(addhash)}`
        });
        const text = yield response.text();
        let allDone = text.includes('"statusup":"All Done"');
        if (!allDone) {
          try {
            allDone = JSON.parse(text).statusup === "All Done";
          } catch (e) {
          }
        }
        if (!allDone) {
          console.log(`[NetMirror] Cookie verification pending (attempt ${attempt}/${VERIFY_ATTEMPTS}).`);
          continue;
        }
        const verifiedCookie = getCookie("t_hash_t");
        if (!verifiedCookie)
          throw new Error("Verification completed without a t_hash_t cookie");
        cookieValue = verifiedCookie;
        cookieTimestamp = Date.now();
        console.log("[NetMirror] Mobile cookie verified.");
        return cookieValue;
      }
      throw new Error("Mobile verification did not complete; NetMirror may be waiting for an ad click");
    } catch (error) {
      cookieValue = "";
      cookieTimestamp = 0;
      console.error("[NetMirror] Mobile cookie verification failed:", error.message);
      return "";
    }
  });
}

// src/netmirror/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const preferred = settings.preferredPlatform || "all";
      const tmdbType = mediaType === "tv" ? "tv" : "movie";
      const tmdbResp = yield fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      const tmdbData = yield tmdbResp.json();
      const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
      if (!title)
        throw new Error("Could not fetch title from TMDB");
      let platforms = ["netflix", "primevideo", "hotstar", "disney"];
      if (preferred !== "all") {
        platforms = [preferred, ...platforms.filter((p) => p !== preferred)];
      }
      for (const platformKey of platforms) {
        try {
          const streams = yield fetchFromPlatform(platformKey, title, mediaType, season, episode);
          if (streams && streams.length > 0)
            return streams;
        } catch (e) {
        }
      }
      return [];
    } catch (error) {
      return [];
    }
  });
}
function fetchFromPlatform(platformKey, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    const platform = PLATFORM_MAP[platformKey];
    return fetchMobileContent(platformKey, platform, title, mediaType, season, episode);
  });
}
function fetchMobileContent(platformKey, platform, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    var _a, _b;
    const base = "https://net52.cc";
    const cookie = yield bypass(base);
    const settings = globalThis.SCRAPER_SETTINGS || {};
    const cookies = [];
    if (cookie)
      cookies.push(`t_hash_t=${cookie}`);
    cookies.push(`ott=${platform.ott}`);
    if (settings.forceHd !== false)
      cookies.push("hd=on");
    const headers = __spreadProps(__spreadValues({}, BASE_HEADERS), { Cookie: cookies.join("; ") });
    const getJson = (_0, ..._1) => __async(this, [_0, ..._1], function* (url, referer = `${base}/home`, extraHeaders = {}) {
      const response = yield fetch(url, {
        headers: __spreadValues(__spreadProps(__spreadValues({}, headers), { Referer: referer }), extraHeaders)
      });
      if (!response.ok)
        throw new Error(`NetMirror mobile returned HTTP ${response.status}`);
      return response.json();
    });
    const search = yield getJson(`${base}${platform.search}?s=${encodeURIComponent(title)}&t=${Math.floor(Date.now() / 1e3)}`);
    const results = Array.isArray(search.searchResult) ? search.searchResult : [];
    if (!results.length)
      return null;
    const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const wanted = normalize(title);
    const rank = (item) => {
      const candidate = normalize(item.t || item.title);
      return candidate === wanted ? 0 : candidate.includes(wanted) || wanted.includes(candidate) ? 1 : 2;
    };
    results.sort((a, b) => rank(a) - rank(b));
    const wantedSeason = Number(season);
    const wantedEpisode = Number(episode);
    for (const result of results.slice(0, 8)) {
      if (!result.id)
        continue;
      const post = yield getJson(`${base}${platform.post}?id=${encodeURIComponent(result.id)}&t=${Math.floor(Date.now() / 1e3)}`);
      if (!post || post.status === "n" && post.error)
        continue;
      let targetId = result.id;
      if (mediaType === "tv") {
        if (post.type !== "t" && !(post.episodes || []).some(Boolean))
          continue;
        let episodeEntry = findMobileEpisode(
          post.episodes,
          wantedSeason,
          wantedEpisode,
          ((_b = (_a = post.season) == null ? void 0 : _a.findIndex((s) => s.selected === true)) != null ? _b : -1) + 1
        );
        const seasonEntry = Array.isArray(post.season) ? post.season.find((s) => Number(String(s.s || "").replace(/\D/g, "")) === wantedSeason) : null;
        if (!episodeEntry && (seasonEntry == null ? void 0 : seasonEntry.id)) {
          let page = 1;
          while (page <= 30) {
            const url = `${base}${platform.episodes}?s=${encodeURIComponent(seasonEntry.id)}&series=${encodeURIComponent(result.id)}&t=${Math.floor(Date.now() / 1e3)}&page=${page}`;
            const data = yield getJson(url);
            episodeEntry = findMobileEpisode(data.episodes, wantedSeason, wantedEpisode, wantedSeason);
            if (episodeEntry || !data.nextPageShow || Number(data.nextPageShow) === 0)
              break;
            page++;
          }
        }
        if (!(episodeEntry == null ? void 0 : episodeEntry.id))
          continue;
        targetId = episodeEntry.id;
      } else if (post.type === "t" || (post.episodes || []).some(Boolean)) {
        continue;
      }
      const playlistUrl = `${base}${platform.playlist}?id=${encodeURIComponent(targetId)}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now() / 1e3)}`;
      const playlist = yield getJson(playlistUrl, `${base}/mobile/home?app=1`, {
        "X-Requested-With": "app.netmirror.netmirrornew",
        "Accept": "*/*",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors"
      });
      const entries = Array.isArray(playlist) ? playlist : playlist.playlist || playlist.data || [];
      const streams = [];
      for (const entry of entries) {
        for (const source of entry.sources || []) {
          if (!source.file)
            continue;
          const streamUrl = /^https?:\/\//i.test(source.file) ? source.file : source.file.startsWith("//") ? `https:${source.file}` : `${base}${source.file.startsWith("/") ? "" : "/"}${source.file}`;
          const label = source.label || "Auto";
          const quality = (String(label).match(/\d{3,4}p?/i) || [])[0] || (/full\s*hd/i.test(label) ? "1080p" : /mid\s*hd/i.test(label) ? "720p" : /low\s*hd/i.test(label) ? "480p" : "Auto");
          const playbackHeaders = {
            "Accept": "*/*",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
            "Referer": `${base}/mobile/home?app=1`,
            "sec-ch-ua": '"Android WebView";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Android"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.91 Safari/537.36 /OS.Gatu v3.0",
            "X-Requested-With": "app.netmirror.netmirrornew"
          };
          if (settings.forceHd !== false)
            playbackHeaders.Cookie = "hd=on";
          streams.push({
            name: `NetMirror (${platformKey})`,
            title: mediaType === "tv" ? `${title} S${wantedSeason}E${wantedEpisode} - ${label}` : `${title} - ${label}`,
            url: streamUrl,
            quality,
            headers: playbackHeaders
          });
        }
      }
      if (streams.length)
        return streams;
    }
    return null;
  });
}
function findMobileEpisode(episodes, season, episode, fallbackSeason) {
  if (!Array.isArray(episodes))
    return null;
  return episodes.find((item) => {
    if (!item)
      return false;
    const epNumber = Number(String(item.ep || "").replace(/\D/g, ""));
    const seasonNumber = Number(String(item.s || item.sNum || "").replace(/\D/g, "")) || fallbackSeason;
    return epNumber === episode && seasonNumber === season;
  }) || null;
}
function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "Source Selection" },
      {
        type: "select",
        key: "preferredPlatform",
        label: "Preferred Streaming Source",
        description: "Select which platform to try first. If content isn't found, others will be searched as fallback.",
        options: [
          { label: "All Sources (Ordered)", value: "all" },
          { label: "Netflix", value: "netflix" },
          { label: "Prime Video", value: "primevideo" },
          { label: "Hotstar / Disney+", value: "hotstar" }
        ],
        defaultValue: "all"
      },
      { type: "header", label: "Advanced" },
      {
        type: "toggle",
        key: "forceHd",
        label: "Force HD Quality",
        description: "Attempts to force the player into HD mode when possible.",
        defaultValue: true
      }
    ];
  });
}
module.exports = { getStreams, onSettings };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "netmirror", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
})();

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
module.exports = cloudbankDisplayInstall(module.exports, "NetMirror", "netmirror");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
