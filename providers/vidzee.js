"use strict";

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  function trace(stage, details) {
    try {
      if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
        globalThis.vueoTrace(stage, details);
      }
    } catch (_) {}
  }
  function normalize(raw) {
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (_) { return null; }
    }
    if (!raw || typeof raw !== "object" || raw.error) return null;
    var tmdb = raw.tmdb;
    if (!tmdb || typeof tmdb !== "object") {
      if (!raw.title || (raw.mediaType !== "movie" && raw.mediaType !== "tv")) return null;
      var alternatives = Array.isArray(raw.aliases) ? raw.aliases.map(function(alias) {
        return { title: String(alias), iso_3166_1: "" };
      }) : [];
      tmdb = {
        id: raw.tmdbId,
        title: raw.mediaType === "movie" ? raw.title : undefined,
        name: raw.mediaType === "tv" ? raw.title : undefined,
        original_title: raw.mediaType === "movie" ? (raw.originalTitle || raw.title) : undefined,
        original_name: raw.mediaType === "tv" ? (raw.originalTitle || raw.title) : undefined,
        release_date: raw.mediaType === "movie" && raw.year ? String(raw.year) + "-01-01" : "",
        first_air_date: raw.mediaType === "tv" && raw.year ? String(raw.year) + "-01-01" : "",
        external_ids: { imdb_id: raw.imdbId || "" },
        alternative_titles: { titles: alternatives, results: alternatives }
      };
    }
    if (!tmdb.title && !tmdb.name) return null;
    trace("METADATA", { shared: true, title: raw.title || tmdb.title || tmdb.name || "",
      year: raw.year || "", imdbId: raw.imdbId || "",
      aliases: Array.isArray(raw.aliases) ? raw.aliases.length : 0 });
    return tmdb;
  }
  function local() {
    trace("METADATA_FALLBACK", { shared: false });
    return Promise.resolve().then(fallback);
  }
  try {
    if (typeof globalThis !== "undefined") {
      var direct = normalize(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (direct) return Promise.resolve(direct);
      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve().then(function() {
          return globalThis.vueoDiscoveryContext(url);
        }).then(function(raw) {
          var shared = normalize(raw);
          return shared || local();
        }, local);
      }
    }
  } catch (_) {}
  return local();
}

/* VUEO_TITLE_PROFILE_V1 */
function buildTitleProfile(tmdb) {
  var primary = String(tmdb.title || tmdb.name || "").trim();
  var aliases = [];
  function add(value) {
    value = String(value || "").trim();
    if (value && aliases.indexOf(value) === -1) aliases.push(value);
  }
  add(primary);
  add(tmdb.original_title || tmdb.original_name);
  var alternate = tmdb.alternative_titles || {};
  (alternate.titles || alternate.results || []).forEach(function(item) { add(item.title); });
  return { title: primary, aliases: aliases };
}


// VidZee player audit: Ads-B94UKDII.js, checked 2026-10-16 (Malaysia).
// Current API supports the e=0 response encoding: {url, language, headers}.
var VIDZEE_CORE='https://core.vidzee.wtf';
var VIDZEE_PLAYER='https://player.vidzee.wtf/';
var VIDZEE_SERVERS=[
  {id:'dcloud',name:'Dcloud'},
  {id:'tik',name:'TCloud'},
  {id:'ipcloud',name:'IPcloud'}
];
function vzLog(stage,message){ console.log('[VidZee] '+stage+': '+message); }
function vzHeaders(extra){
  var h={Referer:VIDZEE_PLAYER,Origin:'https://player.vidzee.wtf'};
  if(extra && typeof extra==='object') Object.keys(extra).forEach(function(k){if(typeof extra[k]==='string') h[k]=extra[k];});
  return h;
}
function vzURL(value){
  value=String(value||'').trim();
  if(!/^https?:\/\//i.test(value))return '';
  try{var u=new URL(value);return u.username || u.password ? '' : u.href;}catch(_){return '';}
}
async function vzRequest(url,options,state,limit){
  var left=state.deadline-Date.now();
  if(left<100)throw new Error('budget exhausted');
  var timer;
  try{return await Promise.race([
    Promise.resolve().then(function(){return fetch(url,options||{});}).then(async function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      var body=await r.text();
      if(body.length>1500000)throw new Error('response too large');
      return body;
    }),
    new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error('request timeout'));},Math.min(left,limit||6500));})
  ]);}finally{clearTimeout(timer);}
}
async function vzJson(url,state,limit){return JSON.parse(await vzRequest(url,{headers:vzHeaders()},state,limit));}
function vzHash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function vzSubtitles(raw){
  var out=[],seen={};
  if(!Array.isArray(raw))return out;
  raw.forEach(function(item){
    if(!item || typeof item!=='object')return;
    var url=vzURL(item.file||item.url);if(!url||seen[url])return;seen[url]=true;
    var label=String(item.label||item.lang||'Unknown');
    var langs={english:'en',malay:'ms',malaysian:'ms',indonesian:'id'};
    out.push({id:'vidzee-'+vzHash(url),url:url,lang:langs[label.toLowerCase()]||label,label:label});
  });
  // Keep all upstream tracks; place the user's common languages first.
  function rank(x){return x.lang==='en'?0:x.lang==='ms'?1:x.lang==='id'?2:3;}
  return out.map(function(x,i){return {x:x,i:i};}).sort(function(a,b){return rank(a.x)-rank(b.x)||a.i-b.i;}).map(function(x){return x.x;});
}
function vzPlaylistInfo(body){
  if(!/^\s*#EXTM3U\b/.test(body))return {valid:false};
  var heights=[],m,re=/#EXT-X-STREAM-INF:([^\r\n]+)/g;
  while((m=re.exec(body))){var size=m[1].match(/(?:^|,)\s*RESOLUTION\s*=\s*\d+x(\d+)/i);if(size)heights.push(Number(size[1]));}
  return {valid:true,master:/#EXT-X-STREAM-INF:/.test(body),height:heights.length?Math.max.apply(null,heights):0,variants:heights.length};
}
async function vzResolve(server,path,state){
  var started=Date.now();
  try{
    var raw=await vzJson(VIDZEE_CORE+'/streams/'+path+'?s='+encodeURIComponent(server.id)+'&e=0',state,6500);
    if(raw && typeof raw.c==='string' && !raw.url){vzLog('ENCODING',server.name+': encrypted response; e=0 did not return a URL');return null;}
    if(!raw || raw.error || raw.ok===false){vzLog('SERVER',server.name+': upstream returned no source');return null;}
    var url=vzURL(raw.url);
    if(!url){vzLog('SERVER',server.name+': no valid HTTP media URL');return null;}
    var headers=vzHeaders(raw.headers),format=/\.mp4(?:[?#]|$)/i.test(url)?'mp4':'m3u8',height=0;
    if(format==='m3u8'){
      try{
        var body=await vzRequest(url,{headers:headers},state,3000),info=vzPlaylistInfo(body);
        if(!info.valid){vzLog('HLS_INVALID',server.name+': response is not an HLS playlist');return null;}
        height=info.height;
        vzLog('HLS',server.name+': '+(info.master?'master':'media playlist')+'; '+(height?'maximum '+height+'p':'resolution unknown')+'; playback not verified');
      }catch(_){vzLog('HLS_UNVERIFIED',server.name+': playlist request failed; retaining discovered URL with unknown quality');}
    }
    vzLog('SERVER',server.name+': source discovered in '+(Date.now()-started)+'ms');
    return {server:server.name,url:url,headers:headers,format:format,height:height,language:String(!raw.language||/^auto$/i.test(String(raw.language))?(server.language||'Auto'):raw.language)};
  }catch(e){vzLog('SERVER_ERROR',server.name+': '+(String(e.message).match(/HTTP \d+|request timeout|budget exhausted|response too large/)||['request/JSON failure'])[0]);return null;}
}

function vzLanguage(value){
 var v=String(value||'').toLowerCase().trim();
 var names={english:'en',hindi:'hi',japanese:'ja',korean:'ko',chinese:'zh',mandarin:'zh',tamil:'ta',telugu:'te',bengali:'bn',malay:'ms',malaysian:'ms',indonesian:'id',french:'fr',german:'de',spanish:'es',italian:'it',thai:'th',russian:'ru',arabic:'ar',portuguese:'pt',turkish:'tr'};
 if(names[v])return names[v];
 return /^[a-z]{2}(?:-[a-z]{2})?$/.test(v)?v.slice(0,2):'';
}
async function vzOriginalMetadata(meta,tmdbId,mediaType,state){
 if(!meta)return null;
 if(vzLanguage(meta.original_language))return meta;
 var profile=buildTitleProfile(meta),query=profile.title;if(!query)return meta;
 try{
  // Search results carry original_language even if the app's shared detail
  // response has stripped that field. Accept only the identical TMDB ID.
  var url='https://api.themoviedb.org/3/search/'+mediaType+'?api_key=439c478a771f35c05022f9feabcca01c&query='+encodeURIComponent(query);
  var raw=await vzJson(url,state,2500),found=(raw.results||[]).filter(function(x){return String(x.id)===String(tmdbId);})[0];
  if(found&&vzLanguage(found.original_language)){var copy={};Object.keys(meta).forEach(function(k){copy[k]=meta[k];});copy.original_language=found.original_language;return copy;}
 }catch(_){}
 return meta;
}
async function getStreams(tmdbId,mediaType,season,episode){
  if(mediaType==='series')mediaType='tv';
  if((mediaType!=='movie'&&mediaType!=='tv')||!/^\d+$/.test(String(tmdbId))||Number(tmdbId)<1)return [];
  if(mediaType==='tv' && (!Number.isInteger(Number(season))||Number(season)<0||!Number.isInteger(Number(episode))||Number(episode)<1))return [];
  var state={deadline:Date.now()+18000};
  var path=mediaType+'/'+encodeURIComponent(tmdbId);
  if(mediaType==='tv')path+='/'+Number(season)+'/'+Number(episode);
  vzLog('MAPPING','Direct TMDB route '+path+'; upstream content identity is not independently confirmed');
  var metadataURL='https://api.themoviedb.org/3/'+mediaType+'/'+tmdbId+'?api_key=439c478a771f35c05022f9feabcca01c&append_to_response=alternative_titles';
  var metadataTask=vueoSharedTmdb(metadataURL,function(){return vzJson(metadataURL,state,4000);}).then(function(meta){return vzOriginalMetadata(meta,tmdbId,mediaType,state);}).catch(function(){return null;});
  var subsTask=vzJson(VIDZEE_CORE+'/subs/'+path,state,5500).then(vzSubtitles).catch(function(){vzLog('SUBTITLE','Subtitle list unavailable');return [];});
  // Start independent server requests together; preserve website server order.
  var fixedTask=Promise.all(VIDZEE_SERVERS.map(function(server){return vzResolve(server,path,state);}));
  var languageTask=metadataTask.then(async function(meta){
    var original=vzLanguage(meta&&meta.original_language);
    state.originalLanguage=original;
    vzLog('AUDIO_POLICY',original?'Original language '+original+'; dubbed language servers excluded':'Original language unavailable; forced-language servers excluded, default servers remain unverified');
    if(!original)return {acme:[],fixed:[]};
    var acmeTask=vzJson(VIDZEE_CORE+'/streams/languages/'+path,state,2500).then(function(raw){
      var langs=Array.isArray(raw)?raw:(raw&&Array.isArray(raw.languages)?raw.languages:[]);
      var selected=langs.filter(function(x){return vzLanguage(x)===original;}).slice(0,1);
      return Promise.all(selected.map(function(lang){return vzResolve({id:'v4:'+lang,name:'Acme '+lang,language:lang},path,state);}));
    }).catch(function(){return [];});
    var label=original==='en'?'English':original==='hi'?'Hindi':'';
    var forcedTask=label?vzResolve({id:'v6:'+label,name:label,language:label},path,state):Promise.resolve(null);
    var pair=await Promise.all([acmeTask,forcedTask]);
    return {acme:pair[0],fixed:[pair[1]]};
  });
  var sourcesTask=Promise.all([fixedTask,languageTask]).then(function(results){
    return [results[0][0]].concat(results[1].acme,results[0].slice(1),results[1].fixed);
  });
  var all=await Promise.all([metadataTask,subsTask,sourcesTask]);
  var title=all[0]?buildTitleProfile(all[0]).title:'';
  if(!title)title='TMDB '+tmdbId;
  var subtitles=all[1],seen={},streams=[];
  all[2].forEach(function(item){
    if(!item)return;
    var language=vzLanguage(item.language),original=state.originalLanguage;
    if(language && (!original || language!==original)){vzLog('AUDIO_FILTER',item.server+': non-original/unverified language excluded');return;}
    if(!language)vzLog('AUDIO_UNVERIFIED',item.server+': upstream reports Auto; original audio is not independently confirmed');
    // Keep separate server/audio entries when they share the same media URL.
    var key=JSON.stringify([item.url,item.server,item.language,item.headers]);if(seen[key])return;seen[key]=true;
    streams.push({name:'VidZee • '+item.server,title:title+(mediaType==='tv'?' • S'+Number(season)+' E'+Number(episode):'')+' • '+item.language,url:item.url,quality:item.height?String(item.height)+'p':'auto',type:item.format,headers:item.headers,subtitles:subtitles});
  });
  vzLog('SUBTITLE',subtitles.length+' upstream tracks; cues/rendering not verified during discovery');
  vzLog('RESULT',streams.length+' source(s); '+streams.filter(function(x){return parseInt(x.quality,10)>=2160;}).length+' with 2160p+ advertised in their HLS master; playback not verified');
  return streams;
}
module.exports={getStreams:getStreams};
