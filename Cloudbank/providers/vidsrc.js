// Cloudbank VidSrc v3.0.0: current HTTP API and dynamic website decoder data.
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
    if (type === "tv" && (season === null || season === "" || typeof season === "undefined" ||
        episode === null || episode === "" || typeof episode === "undefined" ||
        !Number.isInteger(Number(season)) || Number(season) < 0 ||
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
// VidSrc v3.0.0: website-issued HTTP tokens and rotating WASM data, no WebView.
var BASE = 'https://vidsrc.sh';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var keyCache = null;
function cachedKey(tag, value) {
  if (!/^\d{1,16}$/.test(tag) || typeof globalThis.vueoMetadataCache !== 'function') return null;
  try {
    var raw=globalThis.vueoMetadataCache(JSON.stringify({op:value?'put':'get',key:'vidsrc:public-decoder:'+tag,value:value?Array.from(value):undefined,ttlMs:240000}));
    var result=typeof raw==='string'?JSON.parse(raw):raw;
    if(!value&&Array.isArray(result)&&result.length===32&&result.every(function(n){return Number.isInteger(n)&&n>=0&&n<=255;}))return new Uint8Array(result);
  }catch(_){}
  return null;
}
function log(s) { console.log('[VidSrc] ' + s); }
function b64(s) { var text = atob(s), out = new Uint8Array(text.length); for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i); return out; }
function chacha(enc, key) {
  if (enc.length < 13 || enc.length > 131072) throw Error('invalid cipher size');
  function word(a, i) { return (a[i] | a[i+1]<<8 | a[i+2]<<16 | a[i+3]<<24) >>> 0; }
  function rot(x, n) { return (x << n) | (x >>> (32-n)); }
  var state = new Uint32Array(16), out = new Uint8Array(enc.length-12);
  state.set([1634760805,857760878,2036477234,1797285236]);
  for (var i = 0; i < 8; i++) state[i+4] = word(key,i*4);
  state[13] = word(enc,0); state[14] = word(enc,4); state[15] = word(enc,8);
  function quarter(x,a,b,c,d) {
    x[a]=(x[a]+x[b])>>>0; x[d]=rot(x[d]^x[a],16);
    x[c]=(x[c]+x[d])>>>0; x[b]=rot(x[b]^x[c],12);
    x[a]=(x[a]+x[b])>>>0; x[d]=rot(x[d]^x[a],8);
    x[c]=(x[c]+x[d])>>>0; x[b]=rot(x[b]^x[c],7);
  }
  for (var pos=0; pos<out.length; pos+=64) {
    var x=new Uint32Array(state);
    for (var round=0;round<10;round++) {
      quarter(x,0,4,8,12);quarter(x,1,5,9,13);quarter(x,2,6,10,14);quarter(x,3,7,11,15);
      quarter(x,0,5,10,15);quarter(x,1,6,11,12);quarter(x,2,7,8,13);quarter(x,3,4,9,14);
    }
    for(var j=0;j<64&&pos+j<out.length;j++) out[pos+j]=enc[12+pos+j]^(((x[j>>>2]+state[j>>>2])>>>0)>>>((j&3)*8));
    state[12]++;
  }
  var text='';for(var k=0;k<out.length;k++)text+=String.fromCharCode(out[k]);return text;
}
function wasmKeys(bytes) {
  // Read public module data, never execute downloaded code. The current
  // decryptor combines its two 32-byte data segments with XOR as its key.
  if (bytes.length>262144 || bytes.length<8 || bytes[0]!==0 || bytes[1]!==97 || bytes[2]!==115 || bytes[3]!==109 || bytes[4]!==1) throw Error('unsupported WASM');
  var p=8, data=[];
  function leb(signed) {
    var n=0,shift=0,v;
    do {if(p>=bytes.length||shift>28)throw Error('invalid WASM integer');v=bytes[p++];n|=(v&127)<<shift;shift+=7;}while(v&128);
    if(signed&&shift<32&&(v&64))n|=(-1)<<shift;
    return n>>>0;
  }
  while(p<bytes.length) {
    var id=bytes[p++],size=leb(false),end=p+size;
    if(end>bytes.length)throw Error('invalid WASM section');
    if(id===11) {
      var count=leb(false);if(count>64)throw Error('too many data segments');
      for(var i=0;i<count;i++) {
        var flag=leb(false);if(flag===2)leb(false);
        if(flag===0||flag===2){if(bytes[p++]!==65)throw Error('unsupported data offset');leb(true);if(bytes[p++]!==11)throw Error('invalid data offset');}
        else if(flag!==1)throw Error('unsupported data segment');
        var len=leb(false);if(p+len>end)throw Error('invalid data length');
        if(len===32)data.push(bytes.slice(p,p+len));p+=len;
      }
    }
    p=end;
  }
  if(data.length!==2)throw Error('website decryptor layout changed');
  var key=new Uint8Array(32);for(var j=0;j<32;j++)key[j]=data[0][j]^data[1][j];return key;
}
function httpUrl(value, base) {
  var u=new URL(value,base);if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid website URL');return u;
}
function config(html, name) {
  var re=new RegExp('window\\.'+name+'\\s*=\\s*(\\{[^\\n]*?\\});\\s*</script>');var m=re.exec(html);
  if(!m||m[1].length>32768)throw Error('website '+name+' missing');return JSON.parse(m[1]);
}
function routes(text) {
  var seen=Object.create(null), out=[];
  String(text).split('\n').filter(Boolean).forEach(function(s) {
    var u=httpUrl(s);if(seen[u.href]||!/\.m3u8$/i.test(u.pathname))return;
    seen[u.href]=true;out.push(u.href);
  });
  if(!out.length||out.length>16)throw Error('decoded HLS list invalid');return out;
}
async function getStreams(tmdbId, mediaType, season, episode) {
  var id=String(tmdbId||''),type=mediaType==='series'?'tv':mediaType;
  if(!/^[1-9]\d*$/.test(id)||['movie','tv'].indexOf(type)<0)return [];
  if(type==='tv'&&(season==null||season===''||episode==null||episode===''||!Number.isInteger(Number(season))||Number(season)<0||!Number.isInteger(Number(episode))||Number(episode)<1))return [];
  var start=Date.now(),deadline=start+18300,calls=0;
  var timers=[],controllers=[];
  async function request(url, referer, json, binary) {
    var remaining=deadline-Date.now();if(remaining<100)throw Error('request budget exhausted');calls++;
    var h={'User-Agent':UA,Referer:referer,Accept:json?'application/json':'*/*','Cache-Control':'no-store',Pragma:'no-cache'};
    var ctrl=typeof AbortController==='function'?new AbortController():null;if(ctrl)controllers.push(ctrl);
    var timer;
    var timeout=new Promise(function(_,reject){timer=setTimeout(function(){if(ctrl)ctrl.abort();reject(Error('HTTP timeout'));},Math.min(6500,remaining));timers.push(timer);});
    var task=Promise.resolve().then(async function(){
      if(binary) {
        // Generic opt-in binary transport. No provider/domain logic in VUEO.
        if(typeof globalThis.__vueoNativeFetch==='function') {
          var r=JSON.parse(await globalThis.__vueoNativeFetch(JSON.stringify({url:url,method:'GET',headers:h,redirect:'manual',responseEncoding:'base64'})));
          if(r.status!==200)throw Error('WASM HTTP '+r.status);
          if(r.bodyEncoding!=='base64'||r.bodyTruncated)throw Error('binary bridge update required');return b64(r.body);
        }
        var r=await fetch(url,{headers:h,redirect:'manual',signal:ctrl?ctrl.signal:undefined});
        if(!r.ok)throw Error('WASM HTTP '+r.status);
        if(typeof r.arrayBuffer!=='function')throw Error('binary bridge update required');return new Uint8Array(await r.arrayBuffer());
      }
      var r=await fetch(url,{headers:h,redirect:'manual',signal:ctrl?ctrl.signal:undefined});
      if(!r.ok)throw Error('HTTP '+r.status);
      return json?await r.json():await r.text();
    });
    try{return await Promise.race([task,timeout]);}finally{clearTimeout(timer);}
  }
  log('ROUTE: v3.0.0 HTTP only; exact TMDB='+id+' '+type+(type==='tv'?' S'+Number(season)+'E'+Number(episode):'')+'; original master HLS; no WebView');
  try {
    var embed=BASE+'/embed/'+type+'/'+id+(type==='tv'?'/'+Number(season)+'/'+Number(episode):'');
    // This first API route comes from the current website's data-api attribute.
    // TV embeds retain the exact season and episode in this URL.
    var gateUrl=BASE+'/vs_src.php?type='+type+'&id='+id+(type==='tv'?'&season='+Number(season)+'&episode='+Number(episode):'');
    var gate=await request(gateUrl,embed,true,false);
    var inner=httpUrl(gate.src,BASE);
    if(!/\/embed\//.test(inner.pathname))throw Error('unexpected player route');
    var innerHtml=await request(inner.href,BASE+'/',false,false), cfg=config(innerHtml,'CFG');
    var player=httpUrl(cfg.playerUrl,inner.href);
    var playerPath='/embed/player/'+type+'/'+id+(type==='tv'?'/'+Number(season)+'/'+Number(episode):'');
    if(player.origin!==inner.origin||player.pathname!==playerPath)throw Error('player identity mismatch');
    var playerHtml=await request(player.href,inner.href,false,false), pc=config(playerHtml,'CONFIG');
    if(pc.mediaType!==type||String(pc.mediaId)!==id||pc.idType!=='tmdb')throw Error('configuration identity mismatch');
    if(type==='tv'&&(Number(pc.season)!==Number(season)||Number(pc.episode)!==Number(episode)))throw Error('episode identity mismatch');
    var api=httpUrl(pc.api||(type==='tv'&&pc.streamBase?pc.streamBase+'&season='+Number(season)+'&episode='+Number(episode)+'&stream_urls':''),player.href);
    if(api.hostname!=='data.vidsrc.sh'||api.pathname!=='/api.php'||api.searchParams.get('type')!==type||api.searchParams.get('tmdb')!==id)throw Error('API identity mismatch');
    if(type==='tv'&&(api.searchParams.get('season')!==String(Number(season))||api.searchParams.get('episode')!==String(Number(episode))))throw Error('API episode mismatch');
    if(!pc.apiToken)throw Error('website API token missing');api.searchParams.set('api_token',pc.apiToken);
    var payload=await request(api.href,player.href,true,false);
    if(!payload.data||!payload.data.stream_urls)throw Error('API returned no stream data');
    var raw=payload.data.stream_urls, urls;
    if(Array.isArray(raw))urls=routes(raw.join('\n'));
    else {
      var vs=payload.vs||{}, tag=String(vs.w||''),key;
      if(keyCache&&keyCache.tag===tag&&keyCache.until>Date.now())key=keyCache.key;
      else if((key=cachedKey(tag,null)))keyCache={tag:tag,key:key,until:Date.now()+240000};
      else {
        var bytes;
        if(vs.wasm)bytes=b64(vs.wasm);
        else {
          var wasm=httpUrl(vs.wasm_url);
          if(wasm.hostname!==api.hostname||!/\.wasm$/i.test(wasm.pathname))throw Error('unexpected decoder origin');
          bytes=await request(wasm.href,player.origin+'/',false,true);
        }
        key=wasmKeys(bytes);keyCache={tag:tag,key:key,until:Date.now()+240000};cachedKey(tag,key);
      }
      urls=routes(chacha(b64(raw),key));
    }
    var rawMeta=globalThis.VUEO_DISCOVERY_CONTEXT;
    if(typeof rawMeta==='string'){try{rawMeta=JSON.parse(rawMeta);}catch(_){rawMeta=null;}}
    var meta=rawMeta&&(rawMeta.tmdb||rawMeta), title=meta&&String(rawMeta.tmdbId||meta.id)===id?(meta.title||meta.name):'';
    log('API: website-issued token accepted; exact route verified; HLS='+urls.length+'; audio=unknown accepted');
    log('RESULT: '+Math.min(urls.length,3)+' API HLS sources; calls='+calls+' elapsedMs='+(Date.now()-start)+'; no manifest/child/segment/subtitle checks; playback unverified');
    return urls.slice(0,3).map(function(url,i){return {name:'VidSrc',title:title||payload.data.title||'VidSrc',serverName:'Website '+(i+1),url:url,
      headers:{'User-Agent':UA,Referer:player.origin+'/',Origin:player.origin},type:'hls',mimeType:'application/x-mpegURL',isAdaptive:true,quality:'Auto',provider:'vidsrc'};});
  } catch(e) {
    var message=String(e&&e.message||'discovery failed');
    var allowed=/^(HTTP \d+|WASM HTTP \d+|HTTP timeout|request budget exhausted|binary bridge update required|website decryptor layout changed|API returned no stream data|decoded HLS list invalid|.*identity mismatch|unexpected player route|unexpected decoder origin|website (?:CFG|CONFIG) missing|website API token missing|unsupported WASM)$/;
    log('NO_RESULT: '+(allowed.test(message)?message:'website protocol or decoding failure')+'; calls='+calls+' elapsedMs='+(Date.now()-start));return [];
  } finally {timers.forEach(clearTimeout);controllers.forEach(function(c){try{c.abort();}catch(_){}});}
}
module.exports={getStreams:getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidsrc", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "VidSrc", "vidsrc");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
