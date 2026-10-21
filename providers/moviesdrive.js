/* MoviesDrive 4.1.0 — one website route, exact identity/episode selection, bounded media validation. */
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
        original_language: raw.originalLanguage || raw.original_language || "",
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


(function () {
  'use strict';
  var $lib = require('cheerio-without-node-native');
  var FALLBACK='https://new3.moviesdrive.beer';
  var DOMAIN_MAP='https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
  var UA='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
  var domainCache=null;
  var LANG={en:['english'],hi:['hindi'],ko:['korean'],ja:['japanese'],zh:['chinese','mandarin','cantonese'],ta:['tamil'],te:['telugu'],ml:['malayalam'],kn:['kannada'],bn:['bengali','bangla'],ms:['malay'],id:['indonesian'],fr:['french'],de:['german'],es:['spanish'],it:['italian'],pt:['portuguese'],th:['thai'],tr:['turkish'],ar:['arabic'],ru:['russian'],vi:['vietnamese'],tl:['filipino','tagalog'],pa:['punjabi'],mr:['marathi']};
  function log(s){console.log('[MoviesDrive] '+s);}
  function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
  function norm(s){return clean(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^\w\u0080-\uffff]+/g,' ').trim();}
  function abs(s,base){try{var u=new URL(s,base);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
  function allowedDomain(s){try{var u=new URL(s);return u.protocol==='https:'&&/^(?:[a-z0-9-]+\.)*moviesdrives?\.[a-z0-9.-]+$/i.test(u.hostname)&&!u.username&&!u.password?u.origin:'';}catch(_){return '';}}
  function hostIs(s,pattern){try{return pattern.test(new URL(s).hostname);}catch(_){return false;}}
  function archiveURL(s){return hostIs(s,/^(?:[a-z0-9-]+\.)*mdrive\.lol$/i)&&/^\/archive\/\d+\/?$/.test(new URL(s).pathname);}
  function hubURL(s){return hostIs(s,/^(?:[a-z0-9-]+\.)*hubcloud\.[a-z0-9-]+$/i)&&/^\/drive\/[a-z0-9_-]+\/?$/i.test(new URL(s).pathname);}
  function qvalue(s){var m=/\b(720|1080|1440|2160)[pP]?\b/.exec(s);return m?Number(m[1]):/\b4k\b/i.test(s)?2160:0;}
  function seasonValue(s){var m=/\bseason\s*0*(\d+)\b|\bs0*(\d+)\b/i.exec(s);return m?Number(m[1]||m[2]):null;}
  function episodeValue(s){
    if(/\b(?:zip|pack|complete|all episodes)\b|\b(?:ep(?:isode)?|e)\s*\d+\s*[-–]\s*(?:(?:ep(?:isode)?|e)\s*)?\d+\b/i.test(s))return null;
    var matches=String(s).match(/\b(?:ep(?:isode)?|e)\s*0*(\d+)\b/ig)||[];
    var se=/\bs0*(\d+)e0*(\d+)\b/i.exec(s);
    if(se)return {season:Number(se[1]),episode:Number(se[2])};
    if(matches.length!==1)return null;
    return {season:null,episode:Number(matches[0].match(/\d+/)[0])};
  }
  function titleOf(s){return norm(String(s).split(/\(\s*(?:season\b|\d{4}\b)|\bseason\s*\d|\bs\d{1,2}\b/i)[0]);}
  function exactTitle(s,meta){var title=titleOf(s);return buildTitleProfile(meta).aliases.some(function(a){return norm(a)===title;});}
  function yearOf(s){var m=/\b((?:19|20)\d{2})\b/.exec(s);return m?m[1]:'';}
  function matchPost(doc,meta,type,season){
    if(!doc||!doc.post_title||!doc.permalink)return false;
    var title=String(doc.post_title),sourceSeason=seasonValue(title);
    if(type==='tv'&&sourceSeason!==season)return false;
    if(type==='movie'&&(sourceSeason!==null||/\b(?:series|television)\b/i.test(title)))return false;
    var imdb=(meta.external_ids||{}).imdb_id||meta.imdb_id||'';
    var exactId=!!imdb&&doc.imdb_id===imdb;
    if(!exactTitle(title,meta))return false;
    var year=String(meta.release_date||meta.first_air_date||'').slice(0,4);
    return exactId||!!year&&yearOf(title)===year;
  }
  function audioPolicy(label,original){
    // Read only language brackets, excluding subtitle/codec brackets and title/category text.
    var groups=String(label).match(/\[[^\]]*\]|\{[^}]*\}/g)||[],found=[];
    groups.forEach(function(g){
      if(/\b(?:subtitles?|subs|esubs|x264|x265|hevc)\b/i.test(g))return;
      var words=' '+norm(g)+' ';
      Object.keys(LANG).forEach(function(code){if(LANG[code].some(function(w){return words.indexOf(' '+w+' ')>=0;})&&found.indexOf(code)<0)found.push(code);});
    });
    var hasOriginal=!!original&&found.indexOf(original)>=0;
    if(LANG[original]&&found.length&&!hasOriginal)return {allowed:false,languages:found,status:'non-original'};
    if(!found.length&&/\bdubbed\b|\bhindi line\b/i.test(label)&&!/\b(?:dual|multi)[ -]?audio\b/i.test(label))return {allowed:false,languages:[],status:'dubbed'};
    return {allowed:true,languages:found,status:hasOriginal?(found.length>1?'dual':'original'):'unknown'};
  }
  function visible($,el){return !$(el).closest('[aria-hidden="true"],[hidden]').length;}
  function codecHint(label){
    var text=String(label||''),codec=/\b(?:x[ ._-]?264|h[ ._-]?264|avc)\b/i.test(text)?'h264':/\b(?:x[ ._-]?265|h[ ._-]?265|hevc)\b/i.test(text)?'hevc':'unknown';
    return {codec:codec,bitDepth:/\b(?:10[ ._-]?bit|hi10p|main[ ._-]?10)\b/i.test(text)?10:/\b8[ ._-]?bit\b/i.test(text)?8:null};
  }
  function codecFromBytes(bytes){
    function contains(needle){
      for(var i=0;i<=bytes.length-needle.length;i++){
        var match=true;for(var j=0;j<needle.length;j++)if(bytes[i+j]!==needle.charCodeAt(j)){match=false;break;}
        if(match)return true;
      }
      return false;
    }
    if(contains('V_MPEG4/ISO/AVC'))return 'h264';
    if(contains('V_MPEGH/ISO/HEVC'))return 'hevc';
    return 'unknown';
  }
  function rank(rows){
    function qualityScore(q){q=parseInt(q,10);return q===1080?0:q===720?1:q===1440?2:q===2160?3:9;}
    function codecScore(row){var c=row.codecInfo||{codec:row.videoCodec||'unknown',bitDepth:row.videoBitDepth||null};return c.bitDepth===10?5:c.codec==='h264'?0:c.codec==='unknown'?1:2;}
    return rows.sort(function(a,b){return codecScore(a)-codecScore(b)||qualityScore(a.quality)-qualityScore(b.quality);});
  }
  function sourceChoices(rows){
    var ordered=rank(rows),seen=Object.create(null),primary=[],duplicates=[];
    ordered.forEach(function(row){var c=row.codecInfo||{},key=c.codec+'|'+(c.bitDepth||'')+'|'+row.quality;if(seen[key])duplicates.push(row);else{seen[key]=true;primary.push(row);}});
    return primary.concat(duplicates).slice(0,4);
  }
  function parsePost(html,base,meta,type,season){
    var $=$lib.load(html),h1=$('h1').map(function(_,e){return clean($(e).text());}).get().find(function(text){return exactTitle(text,meta);})||'',rows=[],seen=Object.create(null);
    if(!exactTitle(h1,meta)||(type==='tv'&&seasonValue(h1)!==season))return [];
    if(type==='movie'&&yearOf(h1)!==String(meta.release_date||'').slice(0,4))return [];
    $('a[href]').each(function(_,a){
      if(!visible($,a))return;
      var anchor=$(a),href=abs(anchor.attr('href'),base);
      if(!archiveURL(href)&&!hubURL(href))return;
      var block=anchor.closest('h5,h4,h3,p');if(!block.length)return;
      var label=clean(block.text());
      // Current layout has a descriptive h5 followed by a separate h5 button.
      var previous=block.prev(),steps=0;
      while(previous.length&&steps++<3){
        var text=clean(previous.text());
        if(text&&!previous.find('a[href]').length){label=text+' '+label;break;}
        if(previous.find('a[href]').length)break;
        previous=previous.prev();
      }
      if(/\bzip\b|\.zip(?:[?#]|$)/i.test(label+' '+href))return;
      var quality=qvalue(label),audio=audioPolicy(label,meta.original_language||'');
      if(quality<720||!audio.allowed||seen[href])return;
      if(type==='tv'&&seasonValue(label)!==season)return;
      seen[href]=true;rows.push({url:href,quality:quality,audio:audio,label:label,codecInfo:codecHint(label)});
    });
    return sourceChoices(rows);
  }
  function parseArchive(html,base,meta,type,season,episode,source){
    var $=$lib.load(html),title=$('h1').map(function(_,e){return clean($(e).text());}).get().find(function(text){return exactTitle(text,meta);})||'',out=[],seen=Object.create(null);
    if(!exactTitle(title,meta))return [];
    if(type==='tv'&&seasonValue(title)!==season)return [];
    if(type==='movie'&&yearOf(title)!==String(meta.release_date||'').slice(0,4))return [];
    $('a[href]').each(function(_,a){
      if(!visible($,a))return;
      var anchor=$(a),href=abs(anchor.attr('href'),base);if(!hubURL(href)||seen[href])return;
      var local=anchor.closest('h5,h4,h3,p'),label=clean(local.text());
      if(type==='tv'){
        var prev=local.prev(),steps=0,matched=false;
        while(prev.length&&steps++<3){
          if(prev.find('a[href]').length)break;
          var text=clean(prev.text()),ep=episodeValue(text);
          if(ep){if(ep.episode!==episode||(ep.season!==null&&ep.season!==season))return;label=text;matched=true;break;}
          // A different/packed episode heading is a hard boundary, not a fallback to the next episode.
          if(/\b(?:EP\d|episode\b|S\d+E\d+)/i.test(text))return;
          prev=prev.prev();
        }
        if(!matched)return;
      }
      if(/\bzip\b|\.zip(?:[?#]|$)/i.test(label+' '+href))return;
      seen[href]=true;out.push({url:href,quality:qvalue(label)||source.quality,audio:source.audio,codecInfo:codecHint(title+" "+label).codec!=="unknown"?codecHint(title+" "+label):source.codecInfo});
    });
    return out.slice(0,2);
  }
  function hubNext(html,base){
    var $=$lib.load(html),next=$('a[href*="hubcloud.php"]').first().attr('href')||$('#download[href]').attr('href');
    if(!next){var m=/var\s+url\s*=\s*(['"])([^'"]+)\1/.exec(html);next=m&&m[2];}
    next=next?abs(next,base):'';
    // Follow only the intermediate route the original HubCloud page actually supplied.
    return next&&/\/hubcloud\.php$/.test(new URL(next).pathname)?next:'';
  }
  function directLinks(html,base){
    var $=$lib.load(html),rows=[],seen=Object.create(null);
    $('a[href]').each(function(_,a){
      if(!visible($,a))return;
      var href=abs($(a).attr('href'),base);if(!href||seen[href])return;
      var u=new URL(href),label=clean($(a).text());
      if(/\.(?:zip|rar|7z)(?:[?#]|$)/i.test(href)||/\bzip\b/i.test(label))return;
      if(/(?:\.r2\.cloudflarestorage\.com|\.cloudflarestorage\.com|\.r2\.dev)$/i.test(u.hostname)&&!/^\/?$/.test(u.pathname)){
        seen[href]=true;rows.push({url:href,server:/fsl/i.test(label)?'FSL':'R2'});
      }
    });
    return rows.slice(0,2);
  }
  function magic(b){return b.length>=8&&((b[0]===26&&b[1]===69&&b[2]===223&&b[3]===163)||(b[4]===102&&b[5]===116&&b[6]===121&&b[7]===112));}
  async function getStreams(id,mediaType,season,episode){
    var type=mediaType==='series'?'tv':mediaType;
    if(!/^[1-9]\d*$/.test(String(id))||['movie','tv'].indexOf(type)<0)return [];
    season=Number(season);episode=Number(episode);
    if(type==='tv'&&(!Number.isInteger(season)||season<1||!Number.isInteger(episode)||episode<1))return [];
    var deadline=Date.now()+18700,calls=0,collectionUntil=deadline,streams=[],seenFiles=Object.create(null),seenFormats=Object.create(null);
    function finish(){return rank(streams).slice(0,3);}
    async function request(target,ref,binary,limit){
      var timeout=Math.min(limit||4300,collectionUntil-Date.now());if(timeout<250)throw Error('budget exhausted');
      var controller=typeof AbortController==='function'?new AbortController():null,timer;
      var headers={'User-Agent':UA,Referer:ref||FALLBACK+'/'};if(binary)headers.Range='bytes=0-8191';
      calls++;
      try{return await Promise.race([
        (async function(){
          var res=await fetch(target,{headers:headers,signal:controller?controller.signal:undefined});
          if(!res.ok)throw Error('HTTP '+res.status+' at '+new URL(target).hostname);
          var ct=String(res.headers.get('content-type')||'').toLowerCase();
          if(binary){
            var range=String(res.headers.get('content-range')||''),m=/^bytes\s+0-(\d+)\/(\d+)$/i.exec(range);
            if(res.status!==206||!m||Number(m[1])>65535||Number(m[2])<1048576||/html|json/.test(ct)){if(controller)controller.abort();throw Error('invalid media range/type');}
            var signature=false,detectedCodec='unknown';
            if(typeof res.arrayBuffer==='function'){
              var bytes=new Uint8Array(await res.arrayBuffer());if(bytes.length>65536||!magic(bytes))throw Error('media signature mismatch');signature=true;detectedCodec=codecFromBytes(bytes);
            }else{
              var filename=String(res.headers.get('content-disposition')||'')+' '+new URL(res.url||target).pathname;
              if(!/\.(?:mkv|mp4)(?:[;"\s]|$)/i.test(filename))throw Error('binary probe unavailable and no video filename');
            }
            return {url:res.url||target,size:Number(m[2]),signature:signature,codec:detectedCodec};
          }
          var text=await res.text();if(text.length>2200000)throw Error('page exceeds parsing limit');
          return {url:res.url||target,text:text,status:res.status};
        })(),
        new Promise(function(_,reject){timer=setTimeout(function(){if(controller)controller.abort();reject(Error('request timeout at '+new URL(target).hostname));},timeout);})
      ]);}finally{clearTimeout(timer);}
    }
    async function metadata(){
      var endpoint='https://api.themoviedb.org/3/'+type+'/'+id+'?api_key=1865f43a0549ca50d341dd9ab8b29f49&append_to_response=external_ids,alternative_titles';
      return vueoSharedTmdb(endpoint,function(){return request(endpoint).then(function(r){return JSON.parse(r.text);});});
    }
    async function domain(){
      if(domainCache&&Date.now()-domainCache.at<1800000)return domainCache.url;
      try{var d=JSON.parse((await request(DOMAIN_MAP,FALLBACK+'/',false,2000)).text),value=allowedDomain(d.moviesdrive);if(value){domainCache={url:value,at:Date.now()};return value;}}catch(_){log('DOMAIN: map unavailable; using tested fallback');}
      return FALLBACK;
    }
    try{
      var values=await Promise.all([metadata(),domain()]),meta=values[0],base=values[1],aliases=buildTitleProfile(meta).aliases.slice(0,2),match=null;
      log('ROUTE: v4.1.0 '+new URL(base).hostname+'; H.264 first; alternatives up to 3; one engine; original/dual-including-original/unknown; minimum 720p');
      var queries=aliases.slice(0,1),imdb=(meta.external_ids||{}).imdb_id||meta.imdb_id;
      if(imdb)queries.push(imdb);else if(aliases[1])queries.push(aliases[1]);
      for(var qi=0;qi<queries.length&&!match;qi++){
        var search=await request(base+'/search.php?q='+encodeURIComponent(queries[qi])+'&page=1',base+'/'),data=JSON.parse(search.text);
        var docs=(Array.isArray(data.hits)?data.hits:[]).map(function(h){return h.document;});
        match=docs.find(function(d){return matchPost(d,meta,type,season);});
        log('SEARCH: query '+(qi+1)+' hits='+docs.length+' exactMatch='+!!match);
      }
      if(!match){log('NO_RESULT: no exact title/year-or-IMDb/season match');return [];}
      var pageURL=abs(match.permalink,base);if(!pageURL||new URL(pageURL).hostname!==new URL(base).hostname){log('NO_RESULT: post outside active domain');return [];}
      var page=await request(pageURL,base+'/'),sources=parsePost(page.text,page.url,meta,type,season);
      log('POST: eligible quality routes='+sources.length+(type==='tv'?' S'+season+'E'+episode:''));
      for(var si=0;si<sources.length&&streams.length<3&&Date.now()<collectionUntil-700;si++){
        var source=sources[si],sourceStartCount=streams.length;
        try{
          var hubs=[];
          if(hubURL(source.url)){if(type==='tv')continue;hubs=[source];}
          else{
            var archive=await request(source.url,page.url);hubs=parseArchive(archive.text,archive.url,meta,type,season,episode,source);
          }
          log('ARCHIVE: declaredCodec='+(source.codecInfo||{}).codec+' quality='+source.quality+'p exactEpisodeHosts='+hubs.length+'; ZIP packs excluded');
          for(var hi=0;hi<hubs.length&&streams.length<3&&Date.now()<collectionUntil-700;hi++){
            var hub=hubs[hi],first=await request(hub.url,source.url),next=hubNext(first.text,first.url),final=first;
            if(next)final=await request(next,first.url);
            var links=directLinks(final.text,final.url);log('HUB: direct storage candidates='+links.length);
            for(var di=0;di<links.length&&Date.now()<collectionUntil-700;di++){
              try{
                var result=await request(links[di].url,final.url,true),audio=source.audio;
                var actual=result.codec&&result.codec!=='unknown'?result.codec:((hub.codecInfo||source.codecInfo||{}).codec||'unknown');
                var hinted=hub.codecInfo||source.codecInfo||{},bitDepth=hinted.codec===actual?hinted.bitDepth:null;
                var identity=new URL(result.url).origin+new URL(result.url).pathname;
                if(seenFiles[identity]){log('MEDIA: duplicate file omitted');break;}
                seenFiles[identity]=true;
                var formatKey=hub.quality+'|'+actual+'|'+(bitDepth||'');
                if(seenFormats[formatKey]){log('MEDIA: equivalent quality/codec alternative omitted');break;}
                seenFormats[formatKey]=true;
                log('MEDIA: HTTP 206; '+(result.signature?'MKV/MP4 signature':'video filename')+' verified; codec='+actual+' codecEvidence='+(result.codec!=='unknown'?'container':'label-or-unknown')+'; '+hub.quality+'p; audio='+audio.status+'; calls='+calls);
                streams.push({name:'MoviesDrive',title:(meta.title||meta.name)+' '+(type==='tv'?'S'+season+'E'+episode+' ':'')+(audio.status==='unknown'?'Unknown Audio':audio.status==='dual'?'Dual Audio':'Original Audio'),url:result.url,quality:hub.quality+'p',size:result.size,provider:'moviesdrive',serverName:links[di].server,videoCodec:actual,videoBitDepth:bitDepth,codecEvidence:result.codec!=='unknown'?'container-codec-id':actual!=='unknown'?'file-label':'unknown',language:audio.languages.length===1?audio.languages[0]:'',audioLanguages:audio.languages,audioStatus:audio.status,headers:{'User-Agent':UA,Referer:final.url},subtitles:[],behaviorHints:{notWebReady:true}});
                if(streams.length===1)collectionUntil=Math.min(deadline,Date.now()+5500);
                break;
              }catch(err){log('MEDIA_REJECT: '+String(err.message||err));}
            }
            if(streams.length>sourceStartCount)break;
          }
        }catch(err){log('HOST: '+String(err.message||err));}
      }
      log('RESULT: '+streams.length+' validated sources; H.264 first, alternatives retained; calls='+calls);return finish();
    }catch(err){log('RESULT: retained='+streams.length+'; '+String(err.message||err));return finish();}
  }
  module.exports={getStreams:getStreams};globalThis.getStreams=getStreams;
  if(globalThis.MOVIESDRIVE_TEST_MODE)module.exports._test={sourceChoices:sourceChoices,codecHint:codecHint,codecFromBytes:codecFromBytes,rank:rank,norm:norm,allowedDomain:allowedDomain,matchPost:matchPost,audioPolicy:audioPolicy,episodeValue:episodeValue,parsePost:parsePost,parseArchive:parseArchive,hubNext:hubNext,directLinks:directLinks,magic:magic};
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
    if (stream.audioStatus === "unknown") audioLabel = "Unknown Audio";
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
    var bottomLine = [stream.videoCodec==="h264"?"H.264":stream.videoCodec==="hevc"?"HEVC":"Codec unknown", formatLabel ? "🎞️ " + (formatLabel === "HLS" ? "M3U8" : formatLabel) : "", duration ? "⏱️ " + duration : "", "📌 " + server].filter(Boolean).join(" | ");
    var nameQuality = qualityLabel === "4K" ? "4K UHD" : qualityLabel === "1080p" ? "1080p FHD" : qualityLabel === "720p" ? "720p HD" : qualityLabel;
    var codecDisplay=stream.videoCodec==="h264"?"H.264":stream.videoCodec==="hevc"?"HEVC":"Codec unknown";
    if(stream.videoBitDepth)codecDisplay+=" "+stream.videoBitDepth+"-bit";
    output.name = ["🟡 " + providerName, nameQuality, codecDisplay, audioLabel ? audioLabel.replace(/ Audio/g, "-Audio") : ""].filter(Boolean).join(" | ");
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
module.exports = cloudbankDisplayInstall(module.exports, "MoviesDrive", "moviesdrive");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
