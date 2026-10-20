/* Cinevibe 2.0.0 — audited cinevibe.cc watch player, 2026-10-20.
 * VUEO_SHARED_DISCOVERY_CONTEXT_V1: display metadata only; no metadata request needed.
 * VUEO_TITLE_PROFILE_V1: website publishes exact TMDB movie and episode embed routes.
 * Uses the existing generic webviewResolve bridge; no provider-specific app code.
 */
(function () {
  var SITE='https://cinevibe.cc/';
  var PLAYER='https://vidsrc.wtf/api/1/';
  var BLOCKED=['youtube.com','googlevideo.com','doubleclick','googlesyndication','googleadservices','popads','popcash','adsterra','exoclick','reemilsie.com','ordainsmirky.com','rosesilvers.com','/ads/','/vast','/trailer','/preview','/sample'];
  function log(message){console.log('[Cinevibe] '+message);}
  function trace(stage,details){try{if(typeof globalThis.vueoTrace==='function')globalThis.vueoTrace(stage,details);}catch(_){}}
  function bounded(work,ms){return new Promise(function(resolve){var done=false,timer=setTimeout(function(){finish(null);},ms);function finish(v){if(done)return;done=true;clearTimeout(timer);resolve(v);}Promise.resolve().then(work).then(finish,function(){finish(null);});});}
  function cleanUrl(raw){try{var u=new URL(String(raw||''));return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!u.hash?u:null;}catch(_){return null;}}
  function blocked(raw){var u=cleanUrl(raw);if(!u)return true;var value=(u.hostname+u.pathname).toLowerCase();return BLOCKED.some(function(x){return value.indexOf(x)!==-1;});}
  function kind(raw){var u=cleanUrl(raw);if(!u||blocked(raw))return '';var p=u.pathname.toLowerCase();return /\.mp4$/.test(p)?'mp4':/\.m3u8$/.test(p)?'hls':'';}
  function playbackHeaders(row,embed){var out={};Object.keys(row.headers||{}).forEach(function(key){var value=String(row.headers[key]);if(/^(host|connection|content-length|accept-encoding|range|sec-.*)$/i.test(key)||/[\r\n\x00]/.test(key+value))return;out[key]=value;});if(!Object.keys(out).some(function(k){return k.toLowerCase()==='referer';}))out.Referer=embed;return out;}
  function display(id,type,season,episode){var c=globalThis.VUEO_DISCOVERY_CONTEXT;if(typeof c==='string'){try{c=JSON.parse(c);}catch(_){c=null;}}var m=c&&(c.tmdb||c);var title=m&&String(c.tmdbId||m.id)===id&&(!c.mediaType||c.mediaType===type)?String(m.title||m.name||c.title||''):'';return (title||'Cinevibe · TMDB '+id)+(type==='tv'?' · S'+season+'E'+episode:'');}
  function subtitles(session){var seen=Object.create(null);return (Array.isArray(session.subtitles)?session.subtitles:[]).slice(0,32).filter(function(row){if(!row||blocked(row.url)||!/\.(vtt|srt)(?:$|[?#])/i.test(row.url)||/thumbnail|sprite|chapter/i.test(String(row.label||''))||seen[row.url])return false;seen[row.url]=true;return true;}).map(function(row){var language=String(row.language||'und').toLowerCase();return {url:row.url,label:String(row.label||language),language:language,headers:playbackHeaders(row,PLAYER),mimeType:/\.vtt(?:$|[?#])/i.test(row.url)?'text/vtt':'application/x-subrip'};});}
  async function verify(row,embed){
    var format=kind(row.url),h=playbackHeaders(row,embed);if(!format)return null;
    var response=await fetch(row.url,{method:'GET',headers:format==='mp4'?Object.assign({},h,{Range:'bytes=0-1'}):h,redirect:'follow'});
    var status=Number(response.status);if(status===403||status===429)return {stop:true,status:status};
    var finalUrl=response.url||row.url;if(kind(finalUrl)!==format)return null;
    var mime=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(format==='mp4'){
      // Native VUEO deliberately omits binary bodies. This validates ranged transport, not decoded frames.
      if(status!==206||!/^bytes\s+0-1\/(\d+)$/i.test(String(response.headers.get('content-range')||'')))return null;
      var total=Number(String(response.headers.get('content-range')).split('/').pop());
      if(total<1024||!(/^(?:video\/mp4|application\/octet-stream|binary\/octet-stream)$/.test(mime)))return null;
      var length=response.headers.get('content-length');if(length&&Number(length)!==2)return null;
      return {url:finalUrl,headers:h,type:'direct',mimeType:'video/mp4',quality:'Unknown'};
    }
    if(!response.ok||/html|json|javascript/.test(mime))return null;
    var text=String(await response.text()).replace(/^\uFEFF/,'').trim();if(!/^#EXTM3U\b/.test(text))return null;
    var master=/#EXT-X-STREAM-INF:/.test(text);if(!master&&!/#EXTINF:/.test(text))return null;
    return {url:finalUrl,headers:h,type:'hls',mimeType:'application/x-mpegURL',quality:master?'Auto':'Unknown'};
  }
  async function getStreams(tmdbId,mediaType,season,episode){
    var id=String(tmdbId||''),type=mediaType==='series'?'tv':mediaType;
    if(!/^[1-9]\d*$/.test(id)||['movie','tv'].indexOf(type)<0)return [];
    if(type==='tv'&&(!/^(0|[1-9]\d*)$/.test(String(season))||!/^[1-9]\d*$/.test(String(episode))))return [];
    var embed=PLAYER+type+'/?id='+id+(type==='tv'?'&s='+Number(season)+'&e='+Number(episode):'')+'&color=e01621&autoPlay=true';
    log('ROUTE: cinevibe.cc website Server 1; exact TMDB '+id+' '+type+(type==='tv'?' S'+season+'E'+episode:'')+'; no title search or legacy token');
    if(typeof globalThis.webviewResolve!=='function'){log('UNAVAILABLE: existing generic WebView bridge required');return [];}
    trace('CANDIDATE',{provider:'cinevibe',tmdbId:id,mediaType:type,season:type==='tv'?Number(season):null,episode:type==='tv'?Number(episode):null,method:'website-published-tmdb-embed'});
    // The published player expects an iframe. Preserve that context and Cinevibe Referer.
    var session=await bounded(function(){return globalThis.webviewResolve(embed,{referer:SITE,directLoad:false,timeoutMs:10000,finishAfterFirstMs:300,captureSubtitles:true,waitForMediaReady:false,injectAbyssHook:false,suppressPopups:true,lockMainFrameHost:true,blockMatchedRequests:false,viewportWidth:1080,viewportHeight:720,clickX:540,clickY:360,clickDelaysMs:[800,1800,3500,6000,8500],match:['.mp4','.m3u8'],blocked:BLOCKED});},10500);
    if(!session||!Array.isArray(session.streams)){log('NO_RESULT: browser session did not return media');return [];}
    var seen=Object.create(null),rows=session.streams.filter(function(row){if(!row||!kind(row.url)||seen[row.url])return false;seen[row.url]=true;return true;});
    log('CAPTURE: '+rows.length+' media candidates; validate first available; no signed URL cache');
    for(var i=0;i<Math.min(rows.length,2);i++){
      var accepted=await bounded(function(){return verify(rows[i],embed);},2300);
      if(accepted&&accepted.stop){log('STOP: media HTTP '+accepted.status+'; no further candidate requests');return [];}
      if(!accepted)continue;
      log('VERIFIED: '+(accepted.type==='direct'?'MP4 GET 206 range headers':'HLS playlist')+'; decoded playback remains unverified');
      trace('VERIFICATION',{provider:'cinevibe',transport:accepted.type,matching:'exact requested TMDB embed; audiovisual content unverified'});
      return [Object.assign({name:'Cinevibe',provider:'cinevibe',serverName:'Cinevibe · Server 1',title:display(id,type,season,episode),subtitles:subtitles(session)},accepted)];
    }
    log('NO_RESULT: no validated media from website Server 1');return [];
  }
  module.exports={getStreams:getStreams};globalThis.getStreams=getStreams;
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
module.exports = cloudbankDisplayInstall(module.exports, "Cinevibe", "cinevibe");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
