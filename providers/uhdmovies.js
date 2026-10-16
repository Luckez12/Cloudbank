// Imported provider: uhdmovies; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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


// UHDMovies 1.3.0: audited against site HTML on 2026-10-16.
var uhdCheerio = require('cheerio-without-node-native');
var UHD_BASE = 'https://uhdmovies.my';
var UHD_DOMAINS = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
function uhdLog(stage, message) { console.log('[UHDMovies] ' + stage + ': ' + message); }
function uhdUrl(value, base) {
  if (!String(value || '').trim()) return '';
  try { var u = new URL(String(value || '').trim(), base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; }
}
function uhdNorm(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function uhdSiteTitle(value) {
  return String(value || '').replace(/^\s*download\s+/i, '').split(/\s*(?:\(\s*(?:19|20)\d{2}\b|\bS\d{1,2}(?:\b|[\s–-])|\(?\bSeasons?\s+\d|\b(?:Dual|Multi)[ -]Audio\b|\{(?:English|Hindi|Japanese|Korean)|\b(?:720|1080|2160)p\b)/i)[0].trim();
}
function uhdYear(value) { var text = String(value || ''); var m = /\(\s*((?:19|20)\d{2})/.exec(text) || /\b((?:19|20)\d{2})\b/.exec(text); return m ? m[1] : ''; }
function uhdMatches(label, meta) {
  var profile = buildTitleProfile(meta), title = uhdNorm(uhdSiteTitle(label));
  if (!title || !profile.aliases.some(function(alias) { return uhdNorm(alias) === title; })) return false;
  var year = uhdYear(meta.release_date || meta.first_air_date), siteYear = uhdYear(label);
  return !year || !siteYear || year === siteYear;
}
function uhdQuality(text) {
  var m = /\b(2160|1080|720|480)p\b/i.exec(text || '');
  return m ? m[1] + 'p' : /\b4k\b/i.test(text || '') ? '2160p' : 'Unknown';
}
function uhdRelease(text) {
  var languages = [], names = { English: 'en', Hindi: 'hi', Japanese: 'ja', Korean: 'ko', Chinese: 'zh', Tamil: 'ta', Telugu: 'te', Malay: 'ms', Indonesian: 'id', Spanish: 'es', German: 'de', French: 'fr' };
  Object.keys(names).forEach(function(name) { if (new RegExp('\\b' + name + '\\b', 'i').test(text || '')) languages.push(names[name]); });
  return { quality: uhdQuality(text), audioLanguages: languages, fileName: String(text || '').slice(0, 400) };
}
function uhdSeason(text) {
  if (/\b(?:S\d{1,2}|Seasons?\s*\d{1,2})\s*[-–]\s*(?:S|Season\s*)?\d{1,2}\b/i.test(text)) return null;
  var m = /\b(?:Season\s*|S)(\d{1,2})\b/i.exec(text); return m ? Number(m[1]) : null;
}
function uhdItems(html, pageUrl, type, wantedSeason, wantedEpisode) {
  var $ = uhdCheerio.load(html), root = $('.entry-content').first(), items = [], seen = {};
  var currentSeason = uhdSeason($('h1').first().text()), release = uhdRelease('');
  function add(href, data) {
    var url = uhdUrl(href, pageUrl); if (!url || seen[url] || /\.(?:zip|rar)(?:[?#]|$)/i.test(url)) return;
    seen[url] = true; items.push(Object.assign({ url: url }, data));
  }
  root.find('h2,h3,h4,h5,p,pre,a').each(function(_, el) {
    var node = $(el), text = node.text().replace(/\s+/g, ' ').trim();
    if (!node.is('a')) {
      if (!node.find('a').length && text) {
        var season = uhdSeason(text);
        if (/\b(?:S\d{1,2}|Seasons?\s*\d)/i.test(text)) { if (currentSeason !== season) release = uhdRelease(text); currentSeason = season; }
        if (uhdQuality(text) !== 'Unknown') release = uhdRelease(text);
      }
      return;
    }
    if (/\b(?:zip|pack|batch|trailer)\b/i.test(text)) return;
    if (type === 'tv') {
      var explicit = /\bS(\d{1,2})\s*E(\d{1,4})\b/i.exec(text);
      var ep = explicit || /^(?:Episode|Ep)\s*0*(\d{1,4})\s*$/i.exec(text);
      if (!ep) return;
      var season = explicit ? Number(ep[1]) : currentSeason, episode = Number(ep[explicit ? 2 : 1]);
      if (season === Number(wantedSeason) && episode === Number(wantedEpisode)) add(node.attr('href'), Object.assign({}, release, { expectedSeason: season, expectedEpisode: episode }));
    } else if (/\b(?:download|g[ -]?drive|watch)\b/i.test(text) && (node.is('.maxbutton, .maxbutton-1') || node.closest('.maxbutton').length || /g[ -]?drive/i.test(text))) {
      add(node.attr('href'), release);
    }
  });
  return items;
}
function uhdState() { return { deadline: Date.now() + 18300, jar: {}, results: [] }; }
function uhdCookies(state, host) { return state.jar[host] || (state.jar[host] = {}); }
function uhdSaveCookies(response, state, url) {
  var values = [], host = new URL(url).hostname;
  try { values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || '']; } catch (_) {}
  values.forEach(function(value) { String(value).split(/\n|,(?=[^;,]+=)/).forEach(function(item) { var pair = item.split(';')[0], at = pair.indexOf('='); if (at > 0) uhdCookies(state, host)[pair.slice(0, at).trim()] = pair.slice(at + 1).trim(); }); });
}
async function uhdRequest(url, state, options) {
  options = options || {}; var left = Math.min(5500, state.deadline - Date.now());
  if (left < 100) throw new Error('budget exhausted');
  var headers = Object.assign({ 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, options.headers || {}), host = new URL(url).hostname;
  var jar = uhdCookies(state, host), cookie = Object.keys(jar).map(function(k) { return k + '=' + jar[k]; }).join('; ');
  if (cookie) headers.Cookie = cookie;
  var timer;
  try { return await Promise.race([
    Promise.resolve().then(async function() {
      var r = await fetch(url, Object.assign({}, options, { headers: headers }));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      uhdSaveCookies(r, state, r.url || url);
      var contentType = ''; try { contentType = r.headers.get('content-type') || ''; } catch (_) {}
      if (/^(?:video\/|application\/octet-stream)/i.test(contentType)) return { url: r.url || url, media: true, contentType: contentType, body: '' };
      var body = await r.text(); if (body.length > 2000000) throw new Error('response too large');
      return { url: r.url || url, body: body, contentType: contentType };
    }),
    new Promise(function(_, reject) { timer = setTimeout(function() { reject(new Error('request timeout')); }, left); })
  ]); } finally { clearTimeout(timer); }
}
function uhdRedirect(html) {
  var $ = uhdCheerio.load(html), refresh = $('meta[http-equiv]').filter(function(_, e) { return String($(e).attr('http-equiv')).toLowerCase() === 'refresh'; }).attr('content') || '';
  var meta = /url\s*=\s*['"]?([^'";]+)/i.exec(refresh); if (meta) return meta[1];
  var js = /(?:location(?:\.href)?\s*=\s*|location\.replace\(\s*|setAttribute\(\s*['"]href['"]\s*,\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, m;
  var scripts = $('script').map(function(_, e) { return $(e).html() || ''; }).get().join('\n');
  while ((m = js.exec(scripts))) {
    var value; try { value = m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1).replace(/\\\//g, '/'); } catch (_) { continue; }
    if (/^(?:https?:\/\/|\/|\?)/i.test(value)) return value;
  }
  return '';
}
function uhdScriptCookies(html, state, pageUrl) {
  var $ = uhdCheerio.load(html), scripts = $('script').map(function(_, e) { return $(e).html() || ''; }).get().join('\n');
  var re = /\bsc\(\s*("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*")/g, m;
  while ((m = re.exec(scripts))) { try { uhdCookies(state, new URL(pageUrl).hostname)[JSON.parse(m[1])] = JSON.parse(m[2]); } catch (_) {} }
}
function uhdMediaUrl(url) { return /\.(?:mkv|mp4|m3u8|mpd)(?:[?#]|$)/i.test(url); }
function uhdOutput(url, item, server, headers, type) {
  return { url: url, name: 'UHDMovies • ' + server, title: item.fileName || 'UHDMovies', quality: item.quality || 'Unknown', audioLanguages: item.audioLanguages || [], fileName: item.fileName || '', serverName: server, provider: 'uhdmovies', headers: headers || {}, type: type || (/\.m3u8(?:[?#]|$)/i.test(url) ? 'm3u8' : /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : 'mkv') };
}
async function uhdResolve(start, item, state, depth, seen) {
  if (depth > 10 || state.deadline - Date.now() < 200) return [];
  seen = seen || {}; var url = uhdUrl(start); if (!url || seen[url]) return []; seen[url] = true;
  if (uhdMediaUrl(url)) return [uhdOutput(url, item, new URL(url).hostname)];
  var parsed = new URL(url);
  if (/(?:^|\.)video-seed\.[a-z.]+$/i.test(parsed.hostname) && parsed.searchParams.get('url')) {
    var api = await uhdRequest(parsed.origin + '/api', state, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-token': parsed.hostname, Referer: url }, body: new URLSearchParams({ keys: parsed.searchParams.get('url') }).toString() });
    var payload; try { payload = JSON.parse(api.body); } catch (_) { uhdLog('VIDEOSEED', 'Invalid API JSON'); return []; }
    var direct = payload && !payload.error && uhdUrl(payload.url);
    if (!direct || /video-seed\./i.test(new URL(direct).hostname)) { uhdLog('VIDEOSEED', 'API returned no direct media URL'); return []; }
    return [uhdOutput(direct, item, 'VideoSeed')];
  }
  var response = await uhdRequest(url, state), current = response.url, body = response.body;
  var finalLocation = new URL(current);
  if (current !== url && /(?:^|\.)video-seed\.[a-z.]+$/i.test(finalLocation.hostname) && finalLocation.searchParams.get('url')) return uhdResolve(current, item, state, depth + 1, seen);
  if (response.media) return [uhdOutput(current, item, new URL(current).hostname)];
  if (/^\s*#EXTM3U\b/.test(body)) return [uhdOutput(current, item, new URL(current).hostname, {}, 'm3u8')];
  if (!body) return [];
  var $ = uhdCheerio.load(body), host = new URL(current).hostname;
  if (/driveseed|driveleech/i.test(host)) {
    var file = $('li.list-group-item').first().text(), data = uhdRelease(file);
    var fileEpisode = /\bS(\d{1,2})[ ._-]*E(\d{1,4})\b/i.exec(file);
    if (fileEpisode && item.expectedEpisode && (Number(fileEpisode[1]) !== item.expectedSeason || Number(fileEpisode[2]) !== item.expectedEpisode)) { uhdLog('EPISODE_REJECT', 'File-host filename differs from requested season/episode'); return []; }
    if (data.quality === 'Unknown') data.quality = item.quality;
    if (!data.audioLanguages.length) data.audioLanguages = item.audioLanguages;
    if (!file) data.fileName = item.fileName;
    item = Object.assign({}, item, data);
  }
  uhdScriptCookies(body, state, current);
  var form = $('form#lp-land,form#lp-s1-form,form#landing').first();
  if (form.length) {
    uhdLog('SHORTLINK', host + ': ' + (form.attr('id') || 'navigation form'));
    var fields = {}, action = uhdUrl(form.attr('action') || current, current);
    form.find('input[name]').each(function(_, e) { fields[$(e).attr('name')] = $(e).attr('value') || ''; });
    if (action && Object.keys(fields).length) {
      // Parse only the site's known navigation forms; never execute page JS.
      var posted = await uhdRequest(action, state, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: current }, body: new URLSearchParams(fields).toString() });
      return uhdResolvePage(posted, item, state, depth + 1, seen);
    }
  }
  return uhdResolvePage(response, item, state, depth, seen);
}
async function uhdResolvePage(response, item, state, depth, seen) {
  if (depth > 10 || state.deadline - Date.now() < 200) return [];
  var current = response.url, body = response.body, $ = uhdCheerio.load(body);
  if (response.media || /^\s*#EXTM3U\b/.test(body)) return [uhdOutput(current, item, new URL(current).hostname, {}, /^\s*#EXTM3U\b/.test(body) ? 'm3u8' : undefined)];
  uhdScriptCookies(body, state, current);
  var form = $('form#lp-land,form#lp-s1-form,form#landing').first();
  if (form.length) {
    uhdLog('SHORTLINK', new URL(current).hostname + ': ' + (form.attr('id') || 'navigation form'));
    var action = uhdUrl(form.attr('action') || current, current), fields = {};
    form.find('input[name]').each(function(_, e) { fields[$(e).attr('name')] = $(e).attr('value') || ''; });
    if (action && Object.keys(fields).length) {
      var posted = await uhdRequest(action, state, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: current }, body: new URLSearchParams(fields).toString() });
      return uhdResolvePage(posted, item, state, depth + 1, seen);
    }
  }
  var redirect = uhdUrl(uhdRedirect(body), current);
  if (redirect) { uhdLog('REDIRECT', new URL(current).hostname + ' -> ' + new URL(redirect).hostname); return uhdResolve(redirect, item, state, depth + 1, seen); }
  // Follow only named file-host actions, never article/ad/navigation anchors.
  var links = [];
  $('a[href]').each(function(_, e) {
    var text = $(e).text().replace(/\s+/g, ' ').trim(), href = uhdUrl($(e).attr('href'), current);
    if (!href) return;
    if (/^(?:instant download|resume cloud|cloud download|download now|direct download|download file|watch online)/i.test(text) || $(e).is('a.btn-success')) links.push(href);
    else if (uhdMediaUrl(href) && /download|watch/i.test(text)) links.push(href);
  });
  links = links.filter(function(x, i) { return links.indexOf(x) === i; }).slice(0, 2);
  if (!links.length && /(?:^|\.)(?:driveseed|driveleech)\./i.test(new URL(current).hostname) && /^\/(?:zfile|file)\//.test(new URL(current).pathname)) {
    var key = /formData\.append\(\s*["']key["']\s*,\s*["']([^"']+)["']\s*\)/.exec(body);
    var action = /async function generate\(action\s*=\s*["'](cloud|original)["']/.exec(body);
    var token = /var cf_token\s*=\s*["']([^"']*)["']/.exec(body);
    if (key && action) {
      var boundary = '----UHDMoviesFormBoundary', fields = { action: action[1], key: key[1], action_token: token ? token[1] : '' }, parts = [];
      Object.keys(fields).forEach(function(name) { parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + fields[name] + '\r\n'); });
      var api = await uhdRequest(current, state, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'x-token': new URL(current).hostname, Referer: current }, body: parts.join('') + '--' + boundary + '--\r\n' });
      var payload; try { payload = JSON.parse(api.body); } catch (_) { uhdLog('HOST_API', 'Invalid JSON from file host'); return []; }
      if (!payload || payload.error) { uhdLog('HOST_API', 'File host declined ' + action[1] + ' link generation'); return []; }
      var visit = uhdUrl(payload.visit_url), direct = uhdUrl(payload.url);
      if (visit) return uhdResolve(visit, item, state, depth + 1, seen);
      if (direct) return [uhdOutput(direct, item, 'Driveseed ' + action[1])];
      uhdLog('HOST_API', 'File host returned no URL'); return [];
    }
  }
  var batches = await Promise.all(links.map(async function(link) {
    try {
      var parsed = new URL(link), embedded = uhdUrl(parsed.searchParams.get('url'));
      if (embedded && uhdMediaUrl(embedded)) return [uhdOutput(embedded, item, parsed.hostname)];
      return await uhdResolve(link, item, state, depth + 1, Object.assign({}, seen));
    } catch (e) { uhdLog('HOST_ERROR', /HTTP \d+|request timeout|budget exhausted/.exec(e.message) || 'resolver failure'); return []; }
  }));
  var results = []; batches.forEach(function(rows) { results = results.concat(rows); });
  if (!results.length) uhdLog('UNRESOLVED', new URL(current).hostname + ': no verified media URL; HTML not returned as video');
  return results;
}
async function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === 'series' ? 'tv' : mediaType;
  if (!/^\d+$/.test(String(tmdbId)) || Number(tmdbId) < 1 || ['movie', 'tv'].indexOf(mediaType) < 0) return [];
  if (mediaType === 'tv' && (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 1)) return [];
  var state = uhdState();
  try {
    var metadataUrl = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?api_key=1865f43a0549ca50d341dd9ab8b29f49&append_to_response=external_ids,alternative_titles';
    var metaTask = vueoSharedTmdb(metadataUrl, async function() { return JSON.parse((await uhdRequest(metadataUrl, state)).body); });
    var domainTask = uhdRequest(UHD_DOMAINS, state).then(function(r) { var domain = uhdUrl(JSON.parse(r.body).UHDMovies); return domain || UHD_BASE; }).catch(function() { return UHD_BASE; });
    var initial = await Promise.all([metaTask, domainTask]), meta = initial[0], base = initial[1], profile = buildTitleProfile(meta);
    if (!profile.title) return [];
    var target = '', queries = profile.aliases.slice(0, 3);
    for (var q = 0; q < queries.length && !target; q++) {
      var search = await uhdRequest(base.replace(/\/$/, '') + '/?s=' + encodeURIComponent(queries[q]), state), $ = uhdCheerio.load(search.body);
      $('article.gridlove-post,article.latestPost').each(function(_, e) {
        var label = $(e).find('h1.sanket,h2.title a,h2 a,h3 a').first().text() || $(e).find('a[title]').attr('title') || '';
        if (!uhdMatches(label, meta)) return;
        var href = uhdUrl($(e).find('div.entry-image > a,h2.title a,a').first().attr('href'), search.url); if (href && !target) target = href;
      });
    }
    if (!target) { uhdLog('TITLE_MATCH', 'No exact title/year candidate; refusing partial-title match'); return []; }
    var page = await uhdRequest(target, state), $page = uhdCheerio.load(page.body), heading = $page('h1').first().text();
    if (!uhdMatches(heading, meta)) { uhdLog('TITLE_MATCH', 'Detail title/year mismatch'); return []; }
    uhdLog('TITLE_MATCH', 'Exact site title/year: ' + profile.title);
    var items = uhdItems(page.body, page.url, mediaType, season, episode);
    uhdLog('EPISODE_MATCH', mediaType === 'tv' ? 'S' + Number(season) + ' E' + Number(episode) + ': ' + items.length + ' exact season/episode release(s)' : items.length + ' movie release(s)');
    var original = String(meta.original_language || '').toLowerCase(), result = [], seen = {};
    items = items.filter(function(x) { if (original && x.audioLanguages.length && x.audioLanguages.indexOf(original) < 0) { uhdLog('AUDIO_FILTER', 'Release lacks original audio ' + original); return false; } return true; }).slice(0, 8);
    var cursor = 0;
    async function worker() {
      while (cursor < items.length && state.deadline - Date.now() > 300) {
        var index = cursor++, item = items[index];
        try {
          var rows = await uhdResolve(item.url, item, state, 0, {});
          rows.forEach(function(row) { if (!seen[row.url] && (!original || !row.audioLanguages.length || row.audioLanguages.indexOf(original) >= 0)) { seen[row.url] = true; result.push({ index: index, row: row }); } });
        } catch (e) { uhdLog('RESOLVE_ERROR', /HTTP \d+|request timeout|budget exhausted/.exec(e.message) || 'resolver failure'); }
      }
    }
    var workers = Promise.all([worker(), worker()]), timer;
    try { await Promise.race([workers, new Promise(function(resolve) { timer = setTimeout(resolve, Math.max(1, state.deadline - Date.now())); })]); } finally { clearTimeout(timer); }
    result.sort(function(a, b) { return a.index - b.index; });
    uhdLog('RESULT', result.length + ' media source(s); quality from release labels; playback not verified');
    return result.map(function(x) { return x.row; });
  } catch (e) { uhdLog('ERROR', /HTTP \d+|request timeout|budget exhausted/.exec(e.message) || 'metadata/parser failure'); return []; }
}
module.exports = { getStreams: getStreams };

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
module.exports = cloudbankDisplayInstall(module.exports, "UHDMovies", "uhdmovies");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
