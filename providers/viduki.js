/* Viduki v1.0.4 — exact TMDB player session; no download endpoints. */
(function () {
'use strict';
var BASE='https://www.viduki.net';
function log(s){console.log('[Viduki] '+s);}
function http(s){try {var u=new URL(s);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;}catch(_){return false;}}
function subtitleLanguage(row){
 var raw=String(row.language||row.lang||row.srclang||row.label||row.name||'').trim();
 var text=raw.toLowerCase().replace(/_/g,'-');
 var map={english:'en',eng:'en',malay:'ms',melayu:'ms',msa:'ms',may:'ms',indonesian:'id',ind:'id',japanese:'ja',jpn:'ja',korean:'ko',kor:'ko',chinese:'zh',zho:'zh',chi:'zh',german:'de',deu:'de',ger:'de',french:'fr',fra:'fr',fre:'fr',spanish:'es',spa:'es',arabic:'ar',ara:'ar',hindi:'hi',hin:'hi',thai:'th',tha:'th',portuguese:'pt',por:'pt'};
 if(map[text])return map[text];
 if(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(text)&&! /^(und|unk)$/.test(text))return text;
 for(var k in map)if(text.indexOf(k)>=0)return map[k];
 return 'und';
}
function subs(rows){var seen={};return (Array.isArray(rows)?rows:[]).map(function(row){
 if(!row)return null;var url=row.url||row.src||row.file;
 if(!url)return null;try{url=new URL(url,'https://rezesubs.com').href;}catch(_){return null;}
 if(!http(url)||seen[url]||/thumbnail|chapter/i.test(String(row.kind||'')))return null;
 seen[url]=true;var code=subtitleLanguage(row);
 return {url:url,lang:code,language:code,name:row.name||row.label||code,headers:row.headers||{},mimeType:row.mimeType,format:row.format};
}).filter(Boolean);}
async function timed(fn,ms){var t;try{return await Promise.race([fn(),new Promise(function(_,reject){t=setTimeout(function(){reject(new Error('timeout'));},ms);})]);}finally{clearTimeout(t);}}
function startCaptions(id,type,s,e){
 var active=true,tracks=[],controller=typeof AbortController==='function'?new AbortController():null;
 var timer=setTimeout(stop,3500);
 function stop(){if(!active)return;active=false;clearTimeout(timer);if(controller)controller.abort();}
 function options(headers){var out={headers:headers||{}};if(controller)out.signal=controller.signal;return out;}
 // Never await this work from the video path. Late results are ignored.
 (async function(){try{
  var path=type==='tv'?'tv/'+id+'/'+s+'/'+e:'movie/'+id;
  var r=await fetch('https://rezesubs.com/data/subs/'+path,options({Origin:BASE,Referer:BASE+'/'}));
  if(!active)return;
  if(!r.ok){log('SUBTITLE: index HTTP '+r.status+'; no retry');return;}
  var data=await r.json();if(!active)return;
  var candidates=subs(data.subtitles).slice(0,4);
  await Promise.all(candidates.map(async function(track){try{
   if(!active)return;
   var response=await fetch(track.url,options(track.headers));if(!active||!response.ok)return;
   var text=String(await response.text()).replace(/^\uFEFF/,'').trim();if(!active)return;
   if(text.length>2097152||/^\s*[<{[]/.test(text))return;
   var cue=/(?:^|\n)\s*(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}[^\n]*\r?\n[^\s]/m;
   if(!cue.test(text))return;
   var vtt=/^WEBVTT(?:\s|$)/.test(text);
   if(!vtt&&!/\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text))return;
   track.mimeType=vtt?'text/vtt':'application/x-subrip';track.format=vtt?'vtt':'srt';
   tracks.push(track);
  }catch(_){} }));
 }catch(_){}finally{stop();}})();
 return {stop:stop,snapshot:function(){return tracks.slice();}};
}
async function getStreams(id,type,s,e){
 type=type==='series'?'tv':type;id=String(id||'');s=Number(s);e=Number(e);
 if(!/^\d+$/.test(id)||! /^(movie|tv)$/.test(type)||type==='tv'&&(!Number.isInteger(s)||s<0||!Number.isInteger(e)||e<1))return [];
 var bridge=typeof globalThis!=='undefined'&&globalThis.webviewResolve;
 if(typeof bridge!=='function'){log('NO_RESULT: WebView bridge unavailable');return [];}
 var page=BASE+'/1/'+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'');
 log('v1.0.4 exact '+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'')+'; API 1 website streaming; no download route');
 var subtitles=startCaptions(id,type,s,e);
 try{
 var session=await timed(function(){return bridge(page,{
  directLoad:true,referer:BASE+'/',timeoutMs:12000,finishAfterFirstMs:500,
  waitForMediaReady:false,allowBlobMediaReady:false,captureSessionResponses:false,
  jsonResponsePrefixes:[],injectAbyssHook:false,captureSubtitles:true,
  suppressPopups:true,lockMainFrameHost:true,blockMatchedRequests:false,
  mediaHosts:[],mediaRequestMatchers:[],match:['.m3u8','.mp4','.mpd'],
  viewportWidth:1080,viewportHeight:1080,clickX:540,clickY:600,
  interactionTexts:['play','watch now','continue'],clickDelaysMs:[650,1300,2200,3400,5000,7000,9500],
  blocked:['doubleclick.net','googlesyndication.com','googleadservices.com']
 });},12500);
 subtitles.stop();
 log('SUBTITLE: discovery ended; ready='+subtitles.snapshot().length+'; extraWaitMs=0');
 if(typeof session==='string')session=JSON.parse(session);
 var rows=session&&Array.isArray(session.streams)?session.streams:[];
 var rawCount=rows.length,detailed=session&&session.sessionResponseVersion===1;
 var rejected={invalid:0,unobserved:0,http:0,duplicate:0},seen={};
 rows=rows.filter(function(r){
  if(!r||!http(r.url)||!/\.(m3u8|mpd|mp4)(?:[?#]|$)/i.test(r.url)){rejected.invalid++;return false;}
  // Mapple/VidFast compatibility: basic bridge can omit both evidence fields.
  // Detailed captures, or explicit negative evidence, still require observation.
  if((detailed||r.networkObserved===false||r.responseObserved===false)&&r.networkObserved!==true&&r.responseObserved!==true){rejected.unobserved++;return false;}
  var status=Number(r.statusCode||r.status||0);
  if(status&&(status<200||status>=300)){rejected.http++;return false;}
  if(seen[r.url]){rejected.duplicate++;return false;}seen[r.url]=true;return true;
 });
 // Prefer an actual observed master; never construct a master URL from a variant.
 rows.sort(function(a,b){return Number(/master/i.test(b.url))-Number(/master/i.test(a.url));});
 var finish=session&&['timeout','load-error','first-candidate','media-ready','network-candidate','response-media'].indexOf(session.finishReason)>=0?session.finishReason:'not-provided';
 var diag=session&&session.diagnostics||{},video=diag.video||{};
 log('CAPTURE: raw='+rawCount+' accepted='+rows.length+' bridge='+(detailed?'detailed':'basic')+' finish='+finish+' ready='+(session&&session.mediaReady===true));
 log('FILTER: invalid='+rejected.invalid+' unobserved='+rejected.unobserved+' http='+rejected.http+' duplicate='+rejected.duplicate);
 log('WEBVIEW_STATE: hook='+(diag.hookSeen===true)+' pageFinished='+(diag.pageFinished===true)+' videoCount='+(Number(video.count)||0)+' readyState='+(Number(video.readyState)||0));

 for(var i=0;i<Math.min(rows.length,2);i++){
  var row=rows[i],q=/\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(row.quality||''));
  if(q&&+q[1]<720||Number(row.height)>0&&Number(row.height)<720)continue;
  if(row.isDubbed===true&&!row.isMultiAudio&&!row.isDualAudio)continue;
  var headers=Object.assign({Referer:page},row.headers||{}),kind=/\.m3u8(?:[?#]|$)/i.test(row.url)?'hls':/\.mpd(?:[?#]|$)/i.test(row.url)?'dash':'direct';
  var mime=String(row.mimeType||row.mime||row.contentType||'').toLowerCase();
  if(/html|json|image\//i.test(mime)){log('REJECT: captured non-media content type');continue;}
  // Same handoff approach as Mapple/VidFast: native capture owns discovery.
  // Do not re-request the signed CDN URL after the browser already requested it.
  var tracks=subtitles.snapshot();
  log('HANDOFF: CDN rechecks=0; source=captured-session; playback unverified');
  log('RESULT: 1 '+kind+' source; validatedSubtitles='+tracks.length);
  return [{name:'Viduki',provider:'viduki',title:'Viduki • API 1',serverName:'API 1',url:row.url,headers:headers,type:kind,format:kind,
   mimeType:kind==='hls'?'application/x-mpegURL':kind==='dash'?'application/dash+xml':mime||'video/mp4',
   quality:q?q[1]+'p':'Auto',isAdaptive:kind!=='direct',subtitles:tracks}];

 }
 log('RESULT: 0 eligible sources');return [];
 }catch(_){log('NO_RESULT: website session failed or timed out');return [];}
 finally{subtitles.stop();}
}
module.exports={getStreams:getStreams};
})();
