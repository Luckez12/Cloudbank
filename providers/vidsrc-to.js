/* VidSrc.to 1.0.2 — direct TMDB embed route, existing VUEO WebView.
 * VUEO_SHARED_DISCOVERY_CONTEXT_V1: metadata is for display only.
 * VUEO_TITLE_PROFILE_V1: exact TMDB route; no fuzzy title search.
 * Confirmed docs: https://vidsrc.to/ ; movie + episode HTML fetched 2026-10-17.
 * Uses native JS/cookie handling. No CAPTCHA solver or clearance guarantee.
 */
(function () {
  var BASE = 'https://vidsrc.to';
  var BLOCKED = ['effectivecpmnetwork', 'doubleclick', 'googlesyndication',
    'googleadservices', 'popads', 'popcash', 'adsterra', 'exoclick', '/ads/', '/vast'];
  function log(s) { console.log('[VidSrc.to] ' + s); }
  function trace(stage, details) {
    try { if (typeof globalThis.vueoTrace === 'function') globalThis.vueoTrace(stage, details); } catch (_) {}
  }
  function blocked(url) {
    var s = String(url).toLowerCase();
    return BLOCKED.some(function (v) { return s.indexOf(v) !== -1; });
  }
  function bounded(work, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish(null); }, ms);
      function finish(value) { if (!done) { done = true; clearTimeout(timer); resolve(value); } }
      Promise.resolve().then(work).then(finish, function () { finish(null); });
    });
  }
  function headers(row, player) {
    var out = {}, src = row.headers || {};
    Object.keys(src).forEach(function (key) {
      if (/^(host|connection|content-length|accept-encoding|range|sec-.*)$/i.test(key)) return;
      out[key] = String(src[key]);
    });
    if (!Object.keys(out).some(function (k) { return k.toLowerCase() === 'referer'; })) out.Referer = player;
    return out;
  }
  function display(id, type, season, episode) {
    var raw = globalThis.VUEO_DISCOVERY_CONTEXT;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = null; } }
    var meta = raw && (raw.tmdb || raw);
    if (!meta || String(raw.tmdbId || meta.id) !== id || (raw.mediaType && raw.mediaType !== type)) return '';
    var title = String(meta.title || meta.name || raw.title || '');
    return title + (type === 'tv' ? ' · S' + season + 'E' + episode : '');
  }
  function language(row) {
    var raw = String(row.language || row.lang || row.srclang || row.label || '').trim();
    var key = raw.toLowerCase().replace(/[_-].*$/, '').replace(/[^a-z]/g, '');
    var codes = {en:'en',eng:'en',english:'en',ms:'ms',msa:'ms',may:'ms',malay:'ms',bahasamelayu:'ms',id:'id',ind:'id',indo:'id',indonesian:'id',bahasaindonesia:'id'};
    var named = /\b(English|Malay|Indonesian)\b/i.exec(String(row.label || row.name || ''));
    return codes[key] || (named ? codes[named[1].toLowerCase()] : (/^[a-z]{2,3}$/.test(key) ? key : 'und'));
  }
  function hasCues(text) {
    text = String(text || '').replace(/^\uFEFF/, '').trim();
    if (/^(?:<!doctype|<html|<\?xml)/i.test(text) || /#xywh[=:]/i.test(text)) return false;
    return /(?:^|\n)(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}[^\n]*\n[^\n]*\S/.test(text);
  }
  async function verifiedSubtitles(result, player) {
    if (!result || !Array.isArray(result.subtitles)) log('SUBTITLE: native subtitle bridge unavailable; install companion app patch');
    var rows = result && Array.isArray(result.subtitles) ? result.subtitles.slice(0,32) : [];
    // HLS subtitle renditions stay in the original master playlist; only sidecars are forwarded.
    var seen = Object.create(null);
    rows = rows.filter(function(row) {
      if (!row || /thumbnail|sprite|chapter/i.test(String(row.label || row.kind || '')) || !/^https?:\/\//i.test(String(row.url || '')) || blocked(row.url) || seen[row.url]) return false;
      seen[row.url] = true; return true;
    });
    rows.sort(function(a,b) {
      function rank(r) { var i=['en','ms','id'].indexOf(language(r)); return i<0?3:i; }
      return rank(a)-rank(b);
    });
    log('SUBTITLE: captured=' + rows.length);
    var verified = await Promise.all(rows.slice(0,8).map(function(row) {
      return bounded(async function() {
        var h = headers(row, player);
        var response = await fetch(row.url, {headers:h, redirect:'follow'});
        if (!response.ok) return null;
        var body = await response.text();
        if (!hasCues(body)) return null;
        var lang=language(row), label=String(row.label || row.name || lang || 'Subtitle');
        return {url:response.url || row.url, language:lang, label:label, headers:h,
          mimeType:/^\s*(?:\uFEFF)?WEBVTT/.test(body)?'text/vtt':'application/x-subrip'};
      }, 1200);
    }));
    var out=verified.filter(Boolean);
    log('SUBTITLE: validated=' + out.length + '; cue text checked');
    return out;
  }
  async function getStreams(tmdbId, mediaType, season, episode) {
    var id = String(tmdbId || ''), type = mediaType === 'series' ? 'tv' : mediaType;
    if (!/^[1-9]\d*$/.test(id) || (type !== 'movie' && type !== 'tv')) return [];
    if (type === 'tv' && (season === null || season === '' || typeof season === 'undefined' ||
        !Number.isInteger(Number(season)) || Number(season) < 0 ||
        !Number.isInteger(Number(episode)) || Number(episode) < 1)) return [];
    season = Number(season); episode = Number(episode);
    var embed = BASE + '/embed/' + type + '/' + id + (type === 'tv' ? '/' + season + '/' + episode : '');
    log('ROUTE: TMDB=' + id + ' type=' + type + (type === 'tv' ? ' S' + season + 'E' + episode : '') + '; exact ID route, no title search');
    trace('CANDIDATE', { provider: 'vidsrc-to', tmdbId: id, mediaType: type, season: type === 'tv' ? season : null, episode: type === 'tv' ? episode : null, method: 'exact-tmdb-route' });
    if (typeof globalThis.webviewResolve !== 'function') {
      log('UNAVAILABLE: native webviewResolve bridge required'); return [];
    }
    var player = embed;
    log('PLAYER: original VidSrc.to entry; preserve iframe context');
    log('WEBVIEW: one session; native JavaScript/cookies; no HTTP preflight');
    var result = await bounded(function () {
      return globalThis.webviewResolve(player, {
        referer: 'https://yumeflix.site/', directLoad: true, captureSubtitles: true, timeoutMs: 12000,
        finishAfterFirstMs: 500, suppressPopups: true, lockMainFrameHost: false,
        interactionTexts: ['play', 'watch now', 'continue'], viewportWidth: 1080, viewportHeight: 1080,
        clickX: 540, clickY: 600, clickDelaysMs: [650, 1300, 2200, 3400, 5000, 7000, 9500],
        match: ['.m3u8'], blocked: BLOCKED
      });
    }, 12500);
    var rows = result && Array.isArray(result.streams) ? result.streams : [];
    var seen = Object.create(null);
    rows = rows.filter(function (row) {
      if (!row || !/^https?:\/\//i.test(String(row.url || '')) || blocked(row.url) ||
          !/\.m3u8(?:$|[?#])/i.test(row.url)) return false;
      if (seen[row.url]) return false;
      seen[row.url] = true; return true;
    });
    // Prefer an observed master URL, never invent one from a variant URL.
    rows.sort(function (a, b) { return Number(/master/i.test(b.url)) - Number(/master/i.test(a.url)); });
    log('CAPTURE: ' + rows.length + ' HLS candidates');
    for (var i = 0; i < Math.min(rows.length, 2); i++) {
      var row = rows[i], playbackHeaders = headers(row, player);
      var verified = await bounded(async function () {
        var response = await fetch(row.url, { headers: playbackHeaders, redirect: 'follow' });
        if (!response.ok) { log('VERIFY: HTTP ' + response.status); return null; }
        var text = String(await response.text()).replace(/^\uFEFF/, '').trim();
        if (text.indexOf('#EXTM3U') !== 0) return null;
        var master = /#EXT-X-STREAM-INF:/.test(text);
        if (!master && !/#EXTINF:/.test(text)) return null;
        return { url: response.url || row.url, master: master, text: text };
      }, 1800);
      if (!verified) continue;
      log('VERIFIED: ' + (verified.master ? 'master HLS' : 'media HLS') + '; stop extraction');
      trace('VERIFICATION', { provider: 'vidsrc-to', playlist: true, masterHls: verified.master,
        matching: 'requested TMDB route; audiovisual content unverified' });
      var subtitles = await verifiedSubtitles(result, player);
      return [{ name: 'VidSrc.to', title: display(id, type, season, episode) || 'VidSrc.to',
        url: verified.url, headers: playbackHeaders, quality: 'Auto', type: 'hls',
        provider: 'vidsrc-to', subtitles: subtitles }];
    }
    log('RESULT: 0 validated HLS streams; possible challenge, unavailable player, timeout or unsupported transport'); return [];
  }
  module.exports = { getStreams: getStreams };
  globalThis.getStreams = getStreams;
})();
