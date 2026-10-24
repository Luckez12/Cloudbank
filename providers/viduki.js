/* Viduki v1.0.0 — exact TMDB player session; no download endpoints. */
(function () {
'use strict';
var BASE='https://www.viduki.net';
function log(s){console.log('[Viduki] '+s);}
function http(s){try {var u=new URL(s);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;}catch(_){return false;}}
function subs(rows){var seen={};return (Array.isArray(rows)?rows:[]).filter(function(r){return r&&http(r.url)&&!seen[r.url]&&(seen[r.url]=true);}).map(function(r){return {url:r.url,lang:r.lang||r.language||'Unknown',name:r.name||r.label||r.lang||'Viduki'};});}
async function timed(fn,ms){var t;try{return await Promise.race([fn(),new Promise(function(_,reject){t=setTimeout(function(){reject(new Error('timeout'));},ms);})]);}finally{clearTimeout(t);}}
async function captions(id,type,s,e){try{
 var path=type==='tv'?'tv/'+id+'/'+s+'/'+e:'movie/'+id;
 var r=await timed(function(){return fetch('https://rezesubs.com/data/subs/'+path);},3500);
 if(!r.ok)return [];return subs((await r.json()).subtitles);
}catch(_){return [];}}
async function getStreams(id,type,s,e){
 type=type==='series'?'tv':type;id=String(id||'');s=Number(s);e=Number(e);
 if(!/^\d+$/.test(id)||! /^(movie|tv)$/.test(type)||type==='tv'&&(!Number.isInteger(s)||s<0||!Number.isInteger(e)||e<1))return [];
 var bridge=typeof globalThis!=='undefined'&&globalThis.webviewResolve;
 if(typeof bridge!=='function'){log('NO_RESULT: WebView bridge unavailable');return [];}
 var page=BASE+'/1/'+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'');
 log('v1.0.0 exact '+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'')+'; API 1 website streaming; no download route');
 var subtitleTask=captions(id,type,s,e);
 try{
 var session=await timed(function(){return bridge(page,{
  directLoad:true,referer:BASE+'/',timeoutMs:13500,finishAfterFirstMs:250,
  waitForMediaReady:true,allowBlobMediaReady:false,captureSessionResponses:true,
  jsonResponsePrefixes:[],injectAbyssHook:false,captureSubtitles:true,
  suppressPopups:true,lockMainFrameHost:true,blockMatchedRequests:false,
  mediaHosts:[],mediaRequestMatchers:[],match:['.m3u8','.mp4','.mpd'],
  interactionTexts:['play'],clickDelaysMs:[700,1800,3500],
  blocked:['doubleclick.net','googlesyndication.com','googleadservices.com']
 });},15500);
 if(typeof session==='string')session=JSON.parse(session);
 var rows=session&&Array.isArray(session.streams)?session.streams:[];
 var seen={};rows=rows.filter(function(r){return r&&http(r.url)&&(r.networkObserved===true||r.responseObserved===true)&&!seen[r.url]&&(seen[r.url]=true)&&/\.(m3u8|mpd|mp4)(?:[?#]|$)/i.test(r.url);});
 log('CAPTURE: observed='+rows.length+' ready='+(session&&session.mediaReady===true));
 var tracks=subs([].concat(await subtitleTask,session&&session.subtitles||[]));
 for(var i=0;i<Math.min(rows.length,3);i++){
  var row=rows[i],q=/\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(row.quality||''));
  if(q&&+q[1]<720)continue;
  if(row.isDubbed===true&&!row.isMultiAudio&&!row.isDualAudio)continue;
  var headers=Object.assign({Referer:page},row.headers||{}),kind=/\.m3u8(?:[?#]|$)/i.test(row.url)?'hls':/\.mpd(?:[?#]|$)/i.test(row.url)?'dash':'direct';
  try{
   var response=await timed(function(){return fetch(row.url,{method:kind==='direct'?'HEAD':'GET',headers:headers});},2500);
   if(!response.ok) {log('REJECT: HTTP '+response.status);continue;}
   var mime=String(response.headers.get('content-type')||'');
   if(/html|json/i.test(mime))continue;
   if(kind!=='direct'){
    var body=await response.text();
    if(kind==='hls'&&!/^\s*#EXTM3U\b/.test(body)||kind==='dash'&&!/<MPD\b/.test(body))continue;
    if(kind==='hls'){
     var heights=Array.from(body.matchAll(/RESOLUTION=\d+x(\d+)/g)).map(function(m){return +m[1];});
     // Reject a master whose every advertised rendition is below 720p.
     if(heights.length&&Math.max.apply(null,heights)<720)continue;
    }
   }else if(!/^video\//i.test(mime))continue;
   log('RESULT: 1 HTTP-checked '+kind+' source; subtitles='+tracks.length+'; device playback unverified');
   return [{name:'Viduki',provider:'viduki',title:'Viduki • API 1',serverName:'API 1',url:row.url,headers:headers,type:kind,format:kind,quality:q?q[1]+'p':'Auto',isAdaptive:kind!=='direct',subtitles:subs(tracks.concat(row.subtitles||[]))}];
  }catch(_){log('REJECT: media check failed');}
 }
 log('RESULT: 0 eligible sources');return [];
 }catch(_){log('NO_RESULT: website session failed or timed out');return [];}
}
module.exports={getStreams:getStreams};
})();
