// Imported provider: vidlove; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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
    if (type === "tv" && (season == null || season === "" || episode == null || episode === "" || !Number.isInteger(Number(season)) || Number(season) < 0 ||
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
/* VidLove v2.3.0: fast API, then one exact website session on API failure. */
var VL_API = 'https://api.vidlove.cc';
var VL_PLAYER = 'https://player.vidlove.cc';
var VL_ENGINES = ['moviebox', 'vidapi', 'moviebox2', 'dcloud', 'tcloud'];
var VL_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
function vlLog(message) { console.log('[VidLove] ' + message); }
function vlBounded(run, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('request timeout')); }, timeoutMs);
    Promise.resolve().then(run).then(function(value) { clearTimeout(timer); resolve(value); }, function(error) { clearTimeout(timer); reject(error); });
  });
}
function vlMediaUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || value !== value.trim() || /[\r\n\0]/.test(value) || /^https:\/\/[^/]*@/i.test(value)) return null;
  try { return new URL(value); } catch (_) { return null; }
}
function vlKind(source, parsed) {
  var mime = String(source.mimeType || source.contentType || source.type || '').toLowerCase();
  if (typeof source.manifest === 'string' && /^\s*#EXTM3U(?:\s|$)/.test(source.manifest)) return 'hls';
  if (/\.m3u8$/i.test(parsed.pathname) || /mpegurl|^hls$/.test(mime)) return 'hls';
  if (/\.mpd$/i.test(parsed.pathname) || /dash\+xml|^dash$/.test(mime)) return 'dash';
  if (/\.mp4$/i.test(parsed.pathname) || mime === 'video/mp4' || mime === 'mp4') return 'mp4';
  return '';
}
function vlSelectSource(source) {
  if (!Array.isArray(source.qualities) || !source.qualities.length) return source;
  var candidates = source.qualities.filter(function(row) {
    var parsed = row && vlMediaUrl(row.url);
    if (!parsed || !vlKind(row, parsed)) return false;
    var match = /\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(row.quality || ''));
    return !match || Number(match[1]) >= 720;
  });
  candidates.sort(function(a, b) {
    // No HEVC capability claim: prefer the website's H.264 rendition.
    var ac = /hevc|h265/i.test(String(a.codec || '')) ? 1 : 0;
    var bc = /hevc|h265/i.test(String(b.codec || '')) ? 1 : 0;
    return ac - bc || (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
  });
  if (!candidates.length) throw new Error('no eligible quality entry');
  var selected = {}, row = candidates[0];
  Object.keys(source).forEach(function(key) { selected[key] = source[key]; });
  Object.keys(row).forEach(function(key) { selected[key] = row[key]; });
  // A parent manifest describes the parent URL, not this rendition.
  delete selected.manifest;
  return selected;
}
function vlHeaders(raw, page) {
  var out = {};
  if (raw && typeof raw === 'object') Object.keys(raw).forEach(function(key) {
    if (!/^(host|connection|content-length|accept-encoding|range|x-vueo-http-transport)$/i.test(key) && typeof raw[key] === 'string' && !/[\r\n\0]/.test(key + raw[key])) out[key] = raw[key];
  });
  function add(name, value) { if (!Object.keys(out).some(function(key) { return key.toLowerCase() === name.toLowerCase(); })) out[name] = value; }
  add('Referer', page); add('Origin', VL_PLAYER); add('User-Agent', VL_UA); add('Accept', '*/*');
  return out;
}
function vlLanguage(value) {
  var lang = String(value || '').toLowerCase();
  return ({eng:'en',jpn:'ja',kor:'ko',hin:'hi',ita:'it',zho:'zh',chi:'zh',msa:'ms',may:'ms',ind:'id'})[lang] || lang;
}
function vlSubtitles(rows) {
  var out = [], seen = Object.create(null);
  if (!Array.isArray(rows)) return out;
  rows.forEach(function(row) {
    if (!row || typeof row !== 'object' || out.length >= 128) return;
    var url = row.url || row.file || row.src;
    if (!vlMediaUrl(url) || seen[url] || /^(?:thumbnails?|chapters?)$/i.test(String(row.kind || ''))) return;
    seen[url] = true;
    var label = String(row.name || row.label || row.display || '').trim();
    // A website label is useful; never mark every subtitle as English.
    var language = row.language || row.lang || row.srclang || label || 'und';
    var track = { url: url, language: String(language), name: label || String(language) };
    var mime = String(row.mimeType || row.mime_type || row.type || row.format || '').toLowerCase();
    if (/^(?:text\/vtt|vtt)$/.test(mime) || /\.vtt(?:[?#]|$)/i.test(url)) track.mimeType = 'text/vtt';
    else if (/^(?:application\/x-subrip|srt)$/.test(mime) || /\.srt(?:[?#]|$)/i.test(url)) track.mimeType = 'application/x-subrip';
    if (row.headers && typeof row.headers === 'object') {
      track.headers = {};
      Object.keys(row.headers).forEach(function(key) {
        if (!/^(host|connection|range|content-length|accept-encoding|x-vueo-http-transport)$/i.test(key) &&
          typeof row.headers[key] === 'string' && !/[\r\n\0]/.test(key + row.headers[key])) track.headers[key] = row.headers[key];
      });
    }
    out.push(track);
  });
  return out;
}
function vlMapPayload(payload, id, type, season, episode) {
  var meta = payload && payload.meta || {}, source = payload && payload.source;
  if (meta.id != null && String(meta.id) !== id) throw new Error('response identity mismatch');
  if (!source || typeof source !== 'object') return null;
  source = vlSelectSource(source);
  var parsed = vlMediaUrl(source.url);
  if (!parsed) throw new Error('no HTTPS media URL');
  var kind = vlKind(source, parsed);
  if (!kind) throw new Error('unsupported media payload');
  var original = vlLanguage(meta.original_language), language = vlLanguage(source.audioLanguage || source.language);
  var languages = Array.isArray(source.audioLanguages) ? source.audioLanguages.map(vlLanguage) : [];
  var dual = source.isDualAudio === true || source.isMultiAudio === true;
  var includesOriginal = original && (language === original || languages.indexOf(original) >= 0);
  var knownNonOriginal = original && !includesOriginal && (languages.length > 0 || (language && !dual));
  if (knownNonOriginal || (source.isDubbed === true && !includesOriginal && !dual)) throw new Error('explicit dub-only source');
  var quality = /\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(source.quality || ''));
  if (kind === 'mp4' && quality && Number(quality[1]) < 720) throw new Error('direct file below 720p');
  var title = String(meta.title || meta.name || 'VidLove'), date = meta.release_date || meta.first_air_date || '';
  if (date) title += ' (' + String(date).slice(0, 4) + ')';
  if (type === 'tv') title += ' S' + Number(season) + 'E' + Number(episode);
  var stream = { name: 'VidLove', title: title, url: source.url, headers: vlHeaders(source.headers, VL_PLAYER + '/'), provider: 'vidlove',
    serverName: source.label || source.source || 'Website', quality: kind === 'mp4' && quality ? quality[1] + 'p' : 'Auto',
    type: kind === 'mp4' ? 'direct' : kind, format: kind, isAdaptive: kind !== 'mp4',
    mimeType: kind === 'hls' ? 'application/x-mpegURL' : kind === 'dash' ? 'application/dash+xml' : 'video/mp4', runtimeMinutes: meta.runtime || undefined };
  if (language) stream.audioLanguage = language;
  if (languages.length) stream.audioLanguages = languages;
  return { stream: stream, tracks: vlSubtitles([].concat(Array.isArray(payload.subtitles) ? payload.subtitles : [], Array.isArray(source.subtitles) ? source.subtitles : [])) };
}
function vlSafeError(error) {
  var text = String(error && error.message || '');
  return /^(?:HTTP \d+|request timeout|response identity mismatch|no HTTPS media URL|unsupported media payload|explicit dub-only source|direct file below 720p|no eligible quality entry)$/.test(text) ? text : 'transport or response error';
}
async function vlBrowserSource(id, type, season, episode, remainingMs) {
  if (typeof self.webviewResolve !== 'function' || remainingMs < 1000) {
    vlLog('WEBSITE: bridge unavailable or budget exhausted'); return null;
  }
  var page = VL_PLAYER + '/embed/' + type + '/' + id + (type === 'tv' ? '/' + Number(season) + '/' + Number(episode) : '');
  var timeout = Math.max(500, Math.min(8000, remainingMs - 300)), session;
  vlLog('WEBSITE: exact requested title; one session; captures current website API responses; budgetMs=' + timeout);
  try {
    session = await vlBounded(function() {
      return self.webviewResolve(page, {
        directLoad: true, referer: VL_PLAYER + '/', userAgent: VL_UA, timeoutMs: timeout, finishAfterFirstMs: 150,
        waitForMediaReady: true, allowBlobMediaReady: false,
        captureSessionResponses: true, jsonResponsePrefixes: [VL_API + '/'],
        injectAbyssHook: false, captureSubtitles: false,
        suppressPopups: true, lockMainFrameHost: true, blockMatchedRequests: false,
        mediaHosts: ['api.ravenflix.st', 'a2.ravenflix.st', 'd.ravenflix.st', 'd2.ravenflix.st', 'c.ravenflix.st', 'c2.ravenflix.st'],
        mediaRequestMatchers: [], match: ['.m3u8', '.mp4', '.mpd'],
        interactionTexts: [], clickDelaysMs: [12000],
        blocked: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com']
      });
    }, timeout + 200);
    if (typeof session === 'string') session = JSON.parse(session);
  } catch (_) { vlLog('WEBSITE: session failed'); return null; }
  if (!session || session.sessionResponseVersion !== 1 || !Array.isArray(session.responses)) {
    vlLog('WEBSITE: detailed session response bridge unavailable'); return null;
  }
  var records = session.responses, result = null;
  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    try {
      if (!record || record.status < 200 || record.status > 299) continue;
      var request = vlMediaUrl(record.url);
      if (!request || request.origin !== VL_API || request.pathname !== '/' + type ||
          request.searchParams.get('id') !== id || request.searchParams.get('mode') !== 'json') continue;
      if (type === 'tv' && (request.searchParams.get('season') !== String(Number(season)) ||
          request.searchParams.get('episode') !== String(Number(episode)))) continue;
      var body = typeof record.body === 'string' ? JSON.parse(record.body) : record.body;
      var candidate = vlMapPayload(body, id, type, season, episode);
      if (!candidate) continue;
      // Copy browser cookies/UA only from this source's observed media request
      // and only when the selected rendition has the same origin.
      var rows = Array.isArray(session.streams) ? session.streams : [];
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j], parsed = row && vlMediaUrl(row.url);
        if (!parsed || (row.networkObserved !== true && row.responseObserved !== true)) continue;
        if (row.url !== body.source.url && row.url !== candidate.stream.url) continue;
        if (parsed.origin !== vlMediaUrl(candidate.stream.url).origin) continue;
        candidate.stream.headers = vlHeaders(row.headers, page); break;
      }
      candidate.engine = request.searchParams.get('sources') || 'website';
      candidate.fromWebsite = true;
      result = candidate; break;
    } catch (error) { vlLog('WEBSITE_RESPONSE: rejected=' + vlSafeError(error)); }
  }
  vlLog('WEBSITE: responses=' + records.length + ' result=' + (result ? 'eligible' : 'empty') + '; exact query verified; playback unverified');
  return result;
}
async function getStreams(tmdbId, mediaType, season, episode) {
  var id = String(tmdbId || ''), type = mediaType === 'series' ? 'tv' : mediaType;
  if (!/^[1-9]\d*$/.test(id) || (type !== 'movie' && type !== 'tv')) return [];
  if (type === 'tv' && (season == null || season === '' || episode == null || episode === '' || !Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return [];
  var started = Date.now(), deadline = started + 17500, calls = 0;
  var nativeDeadline = started + (typeof self.webviewResolve === 'function' ? 6000 : 14000);
  // Match the current website's cross-origin JSON request. No cookies/token
  // bootstrap is used by its source module.
  var headers = { Accept: 'application/json', Referer: VL_PLAYER + '/', Origin: VL_PLAYER, 'User-Agent': VL_UA };
  var query = '?id=' + encodeURIComponent(id) + (type === 'tv' ? '&season=' + Number(season) + '&episode=' + Number(episode) : '') + '&mode=json';
  vlLog('ROUTE: v2.3.0 exact TMDB=' + id + ' ' + type + '; API first, up to 5 engines; parallel=3; one website fallback only on API failure; no title-specific rules');
  var result = await new Promise(function(resolve) {
    var next = 0, active = 0, finished = false;
    var timer = setTimeout(function() { complete(null); }, Math.max(1, nativeDeadline - Date.now()));
    function complete(value) { if (finished) return; finished = true; clearTimeout(timer); resolve(value); }
    function pump() {
      if (finished) return;
      while (active < 3 && next < VL_ENGINES.length && Date.now() < nativeDeadline) {
        (function(engine) {
          active++; calls++;
          var url = VL_API + '/' + type + query + '&sources=' + engine;
          if (engine === 'moviebox' || engine === 'moviebox2') url += '&vh=1';
          // Public identity/query only. Never log returned signed media URLs.
          vlLog('API_REQUEST: ' + url);
          vlBounded(function() {
            return fetch(url, { headers: headers }).then(function(response) {
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return response.json().then(function(payload) {
                if (!finished) vlLog('API_RESPONSE: engine=' + engine + ' status=' + response.status +
                  ' meta=' + !!(payload && payload.meta) + ' source=' + !!(payload && payload.source));
                return payload;
              });
            });
          }, Math.max(1, Math.min(5000, nativeDeadline - Date.now()))).then(function(payload) {
            if (finished) return;
            var candidate = vlMapPayload(payload, id, type, season, episode);
            vlLog('ENGINE: ' + engine + ' result=' + (candidate ? 'eligible' : 'empty'));
            if (candidate) { candidate.engine = engine; complete(candidate); }
          }).catch(function(error) {
            if (!finished) vlLog('ENGINE: ' + engine + ' result=' + vlSafeError(error));
          }).then(function() {
            active--;
            if (finished) return;
            if ((next >= VL_ENGINES.length || Date.now() >= nativeDeadline) && active === 0) complete(null);
            else pump();
          });
        })(VL_ENGINES[next++]);
      }
      if (!finished && active === 0) complete(null);
    }
    pump();
  });
  if (!result) result = await vlBrowserSource(id, type, season, episode, deadline - Date.now());
  if (!result) { vlLog('NO_RESULT: API and available website fallback found no eligible source; nativeCalls=' + calls + ' elapsedMs=' + (Date.now() - started) + '; subtitles not fetched without video'); return []; }
  var tracks = result.tracks, subtitleStatus = tracks.length ? 'payload' : 'empty';
  if (!tracks.length && !result.fromWebsite && Date.now() < deadline) {
    var subtitleUrl = VL_API + '/subtitles/' + type + '/' + id + (type === 'tv' ? '/' + Number(season) + '/' + Number(episode) : '');
    calls++;
    vlLog('SUBTITLE_REQUEST: ' + subtitleUrl);
    try {
      var list = await vlBounded(function() {
        return fetch(subtitleUrl, { headers: headers }).then(function(response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        });
      }, Math.max(1, Math.min(2500, deadline - Date.now())));
      tracks = vlSubtitles(list); subtitleStatus = tracks.length ? 'website' : 'empty';
    } catch (error) { subtitleStatus = vlSafeError(error); }
  }
  if (tracks.length) result.stream.subtitles = tracks;
  vlLog('SUBTITLES: tracks=' + tracks.length + ' status=' + subtitleStatus + '; language labels preserved');
  vlLog('RESULT: 1 source; route=' + (result.fromWebsite ? 'website' : 'native') + ' engine=' + result.engine + ' nativeCalls=' + calls + ' elapsedMs=' + (Date.now() - started) + '; playback unverified');
  return [result.stream];
}
module.exports = { getStreams: getStreams };

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidlove", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "❤️ VidLove", "vidlove");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
