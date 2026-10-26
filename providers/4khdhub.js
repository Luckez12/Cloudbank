/* 4KHDHub 3.0.0 — website search -> detail -> published WATCH iframe -> captured media.
 * No download chain, media/seek probes or duplicate playlist fetch.
 */
(function(){
var SITE='https://4khdhub.one',UA='Mozilla/5.0';
function log(s){console.log('[4KHDHub] '+s);}
function url(s,b){if(!s)return '';try{var u=new URL(String(s),b);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
function host(s){try{return new URL(s).hostname;}catch(_){return '';}}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function normalizeSubs(session,referer){
 var rows=session&&Array.isArray(session.subtitles)?session.subtitles:[],out=[],seen={};
 rows.slice(0,64).forEach(function(x){if(!x)return;var u=url(x.url||x.file||x.src),label=String(x.label||x.display||x.name||'');if(!u||seen[u]||/thumbnail|sprite|chapter/i.test(label))return;
 var raw=String([x.language,x.lang,x.srclang,x.iso639,x.code].filter(function(v){return v&& !/^(?:und|unknown)$/i.test(String(v).trim());})[0]||'').trim().toLowerCase();
 if(!raw||raw==='und'||raw==='unknown')raw=label.toLowerCase();
 var lang=/^(?:en|eng|english)(?:$|[-_ (])/.test(raw)?'en':/^(?:ms|msa|may|malay|bahasa melayu|melayu)(?:$|[-_ (])/.test(raw)?'ms':/^[a-z]{2}(?:-[a-z]{2})?$/.test(raw)?raw:'und';
 if(lang!=='en'&&lang!=='ms')return;
 var path=new URL(u).pathname,mime=/\.vtt$/i.test(path)?'text/vtt':/\.srt$/i.test(path)?'application/x-subrip':String(x.mimeType||x.mime||'');
 if(!/^(?:text\/vtt|application\/x-subrip|application\/srt|text\/srt)$/i.test(mime))return;
 var h={};Object.keys(x.headers||{}).forEach(function(k){var v=String(x.headers[k]);if(!/^(?:host|connection|content-length|range)$/i.test(k)&&!/[\r\n]/.test(k+v))h[k]=v;});
 if(!Object.keys(h).some(function(k){return k.toLowerCase()==='referer';}))h.Referer=referer;
 seen[u]=true;out.push({url:u,language:lang,lang:lang,label:label||(lang==='en'?'English':lang==='ms'?'Bahasa Melayu':'Unknown'),mimeType:mime,headers:h});
 });return out;
}
async function run(id,type,season,episode){var active=true,pending=[],started=Date.now();
function stop(){active=false;pending.slice().forEach(function(f){f();});}
function request(u,referer){if(!active)return Promise.reject(Error('stopped'));return new Promise(function(resolve,reject){var done=false,c=typeof AbortController==='function'?new AbortController():null;function finish(err,v){if(done)return;done=true;clearTimeout(timer);pending=pending.filter(function(f){return f!==cancel;});if(err){if(c)c.abort();reject(err);}else resolve(v);}function cancel(){finish(Error('cancelled'));}pending.push(cancel);var timer=setTimeout(function(){finish(Error('request timeout'));},Math.min(4000,Math.max(1,12000-(Date.now()-started))));Promise.resolve().then(function(){if(!active||done)throw Error('stopped');return fetch(u,{headers:{'User-Agent':UA,Referer:referer||SITE+'/'},signal:c?c.signal:undefined,redirect:'follow'});}).then(async function(r){if(!r.ok)throw Error('HTTP '+r.status);var body=await r.text();finish(null,{text:body,url:r.url||u,ok:true,status:r.status});}).catch(function(e){finish(e);});});}
function remaining(){return 12000-(Date.now()-started);}
var deadline=setTimeout(stop,12000);
try{
log('v3.0.0 WATCH-only TMDB='+id+' type='+type);
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
for(var qi=0;qi<aliases.length&&!detail;qi++){if(qi&&norm(aliases[qi])===norm(aliases[0]))continue;var sr=await request(SITE+'/?s='+encodeURIComponent(aliases[qi]));if(!sr.ok)continue;var $=require('cheerio-without-node-native').load(sr.text);$('.movie-card').each(function(_,el){var c=$(el),name=c.find('.movie-card-title').text().trim(),text=c.text(),href=url((c.is('a[href]')?c.attr('href'):c.find('a[href]').first().attr('href')),SITE),fm=c.find('.movie-card-format').text(),y=/\b(19\d{2}|20\d{2})\b/.exec(text);if(aliases.some(function(a){return norm(a)===norm(name);})&&(!year||!y||year===y[1])&&(type==='tv'?/series/i.test(fm)||/-series-/.test(href):/movie/i.test(fm)||/-movie-/.test(href)))detail=href;});}
if(!detail){log('SEARCH: no exact title/year/type');return [];}
var page=await request(detail,SITE+'/'),$=require('cheerio-without-node-native').load(page.text),releases=[];
var published=$('#videoPlayer').attr('src'),watch=published?url(published,detail):'';
function watchMatches(u){try{var p=new URL(u),parts=p.pathname.split('/').filter(Boolean);if(!/^(?:player\.videasy\.net|player\.autoembed\.cc)$/.test(p.hostname))return false;var ti=parts.indexOf(type);return ti>=0&&parts[ti+1]===id&&(type==='movie'||(+parts[ti+2]===season&&+parts[ti+3]===episode));}catch(_){return false;}}

if(!watch||!watchMatches(watch)){log('WATCH: no exact published iframe');return [];}
if(typeof globalThis.webviewResolve!=='function'){log('WATCH: browser bridge unavailable');return [];}
var watchMs=Math.min(6500,Math.max(1,remaining()-250)),session=await new Promise(function(resolve){var done=false,t=setTimeout(function(){finish(null);},watchMs+100);function finish(v){if(done)return;done=true;clearTimeout(t);resolve(v);}Promise.resolve().then(function(){return globalThis.webviewResolve(watch,{referer:SITE+'/',directLoad:false,timeoutMs:watchMs,finishAfterFirstMs:0,waitForMediaReady:false,captureSubtitles:true,captureSessionResponses:false,suppressPopups:true,blockMatchedRequests:false,match:['.m3u8','.mp4'],blocked:['youtube.com','googlevideo.com','doubleclick','googlesyndication','/trailer','/preview']});}).then(finish,function(){finish(null);});});
var captured=session&&Array.isArray(session.streams)?session.streams:[];
for(var i=0;i<captured.length;i++){var row=captured[i],media=url(row&&row.url);if(!media||!/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(media)||/youtube|googlevideo|\/(?:trailer|preview|sample)/i.test(media))continue;
var h={};Object.keys(row.headers||{}).forEach(function(k){var v=String(row.headers[k]);if(!/^(?:host|connection|content-length|range|accept-encoding)$/i.test(k)&&!/[\r\n]/.test(k+v))h[k]=v;});if(!Object.keys(h).some(function(k){return k.toLowerCase()==='referer';}))h.Referer=watch;
var captions=normalizeSubs({subtitles:(session.subtitles||[]).concat(row.subtitles||[])},watch),isHls=/\.m3u8(?:[?#]|$)/i.test(media),server=host(watch).indexOf('videasy')>=0?'WATCH · Videasy':'WATCH · AutoEmbed';
log('RETURN: media captured; subtitles='+captions.length+'; no media probes; elapsed='+(Date.now()-started)+'ms');
return[{name:'4KHDHub',title:title,server:server,serverName:server,url:media,headers:h,mimeType:isHls?'application/x-mpegURL':'video/mp4',type:isHls?'hls':'direct',quality:isHls?'Auto':'Unknown',subtitles:captions,sourceVerified:false,playbackVerified:false}];}
log('WATCH: no captured media');return [];
}catch(e){log('NO_RESULT: '+String(e.message||e));return [];}finally{clearTimeout(deadline);stop();}}
module.exports={getStreams:function(id,type,s,e){type=type==='series'?'tv':type;if(!/^[1-9]\d*$/.test(String(id))||['movie','tv'].indexOf(type)<0||type==='tv'&&(s==null||e==null||!Number.isInteger(+s)||+s<0||!Number.isInteger(+e)||+e<1))return Promise.resolve([]);return run(String(id),type,+s,+e);}};globalThis.getStreams=module.exports.getStreams;
})();
