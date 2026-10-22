/* VidRock 2.0.0 — rebuilt website API, authenticated URLs and segment-checked HLS. */
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
  var BASE = 'https://vidrock.net';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  var localKey = null;
  var languages = {en:'english',ja:'japanese',ko:'korean',zh:'chinese,mandarin,cantonese',hi:'hindi',ta:'tamil',te:'telugu',ms:'malay',id:'indonesian',fr:'french',de:'german',es:'spanish',pt:'portuguese',ru:'russian',it:'italian',ar:'arabic',th:'thai',vi:'vietnamese',ml:'malayalam',bn:'bengali',tr:'turkish'};
  function log(s) { console.log('[VidRock] ' + s); }
  function clean(s) { return String(s || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g,' ').trim(); }
  function https(url, base) { try { if(typeof url!=='string'||!url.trim())return ''; var u = new URL(url, base || BASE); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } }
  function lang(s) {
    s=clean(s).toLowerCase().replace(/[_-](?:us|gb|br|cn|tw)$/,'');
    if(languages[s]) return s;
    var aliases={eng:'en',jpn:'ja',kor:'ko',zho:'zh',chi:'zh',hin:'hi',tam:'ta',tel:'te',msa:'ms',may:'ms',ind:'id',fra:'fr',fre:'fr',deu:'de',ger:'de',spa:'es',por:'pt',rus:'ru',ita:'it',ara:'ar'};
    if(aliases[s])return aliases[s];
    return Object.keys(languages).find(function(k){return languages[k].split(',').indexOf(s)>=0;}) || '';
  }
  function audio(label, original) {
    var text=clean(label).toLowerCase(), codes=[];
    Object.keys(languages).forEach(function(k){if(languages[k].split(',').some(function(n){return new RegExp('(?:^|[^a-z])'+n+'(?:$|[^a-z])').test(text);}))codes.push(k);});
    var code=lang(text);if(code&&codes.indexOf(code)<0)codes.push(code);
    var multi=/\b(?:dual|multi|multilingual)\b/.test(text), explicitOriginal=/^(?:original|original audio)$/.test(text);
    var allowed=explicitOriginal || !original || !codes.length || codes.indexOf(original)>=0 || multi&&codes.length<2;
    return {allowed:allowed,languages:codes,status:explicitOriginal?'original':!codes.length||!original?'unknown':codes.indexOf(original)>=0?(multi||codes.length>1?'dual':'original'):'unknown',label:multi?'Multi Audio (API label)':codes.length?codes.map(function(k){return languages[k].split(',')[0];}).join(' + ')+' (API label)':'Audio unverified'};
  }
  function quality(w,h) { return w>=3840||h>=2160?2160:w>=2560||h>=1440?1440:w>=1920||h>=1080?1080:w>=1280||h>=720?720:0; }
  function cache(op,value) {
    try { if(typeof globalThis.vueoMetadataCache==='function'){
      var raw=globalThis.vueoMetadataCache(JSON.stringify({op:op,key:'vidrock:v2:public-key:'+BASE,value:value,ttlMs:300000}));
      return typeof raw==='string'?JSON.parse(raw):raw;
    }} catch (_) {} return null;
  }
  function headers() { return {'User-Agent':UA,Referer:BASE+'/',Origin:BASE}; }
  async function get(state,url,binary) {
    if(state.finished||Date.now()>state.deadline||state.calls>=24)throw Error('request budget');
    state.calls++;
    var h=headers();if(binary){h.Range='bytes=0-8191';h['Accept-Encoding']='identity';}
    var requestTimer,controller=typeof AbortController==='function'?new AbortController():null;
    try{return await Promise.race([(async function(){
      var response=await fetch(url,{headers:h,signal:controller?controller.signal:undefined});
      if(state.finished)throw Error('finished');
      if(!response.ok)throw Error('HTTP '+response.status);
      var result={binaryCapable:typeof response.arrayBuffer==='function',status:response.status,url:https(response.url||url),ct:String(response.headers&&response.headers.get('content-type')||'').toLowerCase()};
      if(!result.url)throw Error('non-HTTPS redirect');
      if(binary&&typeof response.arrayBuffer==='function'){
        if(response.body&&typeof response.body.getReader==='function'){
          var reader=response.body.getReader(),chunks=[],length=0;
          try{while(length<8192){var part=await reader.read();if(part.done)break;var chunk=part.value.subarray(0,8192-length);chunks.push(chunk);length+=chunk.length;}}
          finally{reader.cancel().catch(function(){});}
          var bytes=new Uint8Array(length),offset=0;chunks.forEach(function(chunk){bytes.set(chunk,offset);offset+=chunk.length;});result.bytes=bytes;
        }else result.bytes=new Uint8Array(await response.arrayBuffer()).subarray(0,8192);
      }else result.text=await response.text();
      if(result.text&&result.text.length>(binary?16*1024*1024:2*1024*1024))throw Error('response too large');
      if(state.finished)throw Error('finished');return result;
    })(),new Promise(function(_,reject){requestTimer=setTimeout(function(){if(controller)controller.abort();reject(Error('HTTP timeout'));},Math.min(new URL(url).origin===BASE?10000:binary?5500:7000,Math.max(1,state.deadline-Date.now())));})]);}
    finally{if(requestTimer)clearTimeout(requestTimer);}
  }

  async function key(state,force) {
    var c=!force&&(localKey||cache('get'));
    if(c&&c.origin===BASE&&/^[0-9a-f]{64}$/i.test(c.hex)&&Date.now()-c.at>=0&&Date.now()-c.at<300000)return {hex:c.hex,cached:true};
    var home=await get(state,BASE+'/',false),scripts=[],m;
    var re=/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    while((m=re.exec(home.text||''))){var u=https(m[1],BASE);if(u&&new URL(u).origin===BASE&&/\/assets\/[^?#]+\.js(?:\?|$)/.test(u))scripts.push(u);}
    if(!scripts.length)throw Error('website bundle missing');
    for(var i=0;i<Math.min(scripts.length,3);i++){
      var js=await get(state,scripts[i],false),match,reKey=/\b([A-Za-z_$][\w$]*)\s*=\s*["']([0-9a-f]{64})["']/gi;
      while((match=reKey.exec(js.text||''))){var context=js.text.slice(match.index,match.index+2400);
        if(context.indexOf('AES-GCM')>=0&&context.indexOf('importKey')>=0&&context.indexOf('decrypt')>=0){
          localKey={origin:BASE,hex:match[2],at:Date.now()};cache('put',localKey);return {hex:match[2],cached:false};
        }
      }
    }
    throw Error('website AES-GCM key missing');
  }
  // AES-256 encryption and GCM authentication, portable to the existing JS runtime.
  function xtime(x){return ((x<<1)^((x&128)?0x11b:0))&255;}
  function multiply(a,b){var n=0;while(b){if(b&1)n^=a;a=xtime(a);b>>>=1;}return n;}
  var sbox=[];
  for(var si=0;si<256;si++){var inv=si?1:0,p=si,e=254;while(e){if(e&1)inv=multiply(inv,p);p=multiply(p,p);e>>>=1;}var a=inv,v=inv;for(var rot=1;rot<=4;rot++){v=((v<<1)|(v>>>7))&255;a^=v;}sbox.push(a^99);}
  function expand(hex){var out=new Uint8Array(240);for(var i=0;i<32;i++)out[i]=parseInt(hex.slice(i*2,i*2+2),16);var n=32,rc=1,t=[];
    while(n<240){for(var j=0;j<4;j++)t[j]=out[n-4+j];if(n%32===0){var first=t.shift();t.push(first);for(j=0;j<4;j++)t[j]=sbox[t[j]];t[0]^=rc;rc=xtime(rc);}else if(n%32===16){for(j=0;j<4;j++)t[j]=sbox[t[j]];}for(j=0;j<4;j++){out[n]=out[n-32]^t[j];n++;}}
    return out;
  }
  function block(input,k){var s=new Uint8Array(input),t=new Uint8Array(16);for(var j=0;j<16;j++)s[j]^=k[j];
    for(var r=1;r<=14;r++){
      for(var c=0;c<4;c++)for(var row=0;row<4;row++)t[c*4+row]=sbox[s[((c+row)%4)*4+row]];
      s.set(t);
      if(r!==14)for(c=0;c<4;c++){var i=c*4,a=s[i],b=s[i+1],d=s[i+2],e=s[i+3],all=a^b^d^e;s[i]=a^all^xtime(a^b);s[i+1]=b^all^xtime(b^d);s[i+2]=d^all^xtime(d^e);s[i+3]=e^all^xtime(e^a);}
      for(j=0;j<16;j++)s[j]^=k[r*16+j];
    }return s;
  }
  function words(bytes,offset){var w=[0,0,0,0];for(var i=0;i<16;i++)w[i>>>2]|=(bytes[offset+i]||0)<<(24-(i%4)*8);return w;}
  function gf128(x,h){var z=[0,0,0,0],v=h.slice();for(var i=0;i<128;i++){if((x[i>>>5]>>>(31-(i&31)))&1)for(var j=0;j<4;j++)z[j]^=v[j];var low=v[3]&1;for(j=3;j>0;j--)v[j]=(v[j]>>>1)|((v[j-1]&1)<<31);v[0]>>>=1;if(low)v[0]^=0xe1000000;}return z;}
  function decrypt(value,hex){
    if(typeof value!=='string'||value.length>16000||!/^[A-Za-z0-9_+\/-]+={0,2}$/.test(value))throw Error('cipher encoding');
    var b64=value.replace(/-/g,'+').replace(/_/g,'/');if(b64.length%4===1)throw Error('cipher length');while(b64.length%4)b64+='=';
    var raw=atob(b64),bytes=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);if(bytes.length<29)throw Error('cipher short');
    var aes=expand(hex),iv=new Uint8Array(16);iv.set(bytes.subarray(0,12));iv[15]=1;
    var cipher=bytes.subarray(12,bytes.length-16),h=words(block(new Uint8Array(16),aes),0),y=[0,0,0,0];
    for(i=0;i<cipher.length;i+=16){var w=words(cipher,i);for(var j=0;j<4;j++)y[j]^=w[j];y=gf128(y,h);}
    y[3]^=cipher.length*8;y=gf128(y,h);
    var tag=block(iv,aes),diff=0;for(i=0;i<16;i++)diff|=(tag[i]^((y[i>>>2]>>>(24-(i%4)*8))&255))^bytes[bytes.length-16+i];
    if(diff)throw Error('GCM authentication failed');
    var plain='',counter=2;
    for(i=0;i<cipher.length;i+=16){iv[12]=counter>>>24;iv[13]=counter>>>16;iv[14]=counter>>>8;iv[15]=counter;counter++;var pad=block(iv,aes);for(j=0;j<16&&i+j<cipher.length;j++)plain+='%'+('0'+(cipher[i+j]^pad[j]).toString(16)).slice(-2);}
    var url=https(decodeURIComponent(plain));if(!url)throw Error('decrypted URL invalid');return url;
  }
  function attrs(line){var out={},r=/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/gi,m;while((m=r.exec(line)))out[m[1].toUpperCase()]=m[2]!==undefined?m[2]:m[3];return out;}
  function playlist(text,base){
    text=String(text||'').replace(/^\uFEFF/,'').trim();if(!text.startsWith('#EXTM3U'))throw Error('not HLS');
    var lines=text.split(/\r?\n/).map(function(s){return s.trim();}),variants=[],segments=[],tracks=[],init='',keyUrl='',encrypted=false;
    for(var i=0;i<lines.length;i++){
      var l=lines[i],a;
      if(l.startsWith('#EXT-X-STREAM-INF:')){a=attrs(l);var next=i+1;while(next<lines.length&&(!lines[next]||lines[next][0]==='#'))next++;var u=https(lines[next],base),res=/^(\d+)x(\d+)$/.exec(a.RESOLUTION||'');if(u&&res)variants.push({url:u,width:+res[1],height:+res[2],quality:quality(+res[1],+res[2]),codecs:a.CODECS||'',audioGroup:a.AUDIO||''});}
      else if(l.startsWith('#EXT-X-MEDIA:')){a=attrs(l);tracks.push(a);}
      else if(l.startsWith('#EXT-X-MAP:')){a=attrs(l);init=https(a.URI,base);}
      else if(l.startsWith('#EXT-X-KEY:')){a=attrs(l);if(a.METHOD&&a.METHOD!=='NONE'){if(a.METHOD!=='AES-128')throw Error('unsupported encrypted HLS');encrypted=true;keyUrl=https(a.URI,base);}}
      else if(l&&l[0]!=='#')segments.push(https(l,base));
    }
    return {variants:variants,segments:segments.filter(Boolean),tracks:tracks,init:init,key:keyUrl,encrypted:encrypted};
  }
  function h264Size(bytes){
    // Recover Annex-B elementary video from TS packet payloads; no filename guesses.
    var pid=-1,data=[];
    for(var pos=0;pos+188<=bytes.length;pos+=188){if(bytes[pos]!==71)return null;var p=pos+4,af=(bytes[pos+3]>>>4)&3;if(af===0||af===2)continue;if(af===3)p+=1+bytes[p];if(p>=pos+188)continue;var id=((bytes[pos+1]&31)<<8)|bytes[pos+2];
      if((bytes[pos+1]&64)&&bytes[p]===0&&bytes[p+1]===0&&bytes[p+2]===1&&bytes[p+3]>=224&&bytes[p+3]<=239){pid=id;p+=9+bytes[p+8];}if(id===pid)for(;p<pos+188;p++)data.push(bytes[p]);}
    for(var a=0;a+8<data.length;a++)if(data[a]===0&&data[a+1]===0&&data[a+2]===1&&(data[a+3]&31)===7){
      var raw=[],end=a+4;while(end+3<data.length&&!(data[end]===0&&data[end+1]===0&&(data[end+2]===1||data[end+2]===0&&data[end+3]===1)))end++;
      for(var j=a+4;j<end;j++){if(data[j]===3&&j>=a+6&&data[j-1]===0&&data[j-2]===0)continue;raw.push(data[j]);}
      try{var bit=0;function read(n){if(bit+n>raw.length*8||n>32)throw Error('SPS truncated');var v=0;while(n--){v=v*2+((raw[bit>>>3]>>>(7-(bit&7)))&1);bit++;}return v;}function ue(){var n=0;while(read(1)===0){if(++n>24)throw Error('SPS overflow');}return Math.pow(2,n)-1+(n?read(n):0);}function se(){var v=ue();return v&1?(v+1)/2:-v/2;}
        var profile=read(8);read(16);ue();var chroma=1,separate=0;
        if([100,110,122,244,44,83,86,118,128,138,139,134,135].indexOf(profile)>=0){chroma=ue();if(chroma===3)separate=read(1);ue();ue();read(1);if(read(1))for(var list=0;list<(chroma===3?12:8);list++)if(read(1)){var last=8,next=8;for(var z=0;z<(list<6?16:64);z++){if(next!==0)next=(last+se()+256)%256;last=next===0?last:next;}}}
        ue();var poc=ue();if(poc===0)ue();else if(poc===1){read(1);se();se();var cycle=ue();if(cycle>256)throw Error('SPS cycle');while(cycle--)se();}ue();read(1);var w=(ue()+1)*16,mh=ue()+1,frame=read(1);if(!frame)read(1);read(1);var left=0,right=0,top=0,bottom=0;if(read(1)){left=ue();right=ue();top=ue();bottom=ue();}var ctype=separate?0:chroma,cropX=ctype===0||ctype===3?1:2,cropY=(ctype===1?2:1)*(2-frame),h=mh*16*(2-frame);w-=(left+right)*cropX;h-=(top+bottom)*cropY;if(w>=16&&w<=8192&&h>=16&&h<=8192)return {width:w,height:h,codec:'h264'};
      }catch(_){}return null;
    }return null;
  }
  function sample(result,encrypted){
    if(result.bytes){var b=result.bytes;if(b.length<16)throw Error('short segment');
      if(b[0]===71&&b.length>376&&b[188]===71&&b[376]===71)return {evidence:'TS bytes',size:h264Size(b)};
      var box='';for(var i=4;i<8;i++)box+=String.fromCharCode(b[i]);if(['ftyp','styp','moof','sidx','emsg'].indexOf(box)>=0)return {evidence:'MP4 bytes',size:null};
      var prefix='';for(var bi=0;bi<Math.min(b.length,48);bi++)prefix+=String.fromCharCode(b[bi]);
      if(/^\s*(?:<|\{|\[)|^\x89PNG|^GIF8|^\xff\xd8\xff/.test(prefix))throw Error('segment is an image/document');
      if(encrypted)return {evidence:'encrypted bytes',size:null};throw Error('segment is not TS/fMP4');
    }
    // The existing native fetch exposes text only. Never claim a byte-level SPS probe here.
    var text=result.text||'',trim=text.replace(/^\s+/,'');
    if(/^\uFFFD?PNG|^\x89PNG|^<|^\{|^\[|^#EXTM3U/i.test(trim))throw Error('segment is an image/document');
    if(text.length>376&&text.charCodeAt(0)===71&&text.charCodeAt(1)<128&&(text.charCodeAt(3)&48)&&text.indexOf('\x00\x00\x01')>=0)return {evidence:'TS text prefix; binary API unavailable',size:null};
    if(['ftyp','styp','moof','sidx','emsg'].indexOf(text.slice(4,8))>=0)return {evidence:'MP4 text prefix; binary API unavailable',size:null};
    if(encrypted&&text.length>=16)return {evidence:'encrypted HTTP payload; binary API unavailable',size:null};
    throw Error('segment transport not verified');
  }
  async function resolveRoute(state,row){
    var root=await get(state,row.url,false),manifest,rootURL=root.url,hint=0;
    if(/^\s*\[/.test(root.text||'')){
      var choices=JSON.parse(root.text).filter(function(x){return x&&Number(x.resolution)>=720&&https(x.url);}).sort(function(a,b){return b.resolution-a.resolution;});
      if(!choices.length)throw Error('no eligible JSON source');hint=Number(choices[0].resolution);root=await get(state,https(choices[0].url),false);rootURL=root.url;
    }
    manifest=playlist(root.text,rootURL);
    var variants=manifest.variants.filter(function(v){return v.quality>=720;}).sort(function(a,b){return b.quality-a.quality;});
    if(manifest.variants.length&&!variants.length)throw Error('below 720p');
    if(!manifest.variants.length)variants=[{url:rootURL,quality:hint,codecs:'',audioGroup:''}];
    for(var i=0;i<Math.min(variants.length,2);i++){
      try{
        var v=variants[i],media=manifest,mediaURL=rootURL;
        if(v.url!==rootURL){var child=await get(state,v.url,false);mediaURL=child.url;media=playlist(child.text,mediaURL);}
        if(!media.segments.length)throw Error('media playlist empty');
        if(!v.quality&&!root.binaryCapable)throw Error('resolution not verified; binary API unavailable');
        var external=manifest.tracks.filter(function(t){return t.TYPE==='AUDIO'&&t['GROUP-ID']===v.audioGroup&&t.URI;});
        if(external.length)throw Error('external-audio rendition not supported by this direct route');
        if(media.init)sample(await get(state,media.init,true),false);
        if(media.encrypted){if(!media.key)throw Error('missing AES key URL');var kr=await get(state,media.key,true);if(kr.bytes?kr.bytes.length!==16:!kr.text||/^\s*</.test(kr.text))throw Error('invalid AES key');}
        var proof=sample(await get(state,media.segments[0],true),media.encrypted),dims=proof.size,q=dims?quality(dims.width,dims.height):v.quality;
        if(q<720)throw Error('resolution not verified at 720p+');
        var codec=dims?dims.codec:/avc1|avc3/i.test(v.codecs)?'h264':/hvc1|hev1/i.test(v.codecs)?'hevc':'unknown';
        log('MEDIA: server='+clean(row.name)+' '+q+'p; '+proof.evidence+'; codec='+codec+'; MIME=HLS');
        return {name:'VidRock',title:state.title+'\n'+q+'p | '+row.audio.label+'\n'+clean(row.name),url:mediaURL,mimeType:'application/x-mpegURL',type:'hls',isHls:true,quality:q+'p',videoCodec:codec,codecEvidence:dims?'transport-SPS':codec!=='unknown'?'HLS-codecs':'unknown',audioStatus:row.audio.status,audioLanguages:row.audio.languages,language:row.audio.languages.length===1?row.audio.languages[0]:'',audioEvidence:'API language label; not a probe of actual tracks',provider:'vidrock',serverName:clean(row.name),headers:headers(),subtitles:[],behaviorHints:{notWebReady:true}};
      }catch(error){log('SKIP: server='+clean(row.name)+' rendition='+(variants[i].quality||'unknown')+'p reason='+safeReason(error));}
    }
    return null;
  }
  function safeReason(error){return String(error&&error.message||'request failed').replace(/https?:\/\/\S+/g,'<url>').slice(0,160);}
  async function run(id,type,season,episode){
    type=type==='series'?'tv':type;
    if(!/^[1-9]\d*$/.test(String(id))||['movie','tv'].indexOf(type)<0||type==='tv'&&(!Number.isInteger(Number(season))||Number(season)<0||season==null||!Number.isInteger(Number(episode))||Number(episode)<1))return [];
    var state={calls:0,deadline:Date.now()+17500,finished:false,title:'TMDB '+id},timer;
    log('ROUTE: v2.0.0 website exact TMDB '+id+' '+type+(type==='tv'?' S'+Number(season)+'E'+Number(episode):'')+'; original/dual/unknown; minimum 720p; no VUEO changes');
    try{
      var route=BASE+'/api/'+(type==='movie'?'movie/'+id:'tv/'+id+'/'+Number(season)+'/'+Number(episode));
      var metadataURL='https://api.themoviedb.org/3/'+type+'/'+id+'?api_key=1865f43a0549ca50d341dd9ab8b29f49';
      var metaTask=vueoSharedTmdb(metadataURL,async function(){var r=await get(state,metadataURL,false);return JSON.parse(r.text);}).catch(function(){return {};});
      var timeout=new Promise(function(_,reject){timer=setTimeout(function(){state.finished=true;reject(Error('request deadline'));},17500);});
      var values=await Promise.race([Promise.all([get(state,route,false),key(state,false),metaTask]),timeout]);
      var payload=JSON.parse(values[0].text),keyInfo=values[1],meta=values[2]||{},original=lang(meta.original_language||'');state.title=clean(buildTitleProfile(meta).title)||state.title;
      var entries=Object.keys(payload||{}).filter(function(n){return payload[n]&&typeof payload[n]==='object'&&payload[n].url;}).slice(0,8);
      var rows=[],errors=0;
      function decodeRows(){rows=[];errors=0;entries.forEach(function(n){var a=audio(payload[n].language,original);if(!a.allowed){log('AUDIO: excluded explicit foreign-language source '+clean(n));return;}try{rows.push({name:n,url:decrypt(payload[n].url,keyInfo.hex),audio:a});}catch(_){errors++;}});}
      decodeRows();
      if(!rows.length&&errors&&keyInfo.cached){cache('remove');localKey=null;keyInfo=await key(state,true);decodeRows();}
      log('API: candidates='+entries.length+' eligibleAudio='+rows.length+' authenticationFailures='+errors+' original='+(original||'unknown'));
      var found=[],index=0;
      async function worker(){while(index<rows.length&&found.length<3&&!state.finished){var row=rows[index++];try{var item=await resolveRoute(state,row);if(item&&!found.some(function(x){return x.url===item.url;}))found.push(item);}catch(e){log('SKIP: server='+clean(row.name)+' reason='+safeReason(e));}}}
      try{await Promise.race([Promise.all([worker(),worker(),worker()]),timeout]);}catch(e){if(!state.finished)throw e;log('BUDGET: returning completed routes');}
      state.finished=true;var result=found.sort(function(a,b){return (a.videoCodec==='h264'?0:1)-(b.videoCodec==='h264'?0:1)||parseInt(b.quality)-parseInt(a.quality);}).slice(0,3);
      log('RESULT: '+result.length+' segment-checked HLS sources; calls='+state.calls+'; playback requires device test');return result;
    }catch(e){log('NO_RESULT: '+safeReason(e)+'; calls='+state.calls);return [];}finally{state.finished=true;if(timer)clearTimeout(timer);}
  }
  module.exports={getStreams:run};
  if(typeof globalThis!=='undefined')globalThis.getStreams=run;
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
module.exports = cloudbankDisplayInstall(module.exports, "🪨 VidRock", "vidrock");
if (typeof globalThis !== "undefined") globalThis.getStreams = module.exports.getStreams;
if (typeof global !== "undefined") global.getStreams = module.exports.getStreams;
if (typeof self !== "undefined") self.getStreams = module.exports.getStreams;
/* CLOUDBANK_PLAYIMDB_DISPLAY_END */
