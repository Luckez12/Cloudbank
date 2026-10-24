/* Viduki v1.0.7 — exact TMDB player session; no download endpoints. */
(function () {
'use strict';
var BASE='https://www.viduki.net';
function log(s){console.log('[Viduki] '+s);}
function http(s){try {var u=new URL(s);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;}catch(_){return false;}}
function subtitleLanguage(row){
 var aliases={english:'en',eng:'en',malay:'ms',melayu:'ms',msa:'ms',may:'ms',indonesian:'id',ind:'id',japanese:'ja',jpn:'ja',korean:'ko',kor:'ko',chinese:'zh',zho:'zh',chi:'zh',german:'de',deu:'de',ger:'de',french:'fr',fra:'fr',fre:'fr',spanish:'es',spa:'es',arabic:'ar',ara:'ar',hindi:'hi',hin:'hi',thai:'th',tha:'th',portuguese:'pt',por:'pt',albanian:'sq',sqi:'sq',alb:'sq',bengali:'bn',ben:'bn',vietnamese:'vi',vie:'vi',tamil:'ta',tam:'ta',telugu:'te',tel:'te',russian:'ru',rus:'ru',turkish:'tr',tur:'tr',italian:'it',ita:'it',dutch:'nl',nld:'nl',dut:'nl',polish:'pl',pol:'pl',swedish:'sv',swe:'sv',danish:'da',dan:'da',norwegian:'no',nor:'no',finnish:'fi',fin:'fi',romanian:'ro',ron:'ro',rum:'ro',greek:'el',ell:'el',gre:'el',hebrew:'he',heb:'he',ukrainian:'uk',ukr:'uk',persian:'fa',fas:'fa',per:'fa',czech:'cs',ces:'cs',cze:'cs',hungarian:'hu',hun:'hu',croatian:'hr',hrv:'hr',serbian:'sr',srp:'sr',bulgarian:'bg',bul:'bg'};
 var values=[row.language,row.lang,row.srclang,row.label,row.name];
 for(var i=0;i<values.length;i++){
  var text=String(values[i]||'').trim().toLowerCase().replace(/_/g,'-');
  if(!text||/^(und|unk|unknown)$/.test(text))continue;
  if(aliases[text])return aliases[text];
  if(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(text)){
   var parts=text.split('-');parts[0]=aliases[parts[0]]||parts[0];return parts.join('-');
  }
  // Whole words only: Bengali must never be mistaken for "eng".
  var words=text.match(/[a-z]+/g)||[];
  for(var j=0;j<words.length;j++)if(aliases[words[j]])return aliases[words[j]];
 }
 return 'und';
}
function subtitleRank(track){var base=track.language.split('-')[0];return base==='en'?0:base==='ms'?1:base==='id'?2:base==='und'?4:3;}
function chooseSubtitles(rows){
 var ranked=subs(rows).filter(function(track){return /^(en|ms)(?:-|$)/.test(track.language);}).map(function(track,index){return {track:track,index:index};});
 ranked.sort(function(a,b){return subtitleRank(a.track)-subtitleRank(b.track)||a.index-b.index;});
 var counts={},out=[];
 ranked.forEach(function(item){var t=item.track,base=t.language.split('-')[0];if(out.length>=4||(counts[base]||0)>=2)return;counts[base]=(counts[base]||0)+1;out.push(t);});
 return out;
}
function subs(rows){var seen={};return (Array.isArray(rows)?rows:[]).map(function(row){
 if(!row)return null;var url=row.url||row.src||row.file;
 if(!url)return null;try{url=new URL(url,'https://rezesubs.com').href;}catch(_){return null;}
 if(!http(url)||seen[url]||/thumbnail|chapter/i.test(String(row.kind||'')))return null;
 seen[url]=true;var code=subtitleLanguage(row);
 return {url:url,lang:code,language:code,name:row.name||row.label||row.display||row.language||row.lang||code,headers:row.headers||{},mimeType:row.mimeType,format:row.format};
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
  var candidates=chooseSubtitles(data.subtitles);
  log('SUBTITLE_SELECT: candidates='+candidates.length+' languages='+candidates.map(function(t){return t.language;}).join(','));
  candidates.forEach(function(track){
   if(!active)return;
   var ext=/\.(vtt|srt|ass|ssa)(?:[?#]|$)/i.exec(track.url);
   var format=ext?ext[1].toLowerCase():String(track.format||'').toLowerCase();
   if(format==='vtt')track.mimeType='text/vtt';
   else if(format==='srt')track.mimeType='application/x-subrip';
   else if(format==='ass'||format==='ssa')track.mimeType='text/x-ssa';
   if(format)track.format=format;
   tracks.push(track);
  });
 }catch(_){}finally{stop();}})();
 return {stop:stop,snapshot:function(){return tracks.slice().sort(function(a,b){return subtitleRank(a)-subtitleRank(b);});}};
}
async function getStreams(id,type,s,e){
 type=type==='series'?'tv':type;id=String(id||'');s=Number(s);e=Number(e);
 if(!/^\d+$/.test(id)||! /^(movie|tv)$/.test(type)||type==='tv'&&(!Number.isInteger(s)||s<0||!Number.isInteger(e)||e<1))return [];
 var bridge=typeof globalThis!=='undefined'&&globalThis.webviewResolve;
 if(typeof bridge!=='function'){log('NO_RESULT: WebView bridge unavailable');return [];}
 var page=BASE+'/1/'+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'');
 log('v1.0.7 exact '+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'')+'; API 1 website streaming; no download route');
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
  log('RESULT: 1 '+kind+' source; subtitleUrls='+tracks.length);
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
