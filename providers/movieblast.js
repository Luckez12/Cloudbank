/* MovieBlast v2.0.0 — single direct API implementation; no merged legacy engines. */
(function(){'use strict';
var BASE='https://app.cloud-mb.xyz',APP='com.movieblast';
/* API client constants retained from the supplied upstream client. */
var TOKEN="jdvhhjv255vghhghdhvfch2565656jhdcghfdf",SIGN_SECRET="GJ8reydarI7Jqat9rvbAJKNQ9gY4DoEQF2H5nfuI1gi",TMDB_KEY="439c478a771f35c05022f9feabcca01c",SEARCH_HASH='86dc03244adddb3cbedbf0ae36074a736ee293a64774b18e82a6244eafd0df30';
function log(s){console.log('[MovieBlast] '+s);}
function language(v){var x=String(v||'').trim().toLowerCase();return ({english:'en',eng:'en',malay:'ms',melayu:'ms',may:'ms',msa:'ms',japanese:'ja',jpn:'ja',korean:'ko',kor:'ko',hindi:'hi',hin:'hi',tamil:'ta',tam:'ta',telugu:'te',tel:'te'})[x]||x;}
function norm(v){return String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function url(v){try{var u=new URL(/^https?:\/\//i.test(v)?v:'https://'+v);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch(_){return null;}}
function sign(raw){var u=new URL(raw),ts=String(Math.floor(Date.now()/1000)),c=require('crypto-js');u.searchParams.set('verify',ts+'-'+c.enc.Base64.stringify(c.HmacSHA256(u.pathname+ts,SIGN_SECRET)));return u.href;}
async function json(u,headers,deadline){var c=typeof AbortController==='function'?new AbortController():null,t,ms=Math.min(6000,deadline-Date.now());if(ms<1)throw Error('budget');try{return await Promise.race([(async function(){var r=await fetch(u,{headers:headers,signal:c?c.signal:undefined});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();})(),new Promise(function(_,reject){t=setTimeout(function(){if(c)c.abort();reject(Error('timeout'));},ms);})]);}finally{clearTimeout(t);}}
function shared(id,type){try{var r=globalThis.VUEO_DISCOVERY_CONTEXT;if(typeof r==='string')r=JSON.parse(r);var m=r&&(r.tmdb||r);if(!m||String(r.tmdbId||m.id)!==id||r.mediaType&&(r.mediaType==='series'?'tv':r.mediaType)!==type)return {};return {title:m.title||m.name||r.title,originalTitle:m.original_title||m.original_name||r.originalTitle,year:String(m.release_date||m.first_air_date||r.year||'').slice(0,4),original:language(m.original_language||r.originalLanguage||r.original_language)};}catch(_){return {};}}
function captions(rows){var seen={};return (Array.isArray(rows)?rows:[]).map(function(r){if(!r)return null;var l=language(r.language||r.lang||r.iso_639_1),u=url(r.url||r.link||r.file||'');if(!u||! /^(en|ms)(?:-|$)/.test(l)||seen[u])return null;seen[u]=true;return {url:u,language:l,name:r.name||r.label||l,mimeType:/\.vtt(?:[?#]|$)/i.test(u)?'text/vtt':/\.srt(?:[?#]|$)/i.test(u)?'application/x-subrip':undefined};}).filter(Boolean).slice(0,4);}
function isSeries(row){return /serie|^tv$/i.test(String(row.type||''));}
async function getStreams(id,type,s,e){id=String(id||'');type=type==='series'?'tv':type;s=Number(s);e=Number(e);if(!/^[1-9]\d*$/.test(id)||! /^(movie|tv)$/.test(type)||type==='tv'&&(!Number.isInteger(s)||s<1||!Number.isInteger(e)||e<1))return [];
 var deadline=Date.now()+18000,headers={'User-Agent':'okhttp/5.0.0-alpha.6','x-request-x':APP},searchHeaders=Object.assign({},headers,{hash256:SEARCH_HASH,packagename:APP});
 log('v2.0.0 '+type+'/'+id+(type==='tv'?'/'+s+'/'+e:'')+'; title search -> verified detail -> signed video; WebView=0');
 try{
  var meta=shared(id,type);
  if(!meta.title||!meta.year||!meta.original){var m=await json('https://api.themoviedb.org/3/'+type+'/'+id+'?api_key='+TMDB_KEY,{Accept:'application/json'},deadline);meta={title:m.title||m.name,originalTitle:m.original_title||m.original_name,year:String(m.release_date||m.first_air_date||'').slice(0,4),original:language(m.original_language)};}
  if(!meta.title||!meta.original){log('NO_RESULT: title/original language unavailable');return [];}
  var names=[meta.title,meta.originalTitle].filter(Boolean),match=null;
  for(var k=0;k<names.length&&k<2;k++){
   if(k&&norm(names[k])===norm(names[0]))continue;
   var result=await json(BASE+'/api/search/'+encodeURIComponent(names[k])+'/'+TOKEN,searchHeaders,deadline);
   var candidates=(Array.isArray(result.search)?result.search:[]).filter(function(r){return r&&r.id&&isSeries(r)===(type==='tv')&&names.some(function(n){return !!norm(n)&&norm(n)===norm(r.name||r.title);})&&(!meta.year||String(r.release_date||'').slice(0,4)===meta.year);});
   log('SEARCH: exactCandidates='+candidates.length);
   if(candidates.length===1){match=candidates[0];break;}
   if(candidates.length>1){log('NO_RESULT: ambiguous exact match');return [];}
  }
  if(!match)return [];
  var d=await json(BASE+'/api/'+(type==='tv'?'series/show':'media/detail')+'/'+encodeURIComponent(match.id)+'/'+TOKEN,headers,deadline);
  if(String(d.tmdb_id||'')!==id){log('NO_RESULT: detail TMDB identity mismatch/missing');return [];}
  var owner=d;
  if(type==='tv'){var season=(d.seasons||[]).find(function(r){return +r.season_number===s;});owner=season&&(season.episodes||[]).find(function(r){return +r.episode_number===e;});if(!owner){log('NO_RESULT: requested episode unavailable');return [];}}
  var seen={},out=[],videos=Array.isArray(owner.videos)?owner.videos:[],tracks=captions([].concat(d.substitles||[],owner===d?[]:owner.substitles||[]));
  videos.forEach(function(v){
   if(!v||Number(v.embed)===1||Number(v.drm)===1||Number(v.downloadonly)===1||v.status!=null&&Number(v.status)!==1)return;
   var audio=language(v.lang),multi=/multi|dual/i.test(audio);
   // Never label absent audio as English. Multi is accepted only with explicit original-language evidence.
   if(audio!==meta.original){var declared=Array.isArray(v.audioLanguages)?v.audioLanguages.map(language):[];if(!multi||declared.indexOf(meta.original)<0)return;}
   var q=/\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(v.server||v.quality||''));if(q&&+q[1]<720)return;
   var raw=url(v.link||'');if(!raw||seen[raw])return;seen[raw]=true;
   var h={'User-Agent':v.useragent||'MovieBlast',Referer:'MovieBlast','x-request-x':APP};
   if(v.header&&typeof v.header==='object')Object.keys(v.header).forEach(function(key){if(typeof v.header[key]==='string'&&!/host|connection|content-length/i.test(key)&&!/[\r\n]/.test(key+v.header[key]))h[key]=v.header[key];});
   var signed=sign(raw),kind=Number(v.hls)===1||/\.m3u8(?:[?#]|$)/i.test(raw)?'hls':'direct';
   out.push({name:'MovieBlast',title:meta.title,provider:'movieblast',serverName:v.server||'MovieBlast',url:signed,headers:h,type:kind,format:kind,mimeType:kind==='hls'?'application/x-mpegURL':undefined,quality:q?q[1]+'p':'Unknown',audioLanguage:meta.original,subtitles:tracks});
  });
  log('RESULT: '+out.length+' original-language links; subtitleUrls='+tracks.length+'; device playback unverified');return out;
 }catch(error){log('NO_RESULT: '+(/HTTP \d+|timeout|budget/.exec(String(error.message))||['request or signing failure'])[0]);return [];}
}
module.exports={getStreams:getStreams};
})();
