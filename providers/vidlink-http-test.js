/* VidLink WebView Test 0.2.0
 * VUEO_SHARED_DISCOVERY_CONTEXT_V1: use supplied metadata for display only.
 * VUEO_TITLE_PROFILE_V1: exact TMDB movie/season/episode route.
 * One original-page WebView; no API preflight, token service or subtitle fetch.
 * Uses existing native resolver. Captured URLs are candidates, not playback proof.
 */
(function () {
  var BASE = 'https://vidlink.pro';
  var BLOCKED = ['effectivecpmnetwork', 'doubleclick', 'googlesyndication',
    'googleadservices', 'popads', 'popcash', 'adsterra', 'exoclick', '/ads/', '/vast'];
  function log(s) { console.log('[VidLink WebView Test] ' + s); }
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
  function safeDiagnostic(value) {
    return String(value||'')
      .replace(/https?:\/\/[^\s<>"']+/gi,'[url]')
      .replace(/(["']?(?:cookie|authorization|token|sign|signature|key|hash)["']?\s*[:=]\s*)["']?[^\s,;<>]+/gi,'$1[redacted]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[ip]')
      .replace(/[A-Za-z0-9_+\/-]{32,}={0,2}/g,'[redacted]')
      .replace(/\s+/g,' ').trim().slice(0,350);
  }
  async function failureEvidence(response,row,proxy) {
    var fields=['content-type','server','cf-mitigated','x-error-code','x-proxy-error','x-upstream-status'];
    var details=fields.map(function(k){var v=response.headers.get(k);return v?k+'='+safeDiagnostic(v):'';}).filter(Boolean);
    log('HTTP_FAILURE: method=GET transport='+row.kind+' proxy='+proxy+' status='+response.status+' '+details.join(' '));
    try {
      var raw=String(await response.text()).slice(0,32768),message='';
      try {
        var json=JSON.parse(raw);
        if(object(json))['error','message','code','detail'].forEach(function(k){if(typeof json[k]==='string'||typeof json[k]==='number')message+=(message?' | ':'')+k+': '+json[k];});
      } catch(_) {}
      if(!message) {
        var title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw),h1=/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(raw);
        if(title||h1)message=[title&&title[1],h1&&h1[1]].filter(Boolean).join(' | ').replace(/<[^>]+>/g,' ');
        else if(!/<(?:html|script|body)\b/i.test(raw))message=raw;
      }
      log('HTTP_REASON: '+(safeDiagnostic(message)||'empty or unsupported response body'));
    } catch(_) {log('HTTP_REASON: body unavailable');}
  }

  function kind(url) {
    if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls';
    if (/\.mp4(?:$|[?#])/i.test(url)) return 'mp4';
    return '';
  }
  function eligible(row) {
    var url = String(row && row.url || '');
    try { new URL(url); } catch (_) { return false; }
    return /^https?:\/\//i.test(url) && kind(url) && !blocked(url) &&
      !/(?:^|[\/_-])(?:trailer|preview|sample|init|segment)(?:[\/_.?-]|$)/i.test(new URL(url).pathname);
  }
  async function verify(row, player) {
    var h = headers(row, player), transport = kind(row.url);
    return bounded(async function () {
      var probe = Object.assign({}, h);
      if (transport === 'mp4') probe.Range = 'bytes=0-1023';
      var response = await fetch(row.url, {method:'GET', headers:probe, redirect:'follow'});
      if (!response.ok) {
        row.accessDenied = [401,403,426,428,429].indexOf(response.status) >= 0;
        await failureEvidence(response, {kind:transport}, new URL(row.url).hostname === 'flood.sourcerrr.online');
        return null;
      }
      var ct = String(response.headers.get('content-type') || '').toLowerCase(), master = false;
      if (/text\/html|application\/json/.test(ct)) return null;
      if (transport === 'hls') {
        var text = String(await response.text()).replace(/^\uFEFF/, '').trim();
        if (text.indexOf('#EXTM3U') !== 0) return null;
        master = /#EXT-X-STREAM-INF:/.test(text);
        if (!master && !/#EXTINF:/.test(text)) return null;
      } else {
        var range = String(response.headers.get('content-range') || '');
        var total = /\/(\d+)\s*$/.exec(range);
        var size = total ? Number(total[1]) : Number(response.headers.get('content-length') || 0);
        if (response.status !== 200 && response.status !== 206) return null;
        if (response.status === 206 && !/^bytes\s+0-\d+\//i.test(range)) return null;
        if (!/^video\/mp4/.test(ct) || size < 524288) return null;
      }
      log('VERIFIED: ' + (master ? 'master HLS' : transport) + '; HTTP ' + response.status);
      return {url:response.url || row.url, headers:h, type:transport, master:master};
    }, 1800);
  }
  async function getStreams(tmdbId, mediaType, season, episode) {
    var id = String(tmdbId || ''), type = mediaType === 'series' ? 'tv' : mediaType;
    if (!/^[1-9]\d*$/.test(id) || ['movie','tv'].indexOf(type) < 0) return [];
    if (type === 'tv' && (season === null || season === '' || typeof season === 'undefined' ||
        !Number.isInteger(Number(season)) || Number(season) < 0 || episode === null || episode === '' ||
        !Number.isInteger(Number(episode)) || Number(episode) < 1)) return [];
    var s = Number(season), e = Number(episode);
    var player = BASE + '/' + type + '/' + id + (type === 'tv' ? '/' + s + '/' + e : '');
    log('ROUTE: TMDB=' + id + ' ' + type + (type === 'tv' ? ' S' + s + 'E' + e : '') + '; exact ID; no title search');
    trace('CANDIDATE', {provider:'vidlink-http-test',tmdbId:id,mediaType:type,season:type==='tv'?s:null,episode:type==='tv'?e:null,method:'exact-tmdb-original-webview'});
    if (typeof globalThis.webviewResolve !== 'function') {log('UNAVAILABLE: native WebView bridge required');return [];}
    log('MODE: one original-page WebView; no HTTP preflight; subtitle fetches=0');
    var result = await bounded(function () {
      return globalThis.webviewResolve(player, {
        referer:BASE+'/',directLoad:true,timeoutMs:12000,finishAfterFirstMs:700,
        suppressPopups:true,lockMainFrameHost:true,injectAbyssHook:false,blockMatchedRequests:false,
        interactionTexts:['play','watch now','continue'],viewportWidth:1080,viewportHeight:1080,
        clickX:540,clickY:540,clickDelaysMs:[650,1300,2200,3400,5000,7000,9500],
        match:['.m3u8','.mp4'],blocked:BLOCKED
      });
    }, 12500);
    var seen = Object.create(null);
    var rows = (result && Array.isArray(result.streams) ? result.streams : []).filter(function (r) {
      if (!eligible(r) || seen[r.url]) return false;
      seen[r.url]=true;return true;
    });
    rows.sort(function(a,b) {
      function rank(r) {return kind(r.url)==='hls' ? (/master/i.test(r.url)?3:2) : 1;}
      return rank(b)-rank(a);
    });
    log('CAPTURE: '+rows.length+' media candidates; checking outside WebView with session headers');
    var checks=0;
    for (var i=0;i<Math.min(rows.length,2);i++) {
      var row=rows[i];checks++;
      var checked=await verify(row,player);
      if (!checked) {if(row.accessDenied)break;continue;}
      log('RESULT: 1 verified source; stop; checks='+checks+'; subtitle fetches=0');
      trace('VERIFICATION',{provider:'vidlink-http-test',httpAccessible:true,masterHls:checked.master,identity:'exact requested route; audiovisual identity unverified'});
      return [{name:'VidLink WebView Test',title:display(id,type,s,e)||'VidLink WebView Test',
        url:checked.url,headers:checked.headers,quality:'Auto',type:checked.type,provider:'vidlink-http-test',subtitles:[]}];
    }
    log('RESULT: 0 validated sources; checks='+checks+'; captured URL alone is insufficient');
    return [];
  }
  module.exports={getStreams:getStreams};
  globalThis.getStreams=getStreams;
})();
