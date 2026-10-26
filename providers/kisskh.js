"use strict";
/* VUEO_TITLE_PROFILE_V1 — exact aliases, year and explicit season; no first-result fallback. */
/* VUEO_FAST_DISCOVERY_V1 — one primary API query, bounded alias/host fallback. */
var PROVIDER_NAME = "KissKH";
var VERSION = "1.4.5";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var HOSTS = ["https://kisskh.id", "https://kisskh.do"];
var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var CACHE_SLOT = "__CLOUDBANK_KISSKH_MATCH_V3__";
var localCache = { matches: {}, details: {}, host: "", hostAt: 0 };
var MATCH_TTL = 30 * 24 * 60 * 60 * 1000;
var MAX_MATCHES = 500;

function trace(stage, details) {
  console.log("[KissKH] " + stage + ": " + JSON.stringify(details || {}));
  try { if (typeof globalThis.vueoTrace === "function") globalThis.vueoTrace(stage, details || {}); } catch (_) {}
}
function cacheStore() {
  try {
    if (!globalThis[CACHE_SLOT]) globalThis[CACHE_SLOT] = localCache;
    return globalThis[CACHE_SLOT];
  } catch (_) { return localCache; }
}
function cacheRead(table, key, ttl) {
  var row = table[key];
  if (!row) return null;
  if (Date.now() - row.at >= ttl) { delete table[key]; return null; }
  row.used = Date.now();
  return row;
}
function cacheWrite(table, key, row, limit) {
  row.at = Date.now(); row.used = row.at;
  table[key] = row;
  var keys = Object.keys(table);
  keys.sort(function(a, b) { return table[a].used - table[b].used; });
  while (keys.length > limit) delete table[keys.shift()];
}
function headers(base, referer) {
  return { "User-Agent": USER_AGENT, "Accept": "application/json, text/plain, */*",
    "Referer": referer || base + "/", "Origin": base };
}
function remaining(run) { return Math.max(0, run.deadline - Date.now()); }
function request(run, url, base, kind, timeout, text) {
  var ms = Math.min(timeout, remaining(run));
  if (ms < 100) return Promise.reject(new Error("Provider deadline at " + kind));
  return new Promise(function(resolve, reject) {
    var done = false, started = Date.now(), httpStatus = null;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    function finish(error, value) {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    var timer = setTimeout(function() {
      finish(new Error(kind + " timeout"));
      if (controller) controller.abort();
    }, ms);
    var options = { headers: headers(base), redirect: "follow" };
    if (controller) options.signal = controller.signal;
    Promise.resolve().then(function() { return fetch(url, options); }).then(function(response) {
      if (done) return;
      httpStatus = response && response.status || 0;
      if (!response || !response.ok) {
        var error = new Error(kind + " HTTP " + (response && response.status || 0));
        error.status = response && response.status || 0; throw error;
      }
      return text ? response.text() : response.json();
    }).then(function(value) {
      if (done) return;
      trace("HTTP", { stage: kind, host: base, status: httpStatus, ms: Date.now() - started });
      finish(null, value);
    }, function(error) { finish(error); });
  });
}
function norm(value) {
  var text = String(value || "").toLowerCase();
  if (typeof text.normalize === "function") text = text.normalize("NFKC");
  return text.replace(/&/g, " and ").replace(/[\s\-–—:;,.!?_'"‘’“”()[\]{}\/]+/g, " ").trim();
}
function yearOf(item) {
  var value = item && (item.year || item.releaseYear || item.releaseDate || item.release_date || item.first_air_date) || "";
  var match = String(value).match(/\b((?:19|20)\d{2})\b/);
  if (!match) match = String(item && item.title || "").match(/[([]((?:19|20)\d{2})[)\]]\s*$/);
  return match ? match[1] : "";
}
function titleParts(value) {
  var title = String(value || "").replace(/\s*[([](?:19|20)\d{2}[)\]]\s*$/, "").trim();
  var match = title.match(/(?:\s*[-–—:]\s*|\s+)(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season|s(\d+))\s*$/i);
  return { title: match ? title.slice(0, match.index).trim() : title,
    season: match ? Number(match[1] || match[2] || match[3]) : 1, explicit: !!match };
}
function metadata(run, id, type) {
  var url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(id) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles,translations,external_ids";
  return vueoSharedTmdb(url, function() {
    return request(run, url, "https://api.themoviedb.org", "metadata", 2200, false);
  }).then(function(data) {
    var aliases = collectTmdbAliases(data, type);
    return { title: String(data.title || data.name || "").trim(), aliases: aliases,
      year: yearOf(data), originalTitle: data.original_title || data.original_name || "", raw: data };
  });
}
function acceptsTitle(title, info, type, season) {
  var parsed = titleParts(title);
  if (type === "tv" && parsed.season !== season && !(info.catalogueNumbering && !parsed.explicit)) return false;
  return info.aliases.some(function(alias) {
    return norm(type === "tv" ? titleParts(alias).title : alias) === norm(type === "tv" ? parsed.title : String(title).replace(/\s*[([](?:19|20)\d{2}[)\]]\s*$/, ""));
  });
}
function mediaMatches(detail, type) {
  var value = String(detail.type || detail.mediaType || "").toLowerCase().replace(/[ _-]/g, "");
  if (!value) return true;
  if (/^(movie|film)$/.test(value)) return type === "movie";
  if (/^(tvseries|tv|series|drama)$/.test(value)) return type === "tv";
  return true;
}
function compactDetail(detail, candidate, base, info, type, season) {
  if (!detail || typeof detail !== "object" || !Array.isArray(detail.episodes)) throw new Error("Invalid detail response");
  if (detail.id !== undefined && String(detail.id) !== String(candidate.id)) throw new Error("Drama ID mismatch");
  if (!acceptsTitle(detail.title || candidate.title, info, type, season) || !mediaMatches(detail, type)) throw new Error("Detail title/type/season mismatch");
  var actualYear = yearOf(detail) || yearOf(candidate);
  // Later season release years need not equal the first season's premiere year.
  if ((type === "movie" || season === 1) && info.year && actualYear && actualYear !== info.year) throw new Error("Detail year mismatch");
  var episodes = detail.episodes.filter(function(e) {
    return e && /^\d+$/.test(String(e.id)) && Number.isFinite(Number(e.number));
  }).map(function(e) { return { id: String(e.id), number: Number(e.number) }; });
  if (!episodes.length) throw new Error("No valid episodes");
  if (info.catalogueNumbering && episodes.filter(function(e) { return e.number === info.requestEpisode; }).length !== 1) throw new Error("Exact catalogue episode missing");
  return { id: String(candidate.id), title: String(detail.title || candidate.title), base: base,
    catalogueNumbering: !!info.catalogueNumbering, year: actualYear, episodes: episodes, completed: /^(completed|complete|finished)$/i.test(String(detail.status || "")) };
}
function detailRequest(run, base, candidate, info, type, season) {
  return request(run, base + "/api/DramaList/Drama/" + encodeURIComponent(candidate.id) + "?isq=false", base, "detail", 4000, false)
    .then(function(detail) { return compactDetail(detail, candidate, base, info, type, season); });
}
function selectCandidate(run, base, rows, info, type, season) {
  if (!Array.isArray(rows)) throw new Error("Invalid search schema");
  var candidates = rows.filter(function(row) {
    if (!row || !/^\d+$/.test(String(row.id)) || !acceptsTitle(row.title, info, type, season)) return false;
    var year = yearOf(row);
    return !(info.year && year && (type === "movie" || season === 1) && year !== info.year);
  });
  if (type === "tv" && season === 1 && candidates.some(function(c) { return titleParts(c.title).explicit; })) {
    candidates = candidates.filter(function(c) { return titleParts(c.title).explicit; });
  }
  trace("CANDIDATES", { exact: candidates.length, results: rows.length, season: type === "tv" ? season : null });
  if (!candidates.length && type === "tv" && season > 1 && info.requestEpisode > 1 && !info.catalogueNumbering) {
    // Missing season text is unknown, not proof of season 1. Use the site's
    // numbered catalogue only when one exact unlabelled title is unambiguous.
    // An explicitly season-labelled sibling means this show is split by season.
    var sameTitle = rows.filter(function(row) {
      return row && /^\d+$/.test(String(row.id)) && acceptsTitle(row.title, info, type, titleParts(row.title).season);
    });
    var unlabelled = sameTitle.filter(function(row) { return !titleParts(row.title).explicit; });
    if (unlabelled.length === 1 && sameTitle.length === 1) {
      info.catalogueNumbering = true;
      candidates = unlabelled;
      trace("NUMBERING", { route: "website-catalogue", requestedSeason: season, episode: info.requestEpisode,
        seasonVerified: false, additionalRequests: 0 });
    }
  }
  if (!candidates.length) return Promise.resolve(null);
  if (info.catalogueNumbering && candidates.length !== 1) return Promise.resolve(null);
  // A known year can disambiguate a remake. Unknown duplicate years must be verified in detail.
  var preferred = candidates.filter(function(c) { return info.year && yearOf(c) === info.year; });
  if (preferred.length === 1) candidates = preferred;
  if (candidates.length > 3) { trace("NO_MATCH", { reason: "too many ambiguous exact titles" }); return Promise.resolve(null); }
  return Promise.all(candidates.map(function(candidate) {
    return detailRequest(run, base, candidate, info, type, season).catch(function(error) {
      trace("DETAIL_REJECT", { id: candidate.id, reason: error.message }); return null;
    });
  })).then(function(details) {
    var good = details.filter(Boolean);
    if (candidates.length === 1 && good.length === 1) return good[0];
    if (good.length && info.year) {
      var sameYear = good.filter(function(d) { return d.year === info.year; });
      if (sameYear.length === 1) return sameYear[0];
    }
    if (good.length > 1) trace("NO_MATCH", { reason: "ambiguous exact title/year" });
    return null;
  });
}
function searchDrama(run, info, type, season, store) {
  var bases = HOSTS.slice();
  if (Date.now() - store.hostAt < 30 * 60 * 1000 && bases.indexOf(store.host) >= 0) {
    bases = [store.host].concat(bases.filter(function(b) { return b !== store.host; }));
  }
  var base = bases[0];
  var queries = [info.title, info.originalTitle].concat(info.aliases).filter(function(v, i, all) {
    return v && all.findIndex(function(x) { return norm(x) === norm(v); }) === i;
  }).slice(0, 3);
  var hostFailed = false;
  function queryAt(index) {
    if (index >= queries.length || remaining(run) < 1000) return Promise.resolve(null);
    var query = queries[index];
    function search() {
      trace("SEARCH", { host: base, query: query, attempt: index + 1 });
      return request(run, base + "/api/DramaList/Search?q=" + encodeURIComponent(query) + "&type=0", base, "search", 4000, false)
        .then(function(rows) {
          if (!Array.isArray(rows)) throw new Error("Invalid search schema");
          store.host = base; store.hostAt = Date.now();
          return rows;
        });
    }
    return search().catch(function(error) {
      if (hostFailed) throw error;
      hostFailed = true; base = bases[1];
      trace("HOST_FALLBACK", { host: base, reason: error.message });
      return search();
    }).then(function(rows) {
      return selectCandidate(run, base, rows, info, type, season);
    }).then(function(detail) { return detail || queryAt(index + 1); });
  }
  return queryAt(0);
}
function findDrama(run, id, info, type, season, episode) {
  var store = cacheStore(), key = type + "/" + id + "/" + season;
  function remember(detail) {
    if (!detail) throw new Error("No verified title/season match");
    cacheWrite(store.matches, key, { id: detail.id, title: detail.title, base: detail.base, year: info.year, catalogueNumbering: !!detail.catalogueNumbering }, MAX_MATCHES);
    if (detail.episodes.length <= 1000) cacheWrite(store.details, key, { value: detail }, 32);
    return detail;
  }
  var match = cacheRead(store.matches, key, MATCH_TTL);
  if (match && match.catalogueNumbering) info.catalogueNumbering = true;
  if (match && (match.year !== info.year || HOSTS.indexOf(match.base) < 0 || !acceptsTitle(match.title, info, type, season))) {
    delete store.matches[key]; delete store.details[key]; match = null; info.catalogueNumbering = false;
  }
  if (!match) {
    trace("CACHE", { hit: false });
    return searchDrama(run, info, type, season, store).then(remember);
  }
  trace("CACHE", { hit: true, dramaId: match.id });
  var cached = store.details[key];
  cached = cacheRead(store.details, key, cached && cached.value.completed ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000);
  if (cached && (type === "movie" || cached.value.episodes.some(function(e) { return e.number === episode; }))) return Promise.resolve(cached.value);
  return detailRequest(run, match.base, match, info, type, season).then(remember, function(error) {
    trace("CACHE_INVALID", { reason: error.message });
    delete store.matches[key]; delete store.details[key];
    return searchDrama(run, info, type, season, store).then(remember);
  });
}
function cryptoJs() {
  try { if (globalThis.CryptoJS && globalThis.CryptoJS.AES) return globalThis.CryptoJS; } catch (_) {}
  if (typeof require === "function") { var lib = require("crypto-js"); if (lib && lib.AES) return lib; }
  throw new Error("CryptoJS unavailable");
}
/* Token algorithm retained from the bundled Yoruix KissKH engine (GPL-3.0).
 * Its AES key schedule is equivalent to this AES-128-CBC key/IV. No remote key service. */
function episodeKey(id, subtitle) {
  var parts = ["", String(id), "", "mg3c3b04ba", "2.8.10",
    subtitle ? "VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp" : "62f176f3bb1b5b8e70e39932ad34a0c7",
    "4830201", "kisskh", "kisskh", "kisskh", "kisskh", "kisskh", "kisskh", "00", ""];
  var text = parts.join("|"), hash = 0;
  for (var i = 0; i < text.length; i++) hash = (hash << 5) - hash + text.charCodeAt(i);
  parts.splice(1, 0, String(hash));
  var C = cryptoJs();
  return C.AES.encrypt(parts.join("|"), C.enc.Hex.parse("4f6bdaa39e2f8cb07f5e722d9edef314"), {
    iv: C.enc.Hex.parse("01504af356e619cf2e42bba68c3f70f9"), mode: C.mode.CBC, padding: C.pad.Pkcs7
  }).ciphertext.toString(C.enc.Hex).toUpperCase();
}
function directUrl(value, base) {
  var text = String(value || "").trim();
  if (!text) return "";
  try { var u = new URL(text, base + "/"); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (_) { return ""; }
}
function mediaUrls(source, base) {
  var list = source ? [source.Video, source.ThirdParty] : [];
  return list.map(function(value) { return directUrl(value, base); }).filter(function(url, i, rows) {
    return url && /\.(m3u8|mp4|mkv|mpd)(?:[?#]|$)/i.test(url) && rows.indexOf(url) === i;
  });
}
function captureKeys(run, detail, selected) {
  if (typeof globalThis.webviewResolve !== "function" || remaining(run) < 1000) return Promise.resolve({});
  var slug = detail.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  var page = detail.base + "/Drama/" + slug + "/Episode-" + selected.number + "?id=" + detail.id + "&ep=" + selected.id + "&page=0&pageSize=100";
  var ms = Math.min(3500, remaining(run) - 100);
  trace("KEY_FALLBACK", { method: "episode WebView", episodeId: selected.id });
  return new Promise(function(resolve) {
    var done = false;
    var timer = setTimeout(function() { finish({}); }, ms);
    function finish(value) { if (done) return; done = true; clearTimeout(timer); resolve(value); }
    Promise.resolve().then(function() {
      return globalThis.webviewResolve(page, { referer: detail.base + "/", directLoad: true, timeoutMs: ms,
        suppressPopups: true, lockMainFrameHost: true, finishAfterFirstMs: 250,
        interactionTexts: ["play", "watch"], match: ["/api/DramaList/Episode/", "/api/Sub/"] });
    }).then(function(result) {
      var keys = {}, rows = result && Array.isArray(result.streams) ? result.streams : [];
      rows.forEach(function(row) {
        try {
          var u = new URL(row.url);
          if (u.origin !== detail.base) return;
          var key = u.searchParams.get("kkey"); if (!key) return;
          if (u.pathname === "/api/DramaList/Episode/" + selected.id + ".png") keys.video = key;
          if (u.pathname === "/api/Sub/" + selected.id) keys.sub = key;
        } catch (_) {}
      });
      finish(keys);
    }, function() { finish({}); });
  });
}
function subtitleLanguage(label) {
  var value = String(label || "").trim();
  var code = value.toLowerCase().replace(/_/g, "-").replace(/\s*\([^)]*\)\s*$/, "");
  var groups = { en: ["en", "eng", "english"], ms: ["ms", "msa", "may", "malay", "melayu", "bahasa melayu", "bahasa malaysia"],
    id: ["id", "ind", "indonesian", "bahasa indonesia"], ko: ["ko", "kor", "korean"], zh: ["zh", "chi", "zho", "chinese", "mandarin"],
    ja: ["ja", "jpn", "japanese"], th: ["th", "tha", "thai"], vi: ["vi", "vie", "vietnamese"], fr: ["fr", "fra", "fre", "french"] };
  var labels = { en: "English", ms: "Malay", id: "Indonesian", ko: "Korean", zh: "Chinese", ja: "Japanese", th: "Thai", vi: "Vietnamese", fr: "French" };
  var found = Object.keys(groups).find(function(k) { return groups[k].indexOf(code) >= 0 || new RegExp("^" + k + "-[a-z]{2}$").test(code); });
  return { code: found || (/^[a-z]{2,3}$/.test(code) ? code : "und"), label: found ? labels[found] : value || "Unknown" };
}
function subtitleRowLanguage(row) {
  var values = [row.srclang, row.lang, row.language, row.label], unknown = { code: "und", label: "Unknown" };
  for (var i = 0; i < values.length; i++) {
    if (!values[i] || /^(und|unknown)$/i.test(String(values[i]).trim())) continue;
    var lang = subtitleLanguage(values[i]);
    if (lang.code !== "und") return lang;
    unknown = lang;
  }
  return unknown;
}
function subtitles(run, detail, selected, key) {
  run = { started: run.started, deadline: Math.min(run.deadline, Date.now() + 4500) };
  return request(run, detail.base + "/api/Sub/" + selected.id + "?kkey=" + encodeURIComponent(key), detail.base, "subtitle-list", 3500, false)
    .then(function(rows) {
      if (!Array.isArray(rows)) throw new Error("Invalid subtitle schema");
      var seen = {}, tasks = rows.filter(function(row) {
        var url = directUrl(row && (row.src || row.url || row.file), detail.base);
        if (!url || seen[url]) return false;
        var lang = subtitleRowLanguage(row);
        if (lang.code !== "en" && lang.code !== "ms") return false;
        seen[url] = true; return true;
      }).slice(0, 16);
      var output = [], index = 0;
      function worker() {
        if (index >= tasks.length || remaining(run) < 200) return Promise.resolve();
        var row = tasks[index++], url = directUrl(row.src || row.url || row.file, detail.base);
        var lang = subtitleRowLanguage(row);
        var path = url.split(/[?#]/)[0], format = /\.(vtt|webvtt)$/i.test(path) ? "vtt" : /\.(ass|ssa)$/i.test(path) ? "ass" : "srt";
        var sub = { label: lang.label, language: lang.code, lang: lang.code, url: url, format: format, mimeType: format === "vtt" ? "text/vtt" : format === "ass" ? "text/x-ssa" : "application/x-subrip", headers: headers(detail.base) };
        // VUEO applies this transform when loading the sidecar, outside discovery.
        if (format === "srt" || format === "vtt") sub.textTransform = {"algorithm":"aes-cbc","scope":"cue-lines","keys":[{"key":"QW1TbVpWY0g5M1VRVWV6aQ==","iv":"UmVCS1dXOGNxZGpQRW5GNg=="},{"key":"ODA1NjQ4MzY0NjMyODc2Mw==","iv":"Njg1MjYxMjM3MDE4NTI3Mw=="}]};
        output.push(sub);
        return worker();
      }
      return Promise.all([worker(), worker(), worker()]).then(function() { return output; });
    });
}
function resolveEpisode(run, detail, selected, info, type, season, episode) {
  function video(key) {
    return request(run, detail.base + "/api/DramaList/Episode/" + selected.id + ".png?err=false&ts=&time=&kkey=" + encodeURIComponent(key), detail.base, "video", 5000, false)
      .then(function(data) { var urls = mediaUrls(data, detail.base); if (!urls.length) throw new Error("No direct media in video response"); return urls; });
  }
  trace("KEY", { method: "local", episodeId: selected.id });
  var subResult = subtitles(run, detail, selected, episodeKey(selected.id, true)).then(function(items) {
    return { items: items, failed: false };
  }, function(error) { trace("SUBTITLE_FAIL", { reason: error.message }); return { items: [], failed: true, auth: error.status === 401 || error.status === 403 }; });
  var videoResult = video(episodeKey(selected.id, false)).then(function(urls) { return { urls: urls }; }, function(error) { return { error: error }; });
  return Promise.all([videoResult, subResult]).then(function(results) {
    var v = results[0], s = results[1];
    // Expensive page capture is reserved for rejected/empty video token responses.
    var fallback = (v.error && (v.error.status === 401 || v.error.status === 403 || /No direct media/.test(v.error.message))) || s.auth
      ? captureKeys(run, detail, selected) : Promise.resolve({});
    return fallback.then(function(keys) {
      var retryVideo = v.error && keys.video ? video(keys.video).then(function(urls) { v = { urls: urls }; }) : Promise.resolve();
      var retrySub = s.failed && keys.sub ? subtitles(run, detail, selected, keys.sub).then(function(items) { s.items = items; }, function() {}) : Promise.resolve();
      return Promise.all([retryVideo, retrySub]).then(function() {
        if (v.error) throw v.error;
        trace("RESULT", { streams: v.urls.length, subtitles: s.items.length, ms: Date.now() - run.started });
        return v.urls.map(function(url, i) {
          return { name: PROVIDER_NAME + " Server " + (i + 1), title: info.title + (type === "tv" ? " S" + season + "E" + episode : ""),
            url: url, quality: "Auto", headers: headers(detail.base), subtitles: s.items };
        });
      });
    });
  });
}
function getStreams(id, mediaType, season, episode) {
  var type = mediaType === "series" ? "tv" : mediaType;
  if (!/^\d+$/.test(String(id)) || (type !== "movie" && type !== "tv")) return Promise.resolve([]);
  season = season === undefined || season === null ? 1 : Number(season);
  episode = episode === undefined || episode === null ? 1 : Number(episode);
  if (type === "tv" && (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1)) return Promise.resolve([]);
  var run = { started: Date.now(), deadline: Date.now() + 18500 };
  trace("START", { version: VERSION, tmdb: String(id), type: type, season: season, episode: episode });
  return metadata(run, String(id), type).then(function(info) {
    if (!info.title || !info.aliases.length) throw new Error("Missing title metadata");
    info.requestEpisode = episode;
    return findDrama(run, String(id), info, type, season, episode).then(function(detail) {
      var selected;
      if (type === "movie") {
        if (detail.episodes.length !== 1) throw new Error("Ambiguous movie episode list");
        selected = detail.episodes[0];
      } else selected = detail.episodes.find(function(e) { return e.number === episode; });
      if (!selected) throw new Error("Exact episode " + episode + " missing");
      trace("MATCH", { dramaId: detail.id, episodeId: selected.id, title: detail.title, year: detail.year || "unknown", season: season, episode: episode });
      return resolveEpisode(run, detail, selected, info, type, season, episode);
    });
  }).catch(function(error) { trace("NO_RESULT", { reason: String(error.message || error), ms: Date.now() - run.started }); return []; });
}
module.exports = { getStreams: getStreams };

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  var route = /\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(String(url));
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
    var contextId = raw.tmdbId || raw.tmdb && raw.tmdb.id;
    var contextType = raw.mediaType || raw.tmdb && raw.tmdb.media_type;
    if (!route || String(contextId) !== route[2] || (contextType && contextType !== route[1] && !(contextType === "series" && route[1] === "tv"))) return null;
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

function normalizeTitle(value) { return norm(value); }
function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;

    seen[key] = true;
    output.push({
      title: text,
      priority: Number(priority || 0)
    });
  }

  add(data && (data.title || data.name), 100);
  add(
    data &&
    (
      data.original_title ||
      data.original_name
    ),
    95
  );

  var altRoot =
    data &&
    data.alternative_titles || {};

  var altItems =
    altRoot &&
    (
      Array.isArray(altRoot.titles)
        ? altRoot.titles
        : Array.isArray(altRoot.results)
          ? altRoot.results
          : []
    );

  altItems.forEach(function(item) {
    if (!item) return;

    var country =
      String(
        item.iso_3166_1 || ""
      ).toUpperCase();

    var boost =
      country === "US" ||
      country === "GB"
        ? 86
        : country === "MY" ||
          country === "ID"
          ? 82
          : 72;

    add(
      item.title ||
      item.name,
      boost
    );
  });

  var translations =
    data &&
    data.translations &&
    Array.isArray(
      data.translations.translations
    )
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    var row =
      item &&
      item.data &&
      typeof item.data === "object"
        ? item.data
        : {};

    var lang =
      String(
        item &&
        item.iso_639_1 ||
        ""
      ).toLowerCase();

    var boost =
      lang === "en"
        ? 88
        : lang === "ms" ||
          lang === "id"
          ? 80
          : 68;

    add(
      row.title ||
      row.name,
      boost
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output
    .map(function(item) {
      return item.title;
    })
    .slice(0, 12);
}

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
module.exports = cloudbankDisplayInstall(module.exports, "KissKH", "kisskh");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
