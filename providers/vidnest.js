// Imported provider: vidnest; upstream commit ed38d1aee0024f56479369c9423fefb278e0b62a
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
// Vidnest v2 client protocol observed in the public website build on 2026-10-24.
const VN_CRYPTO = require('crypto-js');
const VN_BASE = 'https://new.vidnest.fun';
// Public frontend protocol constant, not an account credential.
const VN_CLIENT = 'K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2';
const VN_SERVERS = ['yflix', 'flixhq', 'vidzee'];
function vnLog(message) { console.log('[Vidnest] ' + message); }
function vnWords(bytes) {
  const words=[]; for(let i=0;i<bytes.length;i++) words[i>>>2]=(words[i>>>2]||0)|(bytes[i]<<(24-(i%4)*8));
  return VN_CRYPTO.lib.WordArray.create(words,bytes.length);
}
function vnBytes(words) {
  const out=[];for(let i=0;i<words.sigBytes;i++)out.push((words.words[i>>>2]>>>(24-(i%4)*8))&255);return out;
}
function vnNonce() {
  const bytes=new Uint8Array(16);
  if(typeof globalThis.crypto!=='undefined'&&typeof globalThis.crypto.getRandomValues==='function')globalThis.crypto.getRandomValues(bytes);
  else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);
  return VN_CRYPTO.enc.Base64.stringify(vnWords(bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function vnMul(x,h) {
  const z=[0,0,0,0],v=h.slice();
  for(let i=0;i<128;i++) {
    if((x[i>>>5]>>>(31-i%32))&1)for(let j=0;j<4;j++)z[j]^=v[j];
    const bit=v[3]&1;
    for(let j=3;j>0;j--)v[j]=(v[j]>>>1)|((v[j-1]&1)<<31);
    v[0]=(v[0]>>>1)^(bit?0xe1000000:0);
  }
  return z;
}
function vnDecrypt(envelope) {
  if(!envelope || envelope.v!==2 || typeof envelope.d!=='string' || typeof envelope.n!=='string')throw Error('Unsupported API envelope; current v2 required');
  if(envelope.d.length>2800000 || envelope.n.length>1024 || !/^[A-Za-z0-9_-]+={0,2}$/.test(envelope.d))throw Error('Invalid encrypted envelope');
  const raw=vnBytes(VN_CRYPTO.enc.Base64.parse(envelope.d.replace(/-/g,'+').replace(/_/g,'/')));
  if(raw.length<28)throw Error('Truncated authenticated response');
  const iv=raw.slice(0,12),cipher=raw.slice(12,-16),tag=raw.slice(-16);
  const key=VN_CRYPTO.SHA256(envelope.n+'|'+VN_CLIENT);
  const aes=VN_CRYPTO.algo.AES.createEncryptor(key,{mode:VN_CRYPTO.mode.ECB,padding:VN_CRYPTO.pad.NoPadding});
  const block=words=>{const copy=words.slice();aes.encryptBlock(copy,0);return copy;};
  const h=block([0,0,0,0]);let hash=[0,0,0,0];
  for(let i=0;i<cipher.length;i+=16) {
    const words=vnWords(cipher.slice(i,i+16)).words;
    hash=vnMul(hash.map((x,j)=>x^(words[j]||0)),h);
  }
  const bits=cipher.length*8;
  hash=vnMul(hash.map((x,j)=>x^([0,0,Math.floor(bits/4294967296),bits>>>0][j])),h);
  const j0=vnWords(iv.concat([0,0,0,1])).words,mask=block(j0);
  const expected=vnBytes(VN_CRYPTO.lib.WordArray.create(hash.map((x,j)=>x^mask[j]),16));
  let diff=0;for(let i=0;i<16;i++)diff|=expected[i]^tag[i];
  if(diff)throw Error('API authentication tag mismatch; frontend protocol may have changed');
  const plain=[];const counter=j0.slice();
  for(let i=0;i<cipher.length;i+=16) {
    counter[3]=(counter[3]+1)|0;
    const stream=vnBytes(VN_CRYPTO.lib.WordArray.create(block(counter),16));
    for(let j=0;j<16&&i+j<cipher.length;j++)plain.push(cipher[i+j]^stream[j]);
  }
  return JSON.parse(VN_CRYPTO.enc.Utf8.stringify(vnWords(plain)));
}
function vnHeaders(raw) {
  const out={};if(raw&&typeof raw==='object')Object.keys(raw).forEach(k=>{
    if(typeof raw[k]==='string'&&!/[\r\n\0]/.test(k+raw[k])&&!/^(host|connection|content-length|accept-encoding|range)$/i.test(k))out[k]=raw[k];
  });return out;
}
function vnSafeUrl(value) {
  if(typeof value!=='string'||!/^(https?):\/\/[^\s]+$/i.test(value))return false;
  try {const u=new URL(value);return !u.username&&!u.password;}catch(_){return false;}
}
async function vnRequest(url,options,deadline,maxMs=4500) {
  const left=deadline-Date.now();if(left<=0)throw Error('Discovery deadline');
  const controller=typeof AbortController==='function'?new AbortController():null;let timer;
  try{return await Promise.race([
    fetch(url,Object.assign({},options,controller?{signal:controller.signal}:{})),
    new Promise((_,reject)=>{timer=setTimeout(()=>{if(controller)controller.abort();reject(Error('HTTP timeout'));},Math.min(left,maxMs));})
  ]);}finally{clearTimeout(timer);}
}
function vnParse(data,server) {
  if(!data||typeof data!=='object')return [];
  if(data.status&&data.status!=='success')return [];
  let rows=Array.isArray(data.streams)?data.streams:Array.isArray(data.sources)?data.sources:data.url?[data]:[];
  const subs=Array.isArray(data.subtitles)?data.subtitles:[];
  return rows.filter(x=>x&&vnSafeUrl(x.url)).slice(0,3).map(x=>{
    const headers=vnHeaders(Object.assign({},data.headers||{},x.headers||{}));
    if(!Object.keys(headers).some(k=>k.toLowerCase()==='referer'))headers.Referer='https://vidnest.fun/';
    const kind=server==='yflix'||/hls|mpegurl/i.test(x.type||'')||/\.m3u8(?:[?#]|$)/i.test(x.url)?'hls':/dash|mpd/i.test(x.type||'')||/\.mpd(?:[?#]|$)/i.test(x.url)?'dash':'direct';
    const quality=/^(2160|1440|1080|720|576|480|360|240)p$/i.test(String(x.quality||''))?x.quality:'Unknown';
    const captions=(Array.isArray(x.subtitles)?x.subtitles:subs).filter(s=>s&&vnSafeUrl(s.url||s.file)).map(s=>({url:s.url||s.file,lang:s.lang||s.language||'Unknown',label:s.label||s.lang||s.language||'Unknown'}));
    return {name:'Vidnest',title:'Vidnest '+server,serverName:server,url:x.url,headers,quality,type:kind,
      subtitles:captions,audioLanguage:typeof x.language==='string'?x.language:undefined,provider:'vidnest',mimeType:kind==='hls'?'application/x-mpegURL':kind==='dash'?'application/dash+xml':/\.mp4(?:[?#]|$)/i.test(x.url)?'video/mp4':undefined};
  });
}
async function vnVerify(row,deadline) {
  try {
    const isHls=row.type==='hls';
    const response=await vnRequest(row.url,{method:isHls?'GET':'HEAD',headers:row.headers},deadline,4000);
    const mime=String(response.headers&&response.headers.get?response.headers.get('content-type')||'':'').toLowerCase();
    vnLog('MEDIA server='+row.serverName+' status='+response.status+' mime='+(mime||'missing'));
    if(!response.ok)return null;
    if(isHls) {
      if(/html|json|xml/.test(mime)&&!/mpegurl/.test(mime))return null;
      const text=await response.text();
      if(!/^\s*#EXTM3U/m.test(text)||!/#EXT(?:INF|-X-STREAM-INF)/.test(text))return null;
      row.quality=/#EXT-X-STREAM-INF/.test(text)?'Auto':row.quality;
      // Preserve the exact master/query and all audio/quality choices. No segment fetches.
    }else if(!/^video\//.test(mime)&&!/^application\/(octet-stream|dash\+xml|x-matroska)/.test(mime))return null;
    return row;
  }catch(_){vnLog('MEDIA server='+row.serverName+' unavailable or timed out');return null;}
}
async function getStreams(tmdbId,mediaType,season,episode) {
  const id=String(tmdbId||''),type=mediaType==='series'?'tv':mediaType;
  if(!/^[1-9]\d*$/.test(id)||!['movie','tv'].includes(type))return [];
  if(type==='tv'&&(season==null||season===''||episode==null||episode===''||!Number.isInteger(Number(season))||Number(season)<0||!Number.isInteger(Number(episode))||Number(episode)<1))return [];
  const route='/'+type+'/'+id+(type==='tv'?'/'+Number(season)+'/'+Number(episode):'');
  const deadline=Date.now()+16000;
  vnLog('v2 API: exact TMDB '+id+' '+type+(type==='tv'?' S'+season+'E'+episode:'')+'; local authenticated decrypt');
  const batches=await Promise.all(VN_SERVERS.map(async server=>{
    try{
      // Cache-busting query only; the response's n determines the authenticated key.
      const nonce=vnNonce();
      const response=await vnRequest(VN_BASE+'/'+server+route+'?_n='+encodeURIComponent(nonce),{headers:{'User-Agent':'Mozilla/5.0',Origin:'https://vidnest.fun',Referer:'https://vidnest.fun/'}},deadline,10000);
      vnLog('API server='+server+' HTTP '+response.status);
      if(!response.ok)return [];
      const envelope=await response.json();const data=vnDecrypt(envelope);
      const rows=vnParse(data,server);
      vnLog('DECRYPT server='+server+' authenticated; candidates='+rows.length);
      const valid=await Promise.all(rows.map(row=>vnVerify(row,deadline)));return valid.filter(Boolean);
    }catch(error){vnLog('API server='+server+' failed: '+String(error.message||'unknown').slice(0,130));return [];}
  }));
  const seen=new Set(),result=[];
  batches.forEach(rows=>rows.forEach(row=>{if(!seen.has(row.url)){seen.add(row.url);result.push(row);}}));
  vnLog('RESULT: '+result.length+' HTTP-checked sources; Android playback unverified');
  return result;
}
module.exports={getStreams};

/* CLOUDBANK_UPSTREAM_SOURCE_END */
  })(originalModule, originalModule.exports, portableRequire, cloudbankMetadataFetch(fetch), typeof globalThis !== "undefined" ? globalThis : global);
  if (typeof originalModule.exports.getStreams !== "function") throw new Error("Upstream getStreams missing");
  module.exports = cloudbankWrapProvider(originalModule.exports, "vidnest", ["movie", "tv"]);
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
module.exports = cloudbankDisplayInstall(module.exports, "Vidnest", "vidnest");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
