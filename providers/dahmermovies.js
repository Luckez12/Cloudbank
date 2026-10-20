// Imported provider: dahmermovies; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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


/* CLOUDBANK_NUVIO_ADAPTER_V1 */
function cloudbankWrapProvider(provider, providerId, supportedTypes) {
  var upstream = provider.getStreams;
  var adapted = {};
  Object.keys(provider).forEach(function(key) { adapted[key] = provider[key]; });
  adapted.getStreams = function(tmdbId, mediaType, season, episode) {
    var args = Array.prototype.slice.call(arguments);
    var type = mediaType === "series" ? "tv" : mediaType;
    if (supportedTypes.indexOf(type) === -1 || !String(tmdbId || "").trim()) return Promise.resolve([]);
    if (type === "tv" && (!Number.isInteger(Number(season)) || Number(season) < 0 ||
        !Number.isInteger(Number(episode)) || Number(episode) < 1)) return Promise.resolve([]);
    args[0] = String(tmdbId);
    args[1] = type;
    if (type === "tv") { args[2] = Number(season); args[3] = Number(episode); }
    return new Promise(function(resolve) {
      var finished = false;
      var timer = setTimeout(function() { finish([]); }, 19000);
      function finish(value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        var seen = Object.create(null);
        var streams = Array.isArray(value) ? value.filter(function(stream) {
          if (!stream || typeof stream.url !== "string" || !/^(https?:\/\/|magnet:)/i.test(stream.url)) return false;
          // Preserve separate audio/server entries sharing the same media URL.
          var key = JSON.stringify([stream.url, stream.name, stream.headers, stream.subtitles]);
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }) : [];
        resolve(streams);
      }
      Promise.resolve().then(function() { return upstream.apply(provider, args); }).then(finish, function() { finish([]); });
    });
  };
  return adapted;
}

function cloudbankMetadataFetch(nativeFetch) {
  return function(url, options) {
    var text = typeof url === "string" ? url : url && url.url;
    var match = typeof text === "string" && /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)(?:\?|$)/.exec(text);
    var method = options && options.method ? String(options.method).toUpperCase() : "GET";
    if (!match || method !== "GET") return nativeFetch(url, options);
    // Shared metadata covers details only; search/find/season/episode requests stay upstream.
    var response;
    return vueoSharedTmdb(text, function() {
      return nativeFetch(url, options).then(function(value) {
        response = value;
        if (!value.ok) throw new Error("TMDB HTTP " + value.status);
        return value.json();
      });
    }).then(function(tmdb) {
      var profile = buildTitleProfile(tmdb);
      if (!profile.title) throw new Error("TMDB title unavailable");
      var body = JSON.stringify(tmdb);
      return {
        ok: true, status: 200, statusText: "OK", url: text,
        headers: response ? response.headers : { get: function(name) {
          return String(name).toLowerCase() === "content-type" ? "application/json" : null;
        } },
        json: function() { return Promise.resolve(JSON.parse(body)); },
        text: function() { return Promise.resolve(body); }
      };
    });
  };
}
/* CLOUDBANK_DAHMER_CONSOLIDATED_V1 */
/* CLOUDBANK_DAHMER_TV_CORE_START: TV catalogue routes and 4K selection consolidated below. */
/* CLOUDBANK_DAHMER_GET_VALIDATION_V2: single engine, published redirects, no fail-open legacy fallback. */
(function() {
  'use strict';
  var SITE='https://a.111477.xyz', KEY='439c478a771f35c05022f9feabcca01c';
  var UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  var PLAY_HEADERS={'User-Agent':UA,'Referer':SITE+'/','Accept':'*/*'};
  function log(stage,message) {console.log('[Dahmermovies] '+stage+': '+message);}
  function positive(n) {n=Number(n);return Number.isInteger(n)&&n>0?n:0;}
  function decode(value) {try{return decodeURIComponent(value);}catch(_){return value;}}
  function entities(value) {
    return String(value||'').replace(/&(?:amp|quot|apos|lt|gt|#39|#x[0-9a-f]+|#\d+);/gi,function(token) {
      var map={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&#39;':"'"};
      if(map[token.toLowerCase()])return map[token.toLowerCase()];
      var n=token.charAt(2).toLowerCase()==='x'?parseInt(token.slice(3,-1),16):parseInt(token.slice(2,-1),10);
      return n>0&&n<=65535?String.fromCharCode(n):token;
    });
  }
  function plain(value) {return entities(String(value||'').replace(/<[^>]*>/g,'')).trim();}
  function quality(value) {
    var match=/(?:^|[^0-9])(\d{3,4})p\b/i.exec(value||'');
    return match?Number(match[1]):/(?:^|[^a-z0-9])4k(?:$|[^a-z0-9])/i.test(value||'')?2160:0;
  }
  function allowed(value) {
    var q=quality(value),settings=typeof globalThis!=='undefined'&&globalThis.SCRAPER_SETTINGS||{};
    return !q||settings['q'+q]!==false;
  }
  function exactEpisode(filename,season,episode) {
    var all=[],re=/(?:^|[^a-z0-9])S0*(\d+)E0*(\d+)(?!\d)/gi,m;
    while((m=re.exec(filename)))all.push([Number(m[1]),Number(m[2])]);
    if(all.length)return all.every(function(x){return x[0]===season&&x[1]===episode;});
    re=/(?:^|[^a-z0-9])E0*(\d+)(?!\d)/gi;
    while((m=re.exec(filename)))all.push(Number(m[1]));
    return all.length>0&&all.every(function(x){return x===episode;});
  }
  function publicUrl(value,base) {
    try {var url=new URL(entities(value),base);if(url.protocol!=='https:'||url.username||url.password)return '';return url.href;}catch(_){return '';}
  }
  function getHeader(response,name) {
    return response&&response.headers&&typeof response.headers.get==='function'?String(response.headers.get(name)||''):'';
  }
  function challenge(html) {
    return /cf-chl-|challenge-platform|<title>\s*Just a moment|Performing security verification|Checking your browser/i.test(html||'');
  }
  function mediaType(url) {
    var path='';try{path=decode(new URL(url).pathname);}catch(_){}
    return /\.m3u8$/i.test(path)?'application/x-mpegURL':/\.mp4$/i.test(path)?'video/mp4':/\.webm$/i.test(path)?'video/webm':/\.mkv$/i.test(path)?'video/x-matroska':/\.avi$/i.test(path)?'video/x-msvideo':'';
  }
  function parseListing(html,base,type,season,episode,year) {
    var rows=[],seen=Object.create(null),re=/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,m;
    while((m=re.exec(html))) {
      var url=publicUrl(m[2],base);if(!url||seen[url]||!mediaType(url))continue;
      var filename=plain(m[3]);if(!/\.(?:mkv|mp4|webm|avi|m3u8)$/i.test(filename))filename=decode(new URL(url).pathname.split('/').pop());
      if(type==='tv'&&!exactEpisode(filename,season,episode))continue;
      if(type==='movie') {var years=filename.match(/(?:19|20)\d{2}/g)||[];if(years.length&&years.indexOf(String(year))<0)continue;}
      if(!allowed(filename))continue;
      seen[url]=true;rows.push({url:url,filename:filename,quality:quality(filename)});
    }
    return rows.sort(function(a,b){return b.quality-a.quality;});
  }
  function requestScope() {
    var deadline=Date.now()+18300,closed=false,calls=0,stopped=false;
    function active(){return !closed&&Date.now()<deadline;}
    function bounded(run,cap) {
      var ms=Math.min(cap,deadline-Date.now());if(!active()||ms<=0)return Promise.reject(new Error('Discovery budget exhausted'));
      return new Promise(function(resolve,reject) {
        var done=false,timer=setTimeout(function(){settle(false,new Error('Request timeout'));},ms);
        function settle(ok,value){if(done)return;done=true;clearTimeout(timer);if(!active()){reject(new Error('Discovery budget exhausted'));return;}if(ok)resolve(value);else reject(value);}
        Promise.resolve().then(function(){if(!active())throw Error('Discovery budget exhausted');return run();}).then(function(value){settle(true,value);},function(error){settle(false,error);});
      });
    }
    async function request(url,options) {
      if(!active()||stopped)throw Error('Discovery stopped');
      calls++;
      return bounded(function(){return fetch(url,options);},4200);
    }
    async function text(response){return bounded(function(){return response.text();},2200);}
    async function json(response){return bounded(function(){return response.json();},2200);}
    async function metadata(id,type) {
      var context=typeof globalThis!=='undefined'&&globalThis.VUEO_DISCOVERY_CONTEXT;
      if(typeof context==='string'){try{context=JSON.parse(context);}catch(_){context=null;}}
      var data=context&&context.tmdb,contextId=context&&(context.tmdbId||data&&data.id),contextType=context&&(context.mediaType||context.type);
      if(data&&String(contextId)===String(id)&&(!contextType||contextType===type||contextType==='series'&&type==='tv')&&(data.title||data.name))return data;
      var response=await request('https://api.themoviedb.org/3/'+type+'/'+id+'?api_key='+KEY,{headers:{'User-Agent':UA}});
      if(!response.ok)throw Error('Metadata HTTP '+response.status);
      data=await json(response);if(!data||String(data.id)!==String(id))throw Error('Metadata identity mismatch');return data;
    }
    async function listing(url) {
      var response=await request(url,{headers:PLAY_HEADERS,redirect:'follow'}),status=Number(response.status);
      log('CATALOGUE','HTTP '+status+' at '+new URL(url).hostname);
      if(status===403||status===429){stopped=true;throw Error('Catalogue access denied HTTP '+status);}
      if(!response.ok)return [];
      var html=await text(response);
      if(challenge(html)){stopped=true;throw Error('Catalogue security verification required');}
      // A redirect to the root/another catalogue must not be accepted as this title.
      var final=publicUrl(response.url||url,url);
      if(!final||decode(new URL(final).pathname)!==decode(new URL(url).pathname))throw Error('Catalogue redirected away from the requested title');
      return html;
    }
    async function media(candidate) {
      var current=candidate.url,visited=Object.create(null),hls=mediaType(candidate.url)==='application/x-mpegURL';
      for(var hop=0;hop<=5&&active();hop++) {
        if(visited[current]){log('MEDIA_REJECT','Redirect loop');return null;}visited[current]=true;
        // GET follows the same request method as playback; HEAD alone is not acceptance evidence.
        var response;
        try {response=await request(current,{method:'GET',redirect:'manual',headers:hls?PLAY_HEADERS:Object.assign({},PLAY_HEADERS,{'Range':'bytes=0-1'})});}
        catch(error){log('MEDIA_REJECT',error.message);return null;}
        var status=Number(response.status),host=new URL(response.url||current).hostname;
        if([301,302,303,307,308].indexOf(status)>=0) {
          var next=publicUrl(getHeader(response,'location'),response.url||current);
          if(!getHeader(response,'location')||!next){log('MEDIA_REJECT','Invalid redirect');return null;}
          log('MEDIA_REDIRECT',host+' -> '+new URL(next).hostname);current=next;continue;
        }
        if(status!==200&&status!==206){log('MEDIA_REJECT','HTTP '+status+' at '+host);return null;}
        var mime=getHeader(response,'content-type').split(';')[0].trim().toLowerCase();
        var range=getHeader(response,'content-range'),length=Number(getHeader(response,'content-length')||0);
        if(hls) {
          if(mime==='text/html'||/json|xml|javascript/.test(mime)){log('MEDIA_REJECT','Non-playlist '+mime+' at '+host);return null;}
          var body;try{body=await text(response);}catch(error){log('MEDIA_REJECT',error.message);return null;}
          if(!/^\s*#EXTM3U\b/.test(body)){log('MEDIA_REJECT','Invalid HLS playlist at '+host);return null;}
        }
        if(!hls&&/^(?:text\/|application\/(?:json|xml|javascript|xhtml))/.test(mime)){log('MEDIA_REJECT','Non-media '+mime+' at '+host);return null;}
        var binary=/^(?:application\/octet-stream|binary\/octet-stream|application\/x-matroska)$/.test(mime);
        if(!hls&&!/^video\//.test(mime)&&!binary){log('MEDIA_REJECT','Unverified content type at '+host);return null;}
        if(!hls&&status===206&&!/^bytes\s+0-1\/(?:\d+|\*)$/i.test(range)){log('MEDIA_REJECT','Unexpected partial range at '+host);return null;}
        if(!hls&&status===206&&/\/\d+$/.test(range)&&Number(range.split('/').pop())<2){log('MEDIA_REJECT','Invalid total media size at '+host);return null;}
        if(!hls&&status===206&&length&&length!==2){log('MEDIA_REJECT','Invalid partial length at '+host);return null;}
        if(!hls&&status===200&&binary&&length<1024){log('MEDIA_REJECT','Unverified binary response at '+host);return null;}
        if(!hls&&status===200&&getHeader(response,'content-length')&&length<2){log('MEDIA_REJECT','Empty media response at '+host);return null;}
        var finalUrl=publicUrl(response.url||current,current);if(!finalUrl)return null;
        // File links keep their original playback headers and exact signed query strings.
        log('MEDIA_ACCEPT','GET '+status+' at '+host+'; '+mime+'; header check only');
        return {name:'Dahmermovies',provider:'dahmermovies',serverName:'Dahmermovies',title:candidate.filename,filename:candidate.filename,url:finalUrl,quality:hls?'Auto':candidate.quality?candidate.quality+'p':'Unknown',type:hls?'hls':'direct',mimeType:hls?'application/x-mpegURL':/^video\//.test(mime)?mime:mediaType(candidate.url),headers:Object.assign({},PLAY_HEADERS),subtitles:[]};
      }
      log('MEDIA_REJECT','Redirect limit or discovery deadline');return null;
    }
    return {active:active,metadata:metadata,listing:listing,media:media,close:function(){closed=true;},calls:function(){return calls;},stopped:function(){return stopped;}};
  }
  async function getStreams(id,type,season,episode) {
    type=type==='series'?'tv':type;
    if(!/^\d+$/.test(String(id||''))||!positive(id)||(type!=='movie'&&type!=='tv'))return [];
    if(type==='tv'&&(!Number.isInteger(Number(season))||Number(season)<0||!positive(episode)))return [];
    season=Number(season);episode=Number(episode);
    var scope=requestScope(),result=[];
    try {
      var meta=await scope.metadata(String(id),type),title=String((type==='tv'?meta.name:meta.title)||'').trim();
      var year=String(type==='tv'?meta.first_air_date||'':meta.release_date||'').slice(0,4);
      if(!title||type==='movie'&&!/^\d{4}$/.test(year))throw Error('Exact title/year unavailable');
      var titles=[title],original=String(type==='tv'?meta.original_name||'':meta.original_title||'').trim();
      if(original&&original!==title)titles.push(original);
      var routes=[],seen=Object.create(null);
      titles.forEach(function(name){
        name=name.replace(/:/g,'');
        var base=SITE+(type==='movie'?'/movies/'+encodeURIComponent(name+' ('+year+')')+'/':'/tvs/'+encodeURIComponent(name)+'/');
        var urls=type==='movie'?[base]:[base+'Season%20'+(season<10?'0':'')+season+'/',base+'Season%20'+season+'/'];
        urls.forEach(function(url){if(!seen[url]){seen[url]=true;routes.push(url);}});
      });
      log('ROUTE','single catalogue engine; GET media validation; no legacy success fallback');
      var candidates=[],candidateSeen=Object.create(null);
      for(var r=0;r<routes.length&&scope.active()&&!scope.stopped();r++) {
        var html=await scope.listing(routes[r]);
        if(typeof html!=='string')continue;
        var rows=parseListing(html,routes[r],type,season,episode,year);
        rows.forEach(function(row){if(!candidateSeen[row.url]){candidateSeen[row.url]=true;candidates.push(row);}});
        if(rows.length)break;
      }
      // Resolve one published candidate at a time, bounded to avoid fetching a whole catalogue.
      for(var i=0;i<Math.min(candidates.length,10)&&result.length<5&&scope.active();i++) {
        var stream=await scope.media(candidates[i]);
        if(stream&&!result.some(function(old){return old.url===stream.url;}))result.push(stream);
      }
    }catch(error){log('NO_RESULT',error.message);}
    finally {scope.close();log('RESULT',result.length+' sources; '+scope.calls()+' HTTP calls');}
    return result;
  }
  function boundedStreams() {
    var args=arguments;
    // A final public deadline prevents a slow native call from keeping discovery alive.
    return new Promise(function(resolve){
      var done=false,timer=setTimeout(function(){finish([]);},18500);
      function finish(rows){if(done)return;done=true;clearTimeout(timer);resolve(rows);}
      Promise.resolve().then(function(){return getStreams.apply(null,args);}).then(finish,function(){finish([]);});
    });
  }
  module.exports={getStreams:boundedStreams,onSettings:async function(){
    var options=[['q2160','4K (2160p)'],['q1440','2K (1440p)'],['q1080','FHD (1080p)'],['q720','HD (720p)'],['q480','SD (480p)']];
    return [{type:'header',label:'Quality Preferences'}].concat(options.map(function(item){return {type:'toggle',key:item[0],label:'Enable '+item[1],defaultValue:true};}));
  }};
})();
/* CLOUDBANK_DAHMER_TV_CORE_END */
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
module.exports = cloudbankDisplayInstall(module.exports, "Dahmermovies", "dahmermovies");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */

if (typeof globalThis !== "undefined" && module.exports.onSettings) globalThis.onSettings = module.exports.onSettings;
if (typeof global !== "undefined" && module.exports.onSettings) global.onSettings = module.exports.onSettings;
if (typeof self !== "undefined" && module.exports.onSettings) self.onSettings = module.exports.onSettings;
