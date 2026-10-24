/* 4KHDHub 2.0.1 — website search -> exact release -> public gate -> file host.
 * One engine; no article crawling, legacy engine, external decrypt service or guessed API.
 */
(function(){
var SITE='https://4khdhub.one',UA='Mozilla/5.0',LIMIT=18500;
function log(s){console.log('[4KHDHub] '+s);}
function url(s,b){try{var u=new URL(String(s||''),b);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
function host(s){try{return new URL(s).hostname;}catch(_){return '';}}
function b64(s){var abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',bits=0,n=0,out='';s=String(s).replace(/-/g,'+').replace(/_/g,'/').replace(/\s/g,'');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('invalid base64');for(var i=0;i<s.length&&s[i]!=='=';i++){n=(n<<6)|abc.indexOf(s[i]);bits+=6;if(bits>=8){bits-=8;out+=String.fromCharCode((n>>bits)&255);}}return out;}
function rot(s){return s.replace(/[a-z]/ig,function(c){var a=c<='Z'?65:97;return String.fromCharCode(a+(c.charCodeAt(0)-a+13)%26);});}
function gate(html){var re=/\bs\(\s*['"]o['"]\s*,\s*['"]([^'"]+)['"]|\bck\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g,m,parts=[];while((m=re.exec(html)))parts.push(m[1]||m[2]);if(!parts.length)return '';try{var o=JSON.parse(b64(rot(b64(b64(parts.join(''))))));if(o.o)return url(b64(o.o));if(o.data&&o.blog_url)return url(o.blog_url)+'?re='+encodeURIComponent(b64(o.data));}catch(_){log('GATE: unsupported payload');}return '';}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function head(r,k){try{return String(r.headers.get(k)||'');}catch(_){return '';}}
function links(html,base){var $=require('cheerio-without-node-native').load(html),out=[],g=gate(html);if(g)return[g];
// Greenmotors article links are navigation, never download candidates.
if(/(^|\.)greenmotors\./i.test(host(base))){log('GATE: no decoded destination; stop article navigation');return [];}
try{var q=new URL(base).searchParams.get('link');if(q&&/downloadBtn/.test(html)&&/params\.get\(['"]link['"]\)/.test(html))return[url(q)];}catch(_){}
var v=/\b(?:var|let|const)\s+url\s*=\s*['"]([^'"]+)['"]/.exec(html);if(v&&/hubcloud\.php/.test(v[1]))out.push(url(v[1],base));
$('a[href]').each(function(_,e){var a=$(e),h=url(a.attr('href'),base),t=a.text();if(!h||/telegram|tutorial|how to|advert|watch online/i.test(t))return;if(a.attr('id')==='download'||a.attr('id')==='downloadBtn'||/hubcloud\.php|gpdl\.|hubdrive\.|hubcloud\.|pixeldrain\.|workers\.dev|googleusercontent\./i.test(h)&&/download|server|gbps|hubcloud|hubdrive/i.test(t))out.push(h);});
return out.filter(function(v,i,a){return v&&a.indexOf(v)===i;}).sort(function(a,b){function rank(u){return /workers\.dev|googleusercontent\./.test(host(u))?3:/hubcloud\.php/.test(u)?2:1;}return rank(b)-rank(a);}).slice(0,5);}
async function run(id,type,season,episode){var start=Date.now(),active=true,pending=[],cache={},results=[],seen={};
function remaining(){return LIMIT-(Date.now()-start);}
function stop(){active=false;pending.slice().forEach(function(f){f();});}
async function request(u,method,referer,range){if(!active||remaining()<100)throw Error('deadline');var key=(method||'GET')+u+(range||'');if(cache[key])return cache[key];return cache[key]=new Promise(function(resolve,reject){var done=false,c=typeof AbortController==='function'?new AbortController():null;
function finish(err,r){if(done)return;done=true;clearTimeout(timer);pending=pending.filter(function(x){return x!==cancel;});if(err){if(c)c.abort();reject(err);}else resolve(r);}
function cancel(){finish(Error('cancelled'));}pending.push(cancel);var timer=setTimeout(function(){finish(Error('timeout'));},Math.min(6000,remaining()));var h={'User-Agent':UA,Referer:referer||SITE+'/'};if(range)h.Range=range;
Promise.resolve().then(function(){return fetch(u,{method:method||'GET',headers:h,signal:c?c.signal:undefined,redirect:'follow'});}).then(async function(r){var ct=head(r,'content-type'),binary=method==='HEAD'||range||/^video\//i.test(ct)||/octet-stream|matroska/i.test(ct);var text=binary?'':await r.text();if(binary&&r.body&&r.body.cancel)Promise.resolve(r.body.cancel()).catch(function(){});finish(null,{status:r.status,ok:r.ok,url:r.url||u,headers:r.headers,text:text});}).catch(function(e){finish(e);});});}
function episodeOK(text){if(type!=='tv')return true;var re=/\bS0*(\d+)[ ._-]*E0*(\d+)\b/ig,m;while((m=re.exec(text)))if(+m[1]!==season||+m[2]!==episode)return false;return true;}
async function resolve(u,ref,depth,path){if(!active||depth>8||path.indexOf(u)>=0)return null;path=path.concat(u);try{var file=/\.(mkv|mp4|webm|m4v)(?:[?#]|$)|workers\.dev|googleusercontent\.|pixeldrain\./i.test(u),r;if(file){u=u.replace(/(pixeldrain\.[^/]+)\/u\/([^/?#]+)/i,'$1/api/file/$2?download');r=await request(u,'HEAD',ref);if([403,405].indexOf(r.status)>=0)r=await request(u,'GET',ref,'bytes=0-1');}else r=await request(u,'GET',ref);
var ct=head(r,'content-type').toLowerCase();if(!r.ok){log('HTTP '+r.status+' host='+host(u));return null;}
if(!episodeOK(decodeURIComponent(r.url)+' '+head(r,'content-disposition')))return null;
if(/^video\//.test(ct)||/octet-stream|matroska/.test(ct)){return{url:r.url,mimeType:ct,headers:{'User-Agent':UA,Referer:ref},quality:null};}
if(/^\s*#EXTM3U\b/.test(r.text)&&/#EXT(?:INF|-X-STREAM-INF):/.test(r.text))return{url:r.url,mimeType:'application/vnd.apple.mpegurl',type:'hls',quality:/#EXT-X-STREAM-INF:/.test(r.text)?'Auto':'Unknown',headers:{'User-Agent':UA,Referer:ref}};
if(/file not found|file has been (?:deleted|removed)|NoSuchKey/i.test(r.text))return null;
var next=links(r.text,r.url);log('STEP '+depth+' host='+host(r.url)+' download routes='+next.length);for(var j=0;j<next.length&&active;j++){var hit=await resolve(next[j],r.url,depth+1,path);if(hit)return hit;}
}catch(e){log('REQUEST '+String(e.message||e)+' host='+host(u));}return null;}
var timer=setTimeout(stop,LIMIT);try{
var metadataUrl='https://api.themoviedb.org/3/'+type+'/'+id+'?api_key=1865f43a0549ca50d341dd9ab8b29f49';
function normalizeMetadata(raw){
 if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch(_){return null;}}
 if(!raw||typeof raw!=='object'||raw.error)return null;
 var m=raw.tmdb&&typeof raw.tmdb==='object'?raw.tmdb:raw;
 var suppliedId=raw.tmdbId||m.id;
 if(suppliedId!=null&&String(suppliedId)!==id)return null;
 var suppliedType=raw.mediaType==='series'?'tv':raw.mediaType;
 if(suppliedType&&suppliedType!==type)return null;
 var name=String(m.title||m.name||raw.title||'').trim();if(!name)return null;
 return {id:id,title:type==='movie'?name:undefined,name:type==='tv'?name:undefined,
 original_title:m.original_title||raw.originalTitle||name,original_name:m.original_name||raw.originalTitle||name,
 release_date:m.release_date||(raw.year?String(raw.year)+'-01-01':''),first_air_date:m.first_air_date||(raw.year?String(raw.year)+'-01-01':''),
 original_language:m.original_language||raw.originalLanguage||''};
}
var meta=normalizeMetadata(globalThis.VUEO_DISCOVERY_CONTEXT);
if(!meta&&typeof globalThis.vueoDiscoveryContext==='function'){
 var shared=await new Promise(function(resolve){var done=false,t=setTimeout(function(){finish(null);},Math.min(1500,remaining()));function finish(v){if(done)return;done=true;clearTimeout(t);resolve(v);}Promise.resolve().then(function(){return globalThis.vueoDiscoveryContext(metadataUrl);}).then(finish,function(){finish(null);});});
 meta=normalizeMetadata(shared);
}
if(!meta){log('METADATA: shared title missing or mismatched; request TMDB fallback');var md=await request(metadataUrl);if(!md.ok)throw Error('metadata HTTP '+md.status);meta=normalizeMetadata(JSON.parse(md.text));}
if(!meta){log('METADATA: no usable title; search not started');return [];}
log('METADATA: title ready; website search starting');
var title=meta.title||meta.name,year=String(meta.release_date||meta.first_air_date||'').slice(0,4),aliases=[title,meta.original_title||meta.original_name].filter(Boolean);var detail='';
for(var qi=0;qi<aliases.length&&!detail;qi++){if(qi&&norm(aliases[qi])===norm(aliases[0]))continue;var sr=await request(SITE+'/?s='+encodeURIComponent(aliases[qi]));if(!sr.ok)continue;var $=require('cheerio-without-node-native').load(sr.text);$('.movie-card').each(function(_,el){var c=$(el),name=c.find('.movie-card-title').text().trim(),text=c.text(),href=url(c.find('a[href]').first().attr('href'),SITE),fm=c.find('.movie-card-format').text(),y=/\b(19\d{2}|20\d{2})\b/.exec(text);if(aliases.some(function(a){return norm(a)===norm(name);})&&(!year||!y||year===y[1])&&(type==='tv'?/series/i.test(fm)||/-series-/.test(href):/movie/i.test(fm)||/-movie-/.test(href)))detail=href;});}
if(!detail){log('SEARCH: no exact title/year/type');return [];}
var page=await request(detail),$=require('cheerio-without-node-native').load(page.text),releases=[];var nodes=type==='tv'?$('.episodes-list .season-item').filter(function(_,el){var s=/\b(?:Season\s*|S)0*(\d+)\b/i.exec($(el).find('.episode-number').first().text());return s&&+s[1]===season;}).find('.episode-download-item'):$('.download-item');
nodes.each(function(_,el){var a=$(el),text=a.text().replace(/\s+/g,' ').trim();if(type==='tv'){var ep=/Episode-?0*(\d+)/i.exec(a.find('.episode-file-info').text());if(!ep||+ep[1]!==episode||!episodeOK(text))return;}var names={English:'en',Hindi:'hi',Japanese:'ja',Korean:'ko',Chinese:'zh',Tamil:'ta',Telugu:'te',Malay:'ms',French:'fr',German:'de',Spanish:'es'},langs=[];Object.keys(names).forEach(function(k){if(new RegExp('\\b'+k+'\\b','i').test(text))langs.push(names[k]);});if(langs.length&&meta.original_language&&langs.indexOf(meta.original_language)<0)return;var size=/(\d+(?:\.\d+)?)\s*(GB|MB)/i.exec(text),quality=/\b(2160|1080|720|480)p\b/i.exec(text);a.find('a[href]').each(function(_,e){var label=$(e).text(),u=url($(e).attr('href'),detail);if(/HubCloud|HubDrive/i.test(label)&&u)releases.push({url:u,text:text,quality:quality?quality[0]:'Unknown',langs:langs,size:size?+size[1]*(size[2].toUpperCase()==='GB'?1024:1):Infinity,priority:/HubCloud/i.test(label)?0:1});});});
releases.sort(function(a,b){return a.priority-b.priority||a.size-b.size;});log('MATCH '+title+' releases='+releases.length);var index=0;
async function worker(){while(active&&index<releases.length&&results.length<3){var r=releases[index++],hit=await resolve(r.url,detail,0,[]);if(hit&&active&&!seen[hit.url]){seen[hit.url]=true;results.push(Object.assign({name:'4KHDHub',title:title,serverName:host(hit.url),audioLanguages:r.langs,subtitles:[],sourceVerified:true,playbackVerified:false},hit,{quality:hit.quality||r.quality}));}}}
await Promise.all([worker(),worker()]);return results;
}catch(e){log('FAILED '+String(e.message||e));return results;}finally{clearTimeout(timer);stop();log('v2.0.1 sources='+results.length);}}
module.exports={getStreams:function(id,type,s,e){type=type==='series'?'tv':type;if(!/^[1-9]\d*$/.test(String(id))||['movie','tv'].indexOf(type)<0||type==='tv'&&(s==null||e==null||!Number.isInteger(+s)||+s<0||!Number.isInteger(+e)||+e<1))return Promise.resolve([]);return run(String(id),type,+s,+e);}};
if(typeof globalThis!=='undefined'){globalThis.getStreams=module.exports.getStreams;globalThis.fourKWebsiteTest={gate:gate,links:links,b64:b64};}
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
module.exports = cloudbankDisplayInstall(module.exports, "4KHDHub", "4khdhub");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
