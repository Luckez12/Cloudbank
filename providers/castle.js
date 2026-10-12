// Imported provider: castle; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
async function decryptCastle(encryptedB64, securityKeyB64) {
    console.log("[Castle] Starting local AES-CBC decryption...");
    try {
      const CryptoJS = require("crypto-js");
      
      let decryptAES = CryptoJS.AES.decrypt.bind(CryptoJS.AES);
      // Local JNI adapter; do not mutate the shared crypto-js module.
      if (typeof __crypto_aes_decrypt_raw !== 'undefined') {
        const originalDecrypt = decryptAES;
        decryptAES = function(cipher, key, options) {
          try {
            const wordArrayToBytes = (wordArray) => {
              const bytes = new Uint8Array(wordArray.sigBytes);
              for (let i = 0; i < wordArray.sigBytes; i++) {
                bytes[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
              }
              return bytes;
            };
            const toUint8Array = (data) => {
              if (data instanceof Uint8Array) return data;
              if (data instanceof ArrayBuffer) return new Uint8Array(data);
              if (data && typeof data.length === 'number') return new Uint8Array(Array.prototype.slice.call(data));
              return new Uint8Array(0);
            };
            const data = typeof cipher === 'string'
              ? new Uint8Array(Array.from(atob(cipher), c => c.charCodeAt(0)))
              : (cipher.ciphertext ? wordArrayToBytes(cipher.ciphertext) : toUint8Array(cipher));
            const kBytes = wordArrayToBytes(key);
            const ivBytes = (options && options.iv) ? wordArrayToBytes(options.iv) : new Uint8Array(0);
            const mode = (options && options.mode) || 'AES-CBC';
            
            // Map Uint8Array (unsigned) to Int8Array (signed) to match Kotlin ByteArray
            const keyArg = typeof Int8Array !== 'undefined' ? new Int8Array(kBytes.buffer) : kBytes;
            const ivArg = typeof Int8Array !== 'undefined' ? new Int8Array(ivBytes.buffer) : ivBytes;
            const dataArg = typeof Int8Array !== 'undefined' ? new Int8Array(data.buffer) : data;
            
            const resBytes = __crypto_aes_decrypt_raw(mode, keyArg, ivArg, dataArg);
            const plain = new TextDecoder().decode(resBytes);
            return { toString: function() { return plain; } };
          } catch (err) {
            console.error("[Castle JNI Patch] Decrypt failed, falling back:", err);
            return originalDecrypt.call(CryptoJS.AES, cipher, key, options);
          }
        };
      }

      const CASTLE_SUFFIX = "T!BgJB";
      
      const securityKeyWords = CryptoJS.enc.Base64.parse(securityKeyB64);
      const suffixWords = CryptoJS.enc.Utf8.parse(CASTLE_SUFFIX);
      const keyMaterial = securityKeyWords.concat(suffixWords);
      
      let finalKey;
      if (keyMaterial.sigBytes < 16) {
        const padding = CryptoJS.lib.WordArray.create([0, 0, 0, 0], 16 - keyMaterial.sigBytes);
        finalKey = keyMaterial.concat(padding);
      } else if (keyMaterial.sigBytes > 16) {
        finalKey = CryptoJS.lib.WordArray.create(keyMaterial.words.slice(0, 4), 16);
      } else {
        finalKey = keyMaterial;
      }
      
      const iv = finalKey;
      
      const decrypted = decryptAES(encryptedB64, finalKey, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      
      const result = decrypted.toString(CryptoJS.enc.Utf8);
      if (!result) {
        throw new Error("Decryption resulted in empty string (possible key/IV mismatch)");
      }
      
      console.log("[Castle] Local decryption successful");
      return result;
    } catch (error) {
      console.error(`[Castle] Local decryption failed: ${error.message}`);
      throw error;
    }
}
/* CLOUDBANK_CASTLE_VERIFIED_PIPELINE_V1 */
const CASTLE_BASE = 'https://api.hlowb.com';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const PKG = 'com.external.castle';
const API_HEADERS = { 'User-Agent': 'okhttp/4.9.3', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Referer: CASTLE_BASE };
const PLAYBACK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
  "DNT": "1"
};
function castleLog(stage, details) {
  console.log('[Castle] ' + stage + (details ? ': ' + details : ''));
}
function castleParse(text) {
  // Preserve large integer tokens before JSON.parse can round Castle IDs.
  return JSON.parse(String(text).replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, function(token) {
    return /^\d{16,}$/.test(token) ? '"' + token + '"' : token;
  }));
}
function extractDataBlock(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid API response');
  if (value.code != null && Number(value.code) !== 200) throw new Error('Castle API code ' + value.code);
  return value.data && typeof value.data === 'object' ? value.data : value;
}
function castleId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe rounded Castle ID');
  var id = String(value == null ? '' : value);
  if (!/^\d+$/.test(id)) throw new Error('Missing or invalid Castle ID');
  return id;
}
function castleNormalize(value) {
  var text = String(value || '').toLowerCase().trim();
  if (typeof text.normalize === 'function') text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return text.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function castleYear(record) {
  var value = record.release_date || record.first_air_date || record.releaseDate || record.year;
  var year = value && /(?:19|20)\d{2}/.exec(String(value));
  if (year) return Number(year[0]);
  if (record.publishTime && Number.isFinite(Number(record.publishTime))) {
    var date = new Date(Number(record.publishTime));
    if (!isNaN(date.getTime())) return date.getUTCFullYear();
  }
  return null;
}
function castleType(record) {
  var type = String(record.media_type || record.mediaType || record.movieTypeName || '').toLowerCase();
  if (Number(record.movieType) === 2 || /^(?:movie|movies|film)$/.test(type)) return 'movie';
  if (Number(record.movieType) === 1 || /^(?:tv|tv shows|series)$/.test(type)) return 'tv';
  return '';
}
function castleTitleMatches(record, metadata) {
  return [record.title, record.name, record.originalTitle, record.original_title, record.original_name].some(function(value) {
    var title = castleNormalize(value);
    return title && metadata.titleKeys.indexOf(title) !== -1;
  });
}
function castleIdentity(record, metadata) {
  if (!castleTitleMatches(record, metadata)) throw new Error('Rejected mismatched Castle title');
  if (castleType(record) !== metadata.type) throw new Error('Rejected mismatched movie/TV type');
  var external = record.tmdbId != null ? record.tmdbId : record.tmdb_id;
  if (external != null && String(external) !== metadata.tmdbId) throw new Error('Rejected mismatched TMDB ID');
  var imdb = record.imdbId || record.imdb_id;
  if (imdb && metadata.imdbId && imdb !== metadata.imdbId) throw new Error('Rejected mismatched IMDb ID');
}
function castleBudget(run, state, maximum) {
  var remaining = Math.min(maximum || 4500, state.deadline - Date.now());
  if (remaining <= 0 || state.closed) return Promise.reject(new Error('Castle scan budget exhausted'));
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('Castle request timed out')); }, remaining);
    Promise.resolve().then(run).then(function(value) { clearTimeout(timer); resolve(value); }, function(error) { clearTimeout(timer); reject(error); });
  });
}
async function castleRequest(url, options, state) {
  options = options || {};
  var response = await castleBudget(function() { return fetch(url, { method: options.method || 'GET', headers: Object.assign({}, API_HEADERS, options.headers || {}), body: options.body }); }, state);
  if (!response.ok) throw new Error('Castle HTTP ' + response.status);
  return await castleBudget(function() { return response.text(); }, state);
}
function castleParams(extra) {
  return new URLSearchParams(Object.assign({ channel: 'IndiaA', clientType: '1', lang: 'en-US', packageName: PKG }, extra || {})).toString();
}
async function getTMDBDetails(tmdbId, type, state) {
  var text = await castleRequest(TMDB_BASE_URL + '/' + type + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids,alternative_titles', {}, state);
  var data = castleParse(text), profile = buildTitleProfile(data);
  if (!profile.title) throw new Error('Missing TMDB title');
  var aliases = profile.aliases.filter(function(title) { return castleNormalize(title); });
  return { title: profile.title, aliases: aliases, titleKeys: aliases.map(castleNormalize), year: castleYear(data), tmdbId: String(tmdbId), imdbId: data.external_ids && data.external_ids.imdb_id || '', type: type };
}
async function getSecurityKey(state) {
  var data = castleParse(await castleRequest(CASTLE_BASE + '/v0.1/system/getSecurityKey/1?' + castleParams(), {}, state));
  if (Number(data.code) !== 200 || typeof data.data !== 'string' || !data.data) throw new Error('Invalid Castle security key');
  return data.data;
}
async function castleEncrypted(path, extra, body, key, state) {
  var text = await castleRequest(CASTLE_BASE + path + '?' + castleParams(extra), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}, state);
  var cipher = text.trim();
  if (cipher.charAt(0) === '{') {
    var envelope = castleParse(cipher);
    if (envelope.code != null && Number(envelope.code) !== 200) throw new Error('Castle API code ' + envelope.code);
    if (typeof envelope.data !== 'string') throw new Error('Missing encrypted Castle payload');
    cipher = envelope.data;
  }
  var plain = await castleBudget(function() { return decryptCastle(cipher, key); }, state);
  return extractDataBlock(castleParse(plain));
}
async function getDetails(id, key, state) {
  id = castleId(id);
  if (!state.details[id]) state.details[id] = castleEncrypted('/film-api/v1.9.9/movie', { movieId: id }, null, key, state).then(function(data) {
    if (castleId(data.id) !== id) throw new Error('Castle detail ID differs from requested ID');
    return data;
  });
  return state.details[id];
}
async function castleVerify(row, metadata, season, episode, key, state) {
  castleIdentity(row, metadata);
  var id = castleId(row.id || row.redirectIdStr || row.redirectId);
  var root = await getDetails(id, key, state);
  castleIdentity(root, metadata);
  var selected = root, seasons = Array.isArray(root.seasons) ? root.seasons : [];
  if (metadata.type === 'tv') {
    var match = seasons.filter(function(item) { return Number(item.number) === season; });
    if (match.length > 1) throw new Error('Ambiguous Castle season');
    if (seasons.length && !match.length) throw new Error('Requested Castle season unavailable');
    if (match.length) { id = castleId(match[0].movieId); selected = await getDetails(id, key, state); }
    castleIdentity(selected, metadata);
    if (Number(selected.seasonNumber) !== season || selected.seasonNumber == null) throw new Error('Castle season identity unverified');
    // Search often points at the latest season. Compare the original release year with season 1.
    var first = seasons.filter(function(item) { return Number(item.number) === 1; });
    var firstSeason = Number(root.seasonNumber) === 1 ? root : first.length === 1 ? await getDetails(first[0].movieId, key, state) : null;
    if (!firstSeason) throw new Error('Castle first season identity unverified');
    castleIdentity(firstSeason, metadata);
    if (Number(firstSeason.seasonNumber) !== 1) throw new Error('Invalid Castle first season');
    var firstYear = castleYear(firstSeason);
    if (metadata.year && (!firstYear || Math.abs(firstYear - metadata.year) > 1)) throw new Error('Rejected mismatched series release year');
  } else {
    var year = castleYear(selected);
    if (metadata.year && (!year || Math.abs(year - metadata.year) > 1)) throw new Error('Rejected mismatched movie release year');
  }
  var episodes = Array.isArray(selected.episodes) ? selected.episodes.filter(Boolean) : [];
  var matches = metadata.type === 'tv' ? episodes.filter(function(item) { return Number(item.number) === episode; }) : episodes;
  if (matches.length !== 1) throw new Error(metadata.type === 'tv' ? 'Requested episode missing or ambiguous' : 'Movie episode missing or ambiguous');
  castleId(matches[0].id);
  castleLog('Verified content', selected.title + (metadata.type === 'tv' ? ' S' + season + 'E' + episode : ''));
  return { id: id, details: selected, episode: matches[0] };
}
async function findCastleContent(metadata, season, episode, key, state) {
  var queries = [], seen = Object.create(null), tried = Object.create(null);
  metadata.aliases.forEach(function(title) { var normalized = castleNormalize(title); if (normalized && !seen[normalized]) { seen[normalized] = true; queries.push(title); } });
  queries = queries.slice(0, 4);
  for (var index = 0; index < queries.length; index++) {
    castleLog('Searching title', queries[index]);
    var data = await castleEncrypted('/film-api/v1.1.0/movie/searchByKeyword', { keyword: queries[index], mode: '1', page: '1', size: '30' }, null, key, state);
    var rows = Array.isArray(data.rows) ? data.rows : [];
    var candidates = rows.filter(function(row) { return row && castleType(row) === metadata.type && castleTitleMatches(row, metadata); });
    castleLog('Search candidates', rows.length + ' returned, ' + candidates.length + ' title/type matches');
    if (candidates.length > 3) throw new Error('Ambiguous Castle title candidates');
    var verified = [];
    for (var row of candidates) {
      var id = castleId(row.id || row.redirectIdStr || row.redirectId);
      if (tried[id]) continue;
      tried[id] = true;
      try { var match = await castleVerify(row, metadata, season, episode, key, state); if (!verified.some(function(item) { return item.id === match.id; })) verified.push(match); }
      catch (error) { castleLog('Candidate rejected', error.message); }
    }
    if (verified.length > 1) throw new Error('Multiple verified Castle titles; refusing ambiguous match');
    if (verified.length === 1) return verified[0];
  }
  throw new Error('No verified Castle title match; no first-result fallback');
}
function resolutionToQuality(value) {
  return { 1: '480p', 2: '720p', 3: '1080p' }[Number(value)] || 'Unknown';
}
function getQualityValue(value) { return Number((String(value).match(/\d{3,4}/) || [0])[0]); }
function castleBool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
function castleSubtitles(video, episode) {
  var seen = Object.create(null), subtitles = [];
  [video.subtitles, episode.subtitles].forEach(function(rows) {
    (Array.isArray(rows) ? rows : []).forEach(function(sub) {
      if (!sub || !/^https?:\/\//i.test(sub.url || '') || seen[sub.url]) return;
      seen[sub.url] = true;
      subtitles.push({ url: sub.url, language: sub.abbreviate || 'Unknown', name: sub.title || sub.abbreviate || 'Unknown', headers: PLAYBACK_HEADERS });
    });
  });
  return subtitles;
}
function processVideoResponse(data, metadata, selected, resolution, language) {
  if (castleBool(data.isPreview) || castleBool(data.permissionDenied) || castleBool(data.inBlacklist)) {
    castleLog('Video rejected', 'preview, permission denied, or blacklist');
    return [];
  }
  if (data.expireTime && Number(data.expireTime) <= Date.now()) { castleLog('Video rejected', 'expired URL'); return []; }
  if (data.movieId != null && castleId(data.movieId) !== selected.id || data.episodeId != null && castleId(data.episodeId) !== castleId(selected.episode.id)) throw new Error('Video response identity mismatch');
  var subtitles = castleSubtitles(data, selected.episode), streams = [], seen = Object.create(null);
  function add(url, quality, size) {
    if (!/^https?:\/\//i.test(url || '') || seen[url]) return;
    seen[url] = true;
    streams.push({ name: 'Castle [' + language + '] - ' + quality, title: metadata.title, url: url, quality: quality, size: size ? (Number(size) / 1073741824).toFixed(2) + ' GB' : '', headers: PLAYBACK_HEADERS, provider: 'castle', subtitles: subtitles });
  }
  // Only a video row with its own URL proves that row's quality.
  (Array.isArray(data.videos) ? data.videos : []).forEach(function(video) {
    if (video && video.url) add(video.url, resolutionToQuality(video.resolution), video.size);
  });
  if (data.videoUrl && !seen[data.videoUrl]) {
    var actual = data.resolution != null ? data.resolution : resolution;
    var row = (Array.isArray(data.videos) ? data.videos : []).filter(function(v) { return v && Number(v.resolution) === Number(actual); })[0];
    add(data.videoUrl, resolutionToQuality(actual), row && row.size || data.size);
  }
  return streams;
}
async function getVideo(selected, languageId, resolution, key, state) {
  var body = { mode: '1', appMarket: 'GuanWang', clientType: '1', woolUser: 'false', apkSignKey: 'ED0955EB04E67A1D9F3305B95454FED485261475', androidVersion: '13', movieId: selected.id, episodeId: castleId(selected.episode.id), isNewUser: 'true', resolution: String(resolution), packageName: PKG };
  if (languageId != null) body.languageId = castleId(languageId);
  return castleEncrypted('/film-api/v2.0.1/movie/getVideo2', {}, body, key, state);
}
async function getStreams(tmdbId, mediaType, season, episode) {
  var state = { deadline: Date.now() + 17500, closed: false, details: Object.create(null) }, streams = [];
  try {
    var values = await Promise.all([getTMDBDetails(tmdbId, mediaType, state), getSecurityKey(state)]);
    var metadata = values[0], key = values[1];
    var selected = await findCastleContent(metadata, Number(season), Number(episode), key, state);
    var tracks = Array.isArray(selected.episode.tracks) ? selected.episode.tracks : [];
    var tasks = [{ languageId: null, name: 'Shared' }];
    tracks.forEach(function(track) {
      if (track && castleBool(track.existIndividualVideo) && track.languageId != null) tasks.push({ languageId: track.languageId, name: track.languageName || track.abbreviate || 'Unknown' });
    });
    var resolution = Number(selected.episode.playResolution) || 2, next = 0;
    // Shared first; individual audio runs concurrently, up to three requests.
    async function worker() {
      while (next < tasks.length && !state.closed && Date.now() < state.deadline) {
        var task = tasks[next++];
        try {
          var data = await getVideo(selected, task.languageId, resolution, key, state);
          streams.push.apply(streams, processVideoResponse(data, metadata, selected, resolution, task.name));
        } catch (error) { castleLog('Video request failed', task.name + ': ' + error.message); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
    var seen = Object.create(null);
    streams = streams.filter(function(stream) { var id = stream.url + '|' + stream.name; if (seen[id]) return false; seen[id] = true; return true; });
    streams.sort(function(a, b) { return getQualityValue(b.quality) - getQualityValue(a.quality); });
  } catch (error) { console.error('[Castle] ' + error.message); }
  finally { state.closed = true; }
  castleLog('Finished', streams.length + ' verified source(s)');
  return streams;
}
module.exports = { getStreams: getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "castle", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "🏰 Castle", "castle");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
