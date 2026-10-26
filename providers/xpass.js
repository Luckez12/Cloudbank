// Imported provider: xpass; upstream commit 3f09a6ff4360498895e622877af7a32212f75038
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

(function() {
  var originalModule = { exports: {} };
  var originalRequire = typeof require === "function" ? require : null;
  function portableRequire(name) {
    if (name !== "crypto-js" && name !== "cheerio-without-node-native") throw new Error("Unsupported embedded module: " + name);
    if (!originalRequire) throw new Error("Runtime module unavailable: " + name);
    return originalRequire(name);
  }
  (function(module, exports, require, fetch, self) {
/* CLOUDBANK_UPSTREAM_SOURCE_START */
/* XPass v2.0.1: current website data-token -> authenticated index -> playlist. */
var XP_HOME='https://play.xpass.top';
var XP_UA='Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var XP_C=require('crypto-js');
function xpHex(bytes){return bytes.map(function(b){return ('0'+b.toString(16)).slice(-2);}).join('');}
function xpBytes(hex){return (hex.match(/../g)||[]).map(function(x){return parseInt(x,16);});}
function xpDecode64(text){return xpBytes(XP_C.enc.Base64.parse(text.replace(/-/g,'+').replace(/_/g,'/')).toString(XP_C.enc.Hex));}
function xpBlock(bytes,key){return xpBytes(XP_C.AES.encrypt(XP_C.enc.Hex.parse(xpHex(bytes)),key,{iv:XP_C.enc.Hex.parse('00000000000000000000000000000000'),mode:XP_C.mode.CBC,padding:XP_C.pad.Pkcs7}).ciphertext.toString(XP_C.enc.Hex).slice(0,32));}
function xpXor(a,b){return a.map(function(x,i){return x^b[i];});}
function xpMultiply(a,b){var z=Array(16).fill(0),v=b.slice();for(var i=0;i<128;i++){if(a[i>>3]&(128>>(i&7)))z=xpXor(z,v);var low=v[15]&1,carry=0;for(var j=0;j<16;j++){var n=v[j];v[j]=(n>>>1)|carry;carry=(n&1)<<7;}if(low)v[0]^=225;}return z;}
function xpDecrypt(text,path,token,build){
 if(!/^spv3-build-[A-Za-z0-9-]+$/.test(build)||!token||text.length>2000000)throw Error('invalid encrypted index');
 var bytes=xpDecode64(text.trim());if(bytes.length<28)throw Error('invalid encrypted index');
 var key=XP_C.SHA256('spv3-data-response|'+build+'|'+path+'|'+token),h=xpBlock(Array(16).fill(0),key);
 var iv=bytes.slice(0,12),cipher=bytes.slice(12,-16),tag=bytes.slice(-16),s=Array(16).fill(0);
 for(var p=0;p<cipher.length;p+=16){var block=cipher.slice(p,p+16);while(block.length<16)block.push(0);s=xpMultiply(xpXor(s,block),h);}
 var len=Array(16).fill(0),bits=cipher.length*8;for(var i=15;i>=12;i--){len[i]=bits&255;bits=Math.floor(bits/256);}s=xpMultiply(xpXor(s,len),h);
 var initial=iv.concat([0,0,0,1]),expected=xpXor(xpBlock(initial,key),s),bad=0;
 for(i=0;i<16;i++)bad|=expected[i]^tag[i];if(bad)throw Error('index authentication failed');
 var out=[],counter=initial.slice();for(p=0;p<cipher.length;p+=16){for(i=15;i>=12;i--){counter[i]=(counter[i]+1)&255;if(counter[i])break;}var mask=xpBlock(counter,key);for(i=0;i<16&&p+i<cipher.length;i++)out.push(cipher[p+i]^mask[i]);}
 return JSON.parse(XP_C.enc.Hex.parse(xpHex(out)).toString(XP_C.enc.Utf8));
}
function xpVariable(html,name){var m=new RegExp('\\bvar\\s+'+name+'\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')').exec(html);if(!m)return null;return m[1][0]==='"'?JSON.parse(m[1]):m[1].slice(1,-1);}
function xpUrl(raw,base){if(typeof raw!=='string'||!raw.trim())return null;try{var u=new URL(raw,base||XP_HOME);return /^https?:$/.test(u.protocol)&&!/^https?:\/\/[^/]*@/i.test(u.href)?u:null;}catch(_){return null;}}
function xpStrings(script){var list=[],re=/'([A-Za-z0-9+/=]{12,})'/g,m;while((m=re.exec(script))){try{var v=m[1].replace(/[a-zA-Z]/g,function(c){return c===c.toLowerCase()?c.toUpperCase():c.toLowerCase();});list.push(XP_C.enc.Base64.parse(v).toString(XP_C.enc.Utf8));}catch(_){}}return list;}
function xpHeaders(raw,page){var out={Referer:page,'User-Agent':XP_UA};if(raw&&typeof raw==='object')Object.keys(raw).forEach(function(k){if(typeof raw[k]!=='string'||/[\r\n\0]/.test(k+raw[k])||/^(host|connection|range|content-length|accept-encoding|x-vueo-http-transport)$/i.test(k))return;Object.keys(out).forEach(function(old){if(old.toLowerCase()===k.toLowerCase())delete out[old];});out[k]=raw[k];});return out;}
function xpTracks(rows,page){var out=[],seen={};(Array.isArray(rows)?rows:[]).forEach(function(r){if(!r||/thumbnail|chapter/i.test(r.kind||''))return;var u=xpUrl(r.file||r.url||r.src,page);if(!u||seen[u.href])return;seen[u.href]=true;out.push({url:u.href,language:r.srclang||r.language||r.lang||r.label||'und',name:r.label||r.name||r.language||'Subtitle',headers:xpHeaders(r.headers,u.origin===XP_HOME?page:XP_HOME+'/')});});return out;}
function xpMap(body,server,page){
 var playlist=body&&body.playlist||body;if(!Array.isArray(playlist))return [];
 var out=[];playlist.forEach(function(item){if(!item||!Array.isArray(item.sources))return;
 item.sources.forEach(function(src){if(!src||typeof src!=='object')return;var u=xpUrl(src.file||src.url,page);if(!u)return;
 var mime=String(src.type||src.mimeType||'').toLowerCase(),hls=/mpegurl|hls/.test(mime)||/\.m3u8(?:[?#]|$)/i.test(u.href),dash=/dash/.test(mime)||/\.mpd(?:[?#]|$)/i.test(u.href);
 if(u.href.indexOf('cf-master')>=0&&u.searchParams.get('kx'))return;
 var direct=/mp4|matroska|mkv/.test(mime)||/\.(mp4|mkv)(?:[?#]|$)/i.test(u.href);if(!hls&&!dash&&!direct)return;
 var audio=String(src.audioLanguage||item.audioLanguage||'').toLowerCase(),original=String(item.original_language||'').toLowerCase();
 if(src.isDubbed===true||item.isDubbed===true||(original&&audio&&audio!==original))return;
 var q=/\b(2160|1440|1080|720|576|480|360|240)p?\b/i.exec(String(src.label||src.quality||''));if(!hls&&!dash&&q&&+q[1]<720)return;
 var trackRows=[].concat(Array.isArray(item.tracks)?item.tracks:[],Array.isArray(item.subtitles)?item.subtitles:[],Array.isArray(src.tracks)?src.tracks:[]);
 var mediaHeaders=xpHeaders(src.headers||item.headers,u.origin===XP_HOME?page:XP_HOME+'/');if(u.hostname==='cdn.hakunaymatata.com')Object.keys(mediaHeaders).forEach(function(k){if(k.toLowerCase()==='referer')delete mediaHeaders[k];});
 out.push({name:'XPass',title:'XPass - '+server,url:u.href,quality:hls||dash?'Auto':q?q[1]+'p':'Auto',type:hls?'hls':dash?'dash':'direct',format:hls?'hls':dash?'dash':'mp4',mimeType:hls?'application/x-mpegURL':dash?'application/dash+xml':/mkv|matroska/.test(mime+u.pathname)?'video/x-matroska':'video/mp4',server:server,serverName:server,headers:mediaHeaders,subtitles:xpTracks(trackRows,page),audioLanguage:audio||undefined,provider:'xpass'});
 });});return out;
}
async function getStreams(id,type,season,episode){
 id=String(id||'');type=type==='series'?'tv':type;
 if(!/^(?:[1-9]\d*|tt\d+)$/.test(id)||!['movie','tv'].includes(type))return [];
 if(type==='tv'&&(!Number.isInteger(Number(season))||season==null||season===''||Number(season)<0||!Number.isInteger(Number(episode))||episode==null||episode===''||Number(episode)<1))return [];
 var page=XP_HOME+'/e/'+type+'/'+id+(type==='tv'?'/'+Number(season)+'/'+Number(episode):''),start=Date.now(),deadline=start+17500,calls=0;
 function log(s){console.log('[XPass] '+s);}
 var pending=[],stopped=false;
 function stop(){stopped=true;pending.slice().forEach(function(cancel){cancel();});}
 async function request(url,options){options=options||{};if(stopped)throw Error('stopped');calls++;var left=Math.min(4000,deadline-Date.now());if(left<=0)throw Error('deadline');return new Promise(function(resolve,reject){var done=false,c=typeof AbortController==='function'?new AbortController():null,timer;function finish(err,value){if(done)return;done=true;clearTimeout(timer);pending=pending.filter(function(f){return f!==cancel;});if(err||options.binary){if(c)c.abort();}if(err)reject(err);else resolve(value);}function cancel(){finish(Error('cancelled'));}pending.push(cancel);timer=setTimeout(function(){finish(Error('deadline'));},left);Promise.resolve().then(function(){if(done)throw Error('stopped');return fetch(url,{method:options.method||'GET',headers:options.headers||xpHeaders(null,xpUrl(url).origin===XP_HOME?page:XP_HOME+'/'),signal:c?c.signal:undefined});}).then(async function(r){if(!r.ok)throw Error('HTTP '+r.status);var body=options.binary?'':await r.text();finish(null,{ok:r.ok,status:r.status,url:r.url||url,headers:r.headers,text:function(){return Promise.resolve(body);},json:function(){return Promise.resolve().then(function(){return JSON.parse(body);});}});}).catch(function(e){finish(e);});});}
 async function available(row){try{
 var options={headers:row.headers},r,body,base=row.url;
 if(row.type==='hls'){
 for(var depth=0;depth<3;depth++){
 r=await request(base,options);body=(await r.text()).replace(/^\uFEFF/,'').trim();if(!/^#EXTM3U(?:\s|$)/.test(body))throw Error('invalid HLS');
 var lines=body.split(/\r?\n/).map(function(x){return x.trim();}),next='';
 if(/#EXT-X-STREAM-INF:/.test(body)){for(var i=0;i<lines.length;i++)if(/^#EXT-X-STREAM-INF:/.test(lines[i])){for(var j=i+1;j<lines.length;j++){if(lines[j]&&lines[j][0]!=='#'){next=lines[j];break;}}break;}var variant=xpUrl(next,r.url);if(!variant)throw Error('empty master');base=variant.href;continue;}
 var segment='';for(i=0;i<lines.length;i++)if(/^#EXTINF:/.test(lines[i])){for(j=i+1;j<lines.length;j++){if(lines[j]&&lines[j][0]!=='#'){segment=lines[j];break;}}break;}
 var media=xpUrl(segment,r.url);if(!media)throw Error('empty media playlist');
 var headers=Object.assign({},row.headers,{Range:'bytes=0-1023'}),probe=await request(media.href,{headers:headers,binary:true});
 var ct=probe.headers&&probe.headers.get?String(probe.headers.get('content-type')||''):'';if(/html|json|javascript/i.test(ct))throw Error('non-media response');
 log('MEDIA: available server='+row.serverName);return true;
 }throw Error('playlist depth');
 }
 if(row.type==='dash'){r=await request(row.url,options);body=await r.text();if(!/<MPD(?:\s|>)/i.test(body))throw Error('invalid DASH');return true;}
 r=await request(row.url,{headers:row.headers,method:'HEAD',binary:true});var mime=r.headers&&r.headers.get?String(r.headers.get('content-type')||''):'';return /^video\//i.test(mime)||/octet-stream|matroska/i.test(mime);
 }catch(e){if(!stopped)log('MEDIA: rejected server='+row.serverName+' reason='+String(e.message||e));return false;}}

 try{
 log('ROUTE: v2.0.1 exact '+type+' '+id+'; website signed data index; parallel servers=3; media availability check');
 var html=await(await request(page)).text(),relative=xpVariable(html,'dataUrl'),dataUrl=xpUrl(relative,page);
 if(!dataUrl||dataUrl.origin!==XP_HOME||dataUrl.pathname!=='/data/'+type+'/'+id+(type==='tv'?'/'+Number(season)+'/'+Number(episode):''))throw Error('unexpected data route');
 var token=dataUrl.searchParams.get('token');if(!token)throw Error('missing data token');
 var scriptMatch=/<script\b[^>]*src=["']([^"']*\/static\/mainmini\.js[^"']*)["']/i.exec(html);if(!scriptMatch)throw Error('website loader missing');
 var loader=xpUrl(scriptMatch[1],page);if(!loader||loader.origin!==XP_HOME)throw Error('unexpected loader');
 var readySubs=[];var subUrl=xpUrl(xpVariable(html,'suburl'),page);
 if(subUrl&&xpVariable(html,'suburl'))request(subUrl.href).then(function(r){return r.json();}).then(function(list){readySubs=xpTracks(Array.isArray(list)?list:list.subtitles||list.tracks||[],page);}).catch(function(){});
 var values=await Promise.all([request(dataUrl.href).then(function(r){return r.text();}),request(loader.href).then(function(r){return r.text();})]);
 var playerPath=xpStrings(values[1]).find(function(s){return /^\/static\/[A-Za-z0-9]+\.js\?t=\d+$/.test(s);});if(!playerPath)throw Error('website player script missing');
 var script=await(await request(XP_HOME+playerPath)).text(),build=xpStrings(script).find(function(s){return /^spv3-build-[A-Za-z0-9-]+$/.test(s);});if(!build)throw Error('website crypto version missing');
 var servers=xpDecrypt(values[0],dataUrl.pathname,token,build);if(!Array.isArray(servers))throw Error('invalid server index');
 log('INDEX: authenticated=true servers='+servers.length+'; current website crypto version');
 var rows=await new Promise(function(resolve){var next=0,active=0,done=false;function pump(){if(done)return;while(active<3&&next<servers.length&&Date.now()<deadline){var server=servers[next++],u=server&&xpUrl(server.url,page);if(!u||u.origin!==XP_HOME)continue;active++;(function(s,url){request(url).then(function(r){return r.json();}).then(async function(body){if(done)return;var result=xpMap(body,String(s.name||'Server'),page);for(var i=0;i<result.length&&!done;i++){if(await available(result[i])){if(done)return;done=true;resolve([result[i]]);return;}}}).catch(function(){if(!done)log('SERVER: unavailable');}).then(function(){active--;if(!done)pump();});})(server,u.href);}if(!done&&active===0){done=true;resolve([]);}}pump();});
 rows.forEach(function(row){row.subtitles=xpTracks(row.subtitles.concat(readySubs),page);});
 log('RESULT: sources='+rows.length+' calls='+calls+' elapsedMs='+(Date.now()-start)+'; playback unverified');return rows;
 }catch(e){log('NO_RESULT: '+(/^(HTTP \d+|deadline|unexpected data route|missing data token|website loader missing|unexpected loader|website player script missing|website crypto version missing|invalid server index|index authentication failed|invalid encrypted index)$/.test(e.message)?e.message:'transport or response error')+' calls='+calls+' elapsedMs='+(Date.now()-start));return [];}finally{stop();}
}
module.exports={getStreams:getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "xpass", ["movie", "tv"]);
  if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
  if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
  if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
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
module.exports = cloudbankDisplayInstall(module.exports, "XPass", "xpass");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
