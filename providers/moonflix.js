/* MoonFlix v2.0.0 — current website direct streaming API flow. */
(function(){
'use strict';
var PLAYER='https://player.moonflix.website';
var ROUTES=[{api:'https://filmu-mpbu.onrender.com/api/stream',ref:'https://embed.filmu.in/',name:'Filem'}, {api:'https://vidzy-wlqs.onrender.com/api/stream',ref:'https://player.vidzee.wtf/',name:'Backup'}];
function log(s){console.log('[MoonFlix] '+s);}
function http(u){try{var p=new URL(u);return /^https?:$/.test(p.protocol)&&!p.username&&!p.password;}catch(_){return false;}}
function lang(v){var x=String(v||'').trim().toLowerCase().replace(/_/g,'-');return ({eng:'en',english:'en',msa:'ms',may:'ms',malay:'ms',jpn:'ja',japanese:'ja',kor:'ko',korean:'ko',hin:'hi',hindi:'hi',tel:'te',tam:'ta',kan:'kn'})[x]||x;}
function subtitles(rows,base){var seen={};return (Array.isArray(rows)?rows:[]).map(function(r){
 if(!r)return null;var l=lang(r.language||r.lang||r.srclang||r.label);if(!/^(en|ms)(?:-|$)/.test(l))return null;
 var u=r.url||r.file||r.src;try{u=new URL(u,base).href;}catch(_){return null;}
 if(!http(u)||seen[u])return null;seen[u]=true;
 var ext=/\.(vtt|srt|ass|ssa)(?:[?#]|$)/i.exec(u);
 return {url:u,language:l,lang:l,name:r.name||r.label||l,headers:r.headers||{},mimeType:ext?(ext[1].toLowerCase()==='vtt'?'text/vtt':/ass|ssa/i.test(ext[1])?'text/x-ssa':'application/x-subrip'):undefined};
 }).filter(Boolean).sort(function(a,b){return Number(a.language.indexOf('ms')===0)-Number(b.language.indexOf('ms')===0);}).slice(0,4);}
async function read(url,headers,ms,json){var c=typeof AbortController==='function'?new AbortController():null,t;
 try{return await Promise.race([(async function(){var r=await fetch(url,{headers:headers||{},redirect:'follow',signal:c?c.signal:undefined});if(!r.ok)throw Error('HTTP '+r.status);return json?await r.json():await r.text();})(),new Promise(function(_,reject){t=setTimeout(function(){if(c)c.abort();reject(Error('timeout'));},Math.max(1,ms));})]);}finally{clearTimeout(t);}}
function shared(id,type){try{var r=globalThis.VUEO_DISCOVERY_CONTEXT;if(typeof r==='string')r=JSON.parse(r);var m=r&&(r.tmdb||r);if(!m||String(r.tmdbId||m.id)!==id||r.mediaType&&(r.mediaType==='series'?'tv':r.mediaType)!==type)return {};return {title:m.title||m.name||r.title,original:lang(m.original_language||r.originalLanguage||r.original_language)};}catch(_){return {};}}
function mismatch(d,id,type,s,e){if(!d||typeof d!=='object')return true;var got=d.tmdb||d.tmdbId||d.tmdb_id;if(got!=null&&String(got)!==id)return true;var t=d.type||d.mediaType;if(/^(movie|tv|series)$/.test(t||'')&&(t==='series'?'tv':t)!==type)return true;
 if(type==='tv'&&((d.season!=null&&+d.season!==s)||(d.episode!=null&&+d.episode!==e)))return true;return false;}
function indexSubs(id,type,s,e){var active=true,tracks=[],c=typeof AbortController==='function'?new AbortController():null,timer=setTimeout(stop,2500);
 function stop(){active=false;clearTimeout(timer);if(c)c.abort();}
 var path=type==='movie'?'movie/'+id:'tv/'+id+'/'+s+'/'+e;
 (async function(){try{var r=await fetch('https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/sub/'+path+'/subtitles.json',{signal:c?c.signal:undefined});if(!active||!r.ok)return;var d=await r.json();if(!active)return;var rows=Array.isArray(d.subtitles)?d.subtitles:Object.keys(d.subtitles||{}).map(function(k){return {lang:k,url:d.subtitles[k]};});tracks=subtitles(rows,PLAYER);}catch(_){}finally{stop();}})();
 return {stop:stop,snapshot:function(){return tracks.slice();}};}
async function getStreams(id,type,s,e){id=String(id||'');type=type==='series'?'tv':type;s=Number(s);e=Number(e);
 if(!/^[1-9]\d*$/.test(id)||! /^(movie|tv)$/.test(type)||type==='tv'&&(!Number.isInteger(s)||s<1||!Number.isInteger(e)||e<1))return [];
 var started=Date.now(),deadline=started+18000,context=shared(id,type),subs=indexSubs(id,type,s,e);
 log('v2.0.0 exact '+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'')+'; current website API main -> backup; WebView=0');
 try{for(var i=0;i<ROUTES.length;i++){
  var route=ROUTES[i],remaining=deadline-Date.now();if(remaining<500)break;
  var params=new URLSearchParams({tmdb:id});if(type==='tv'){params.set('s',String(s));params.set('e',String(e));}if(type==='movie'||i===1)params.set('type',type);
  try{
   var data=await read(route.api+'?'+params,{Referer:PLAYER+'/',Origin:PLAYER},Math.min(5500,remaining),true);
   if(mismatch(data,id,type,s,e)||data.available===false){log(route.name+': unavailable or identity mismatch');continue;}
   var rows=Array.isArray(data.sources)?data.sources.filter(function(r){return r&&http(r.url);}):[];
   if(!rows.length&&i===0&&data.m3u8_path&&http(data._base)){try{rows=[{url:new URL(data.m3u8_path,data._base.replace(/\/$/,'')+'/').href}];}catch(_){}}
   if(!rows.length&&i===1&&http(data.m3u8))rows=[{url:data.m3u8}];
   for(var j=0;j<Math.min(rows.length,2);j++){
    var row=rows[j],q=/\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(row.quality||row.label||''));if(q&&+q[1]<720)continue;
    if(row.isDubbed===true&&!row.isDualAudio&&!row.isMultiAudio)continue;
    var audio=lang(row.audioLanguage||row.language);if(context.original&&audio&&audio!==context.original&&!row.isMultiAudio&&!row.isDualAudio)continue;
    var headers=Object.assign({Referer:route.ref,Origin:new URL(route.ref).origin},row.headers||{});
    var budget=Math.min(3500,deadline-Date.now());if(budget<200)break;
    try{
     var text=String(await read(row.url,headers,budget,false)).replace(/^\uFEFF/,'').trim();
     if(!text.startsWith('#EXTM3U')||!/#EXTINF:|#EXT-X-STREAM-INF:/.test(text)){log(route.name+': invalid playlist');continue;}
     var heights=Array.from(text.matchAll(/RESOLUTION=\d+x(\d+)/g)).map(function(m){return +m[1];});if(heights.length&&Math.max.apply(null,heights)<720)continue;
     var audios=Array.from(text.matchAll(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*LANGUAGE="([^"]+)"/g)).map(function(m){return lang(m[1]);});
     if(context.original&&audios.length&&audios.indexOf(context.original)<0){log(route.name+': original audio absent');continue;}
     subs.stop();var tracks=subtitles([].concat(subs.snapshot(),data.subtitles||[],row.subtitles||[]),route.api);
     log('RESULT: 1 verified HLS; server='+route.name+' subtitleUrls='+tracks.length+' elapsedMs='+(Date.now()-started)+'; device playback unverified');
     return [{name:'MoonFlix',provider:'moonflix',serverName:route.name,title:context.title||'MoonFlix',url:row.url,headers:headers,type:'hls',format:'hls',mimeType:'application/x-mpegURL',quality:/#EXT-X-STREAM-INF:/.test(text)?'Auto':q?q[1]+'p':'Auto',isAdaptive:true,audioLanguages:audios,subtitles:tracks}];
    }catch(error){log(route.name+': playlist '+(/HTTP \d+|timeout/.exec(String(error.message))||['request failed'])[0]);}
   }
  }catch(error){log(route.name+': API '+(/HTTP \d+|timeout/.exec(String(error.message))||['request failed'])[0]);}
 }
 log('RESULT: 0 eligible sources');return [];
 }finally{subs.stop();}
}
module.exports={getStreams:getStreams};
})();
