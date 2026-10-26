/* HDHub4u 2.0.0 — single-domain HTTP search -> detail -> WATCH -> extracted stream.
 * No legacy engine, download resolver, mirror collector, media/seek probes or WebView.
 */
(function(){
var BASE='https://new9.hdhub4u.cl',VERSION='2.0.0',UA='Mozilla/5.0';
function log(s){console.log('[HDHub4u] '+s);}
function url(value,base){try{var u=new URL(String(value||''),base);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function metadata(raw,id,type){if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch(_){return null;}}if(!raw||raw.error)return null;var m=raw.tmdb||raw,key=raw.tmdbId||m.id;if(key!=null&&String(key)!==id)return null;if(raw.mediaType&&raw.mediaType!==type&&!(raw.mediaType==='series'&&type==='tv'))return null;var title=String(m.title||m.name||raw.title||'').trim();if(!title)return null;return{title:title,original:m.original_title||m.original_name||raw.originalTitle||title,year:String(m.release_date||m.first_air_date||raw.year||'').slice(0,4),language:m.original_language||raw.originalLanguage||''};}
function subtitleTracks($,base){var rows=[];$('track[src]').each(function(_,e){var a=$(e);rows.push({url:a.attr('src'),label:a.attr('label'),language:a.attr('srclang'),kind:a.attr('kind')});});$('script').each(function(_,e){var t=$(e).html()||'',re=/\{[^{}]{0,1600}\}/g,m;while((m=re.exec(t))){var obj=m[0],file=/(?:file|src|url)\s*:\s*['"]([^'"]+\.(?:vtt|srt)(?:\?[^'"]*)?)['"]/i.exec(obj);if(!file)continue;var label=/(?:label|name)\s*:\s*['"]([^'"]+)['"]/i.exec(obj),language=/(?:srclang|lang|language)\s*:\s*['"]([^'"]+)['"]/i.exec(obj);rows.push({url:file[1],label:label&&label[1],language:language&&language[1],kind:obj});}});
var seen={};return rows.map(function(r){var u=url(r.url,base),text=String(r.language||r.label||'').toLowerCase(),lang=/^(?:en|eng|english)(?:$|[-_ (])/.test(text)?'en':/^(?:ms|msa|may|malay|bahasa melayu|melayu)(?:$|[-_ (])/.test(text)?'ms':'';if(!u||!lang||seen[u]||/thumbnail|sprite|chapter/i.test(String(r.kind||'')+' '+r.label))return null;seen[u]=true;return{url:u,language:lang,lang:lang,label:r.label||(lang==='en'?'English':'Bahasa Melayu'),mimeType:/\.srt(?:[?#]|$)/i.test(u)?'application/x-subrip':'text/vtt',headers:{Referer:base,'User-Agent':UA}};}).filter(Boolean);}
function extractStreams(text,base){var raw=String(text||'').replace(/\\\//g,'/').replace(/&amp;/g,'&'),out=[],seen={},re=/(?:file|source|src)\s*[:=]\s*['"]([^'"]+)['"]|['"](https?:\/\/[^'"]+\.m3u8(?:[?#][^'"]*)?)['"]/ig,m;while((m=re.exec(raw))){var u=url(m[1]||m[2],base);if(!u||!/\.m3u8(?:[?#]|$)/i.test(u)||/youtube|googlevideo|\/trailer|\/preview/i.test(u)||seen[u])continue;seen[u]=true;out.push(u);}return out;}
function unbasePacker(word, radix) {
  var alphabet62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var alphabet95 = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
  var alphabet = null;
  if (radix > 36) {
    if (radix <= 62) alphabet = alphabet62.substring(0, radix);
    else if (radix <= 95) alphabet = alphabet95.substring(0, radix);
  }
  if (!alphabet) {
    var n = parseInt(word, radix);
    return isNaN(n) ? -1 : n;
  }
  var out = 0;
  for (var i = 0; i < word.length; i++) {
    var p = alphabet.indexOf(word.charAt(i));
    if (p < 0) return -1;
    out = out * radix + p;
  }
  return out;
}

function unpackPacker(js) {
  var raw = String(js || "");
  if (!/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/i.test(raw)) return "";
  var m = raw.match(/\}\s*\('([\s\S]*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) {
    m = raw.match(/\}\s*\("([\s\S]*)",\s*(\d+)\s*,\s*(\d+)\s*,\s*"([\s\S]*?)"\.split\("\|"\)/);
  }
  if (!m) return "";

  var payload = String(m[1] || "").replace(/\\'/g, "'");
  var radix = Number(m[2] || 36);
  var count = Number(m[3] || 0);
  var symtab = String(m[4] || "").split("|");
  if (!count || symtab.length < count) return "";

  return payload.replace(/\b[a-zA-Z0-9_]+\b/g, function(word) {
    var n = unbasePacker(word, radix);
    return n >= 0 && n < symtab.length && symtab[n] ? symtab[n] : word;
  });
}

async function run(id,type,season,episode){var active=true,pending=[],started=Date.now();
function stop(){active=false;pending.slice().forEach(function(f){f();});}
function text(u,referer){if(!active)return Promise.reject(Error('stopped'));return new Promise(function(resolve,reject){var done=false,c=typeof AbortController==='function'?new AbortController():null;function finish(err,v){if(done)return;done=true;clearTimeout(timer);pending=pending.filter(function(f){return f!==cancel;});if(err){if(c)c.abort();reject(err);}else resolve(v);}function cancel(){finish(Error('cancelled'));}pending.push(cancel);var timer=setTimeout(function(){finish(Error('request timeout'));},Math.min(4000,Math.max(1,12000-(Date.now()-started))));Promise.resolve().then(function(){if(!active||done)throw Error('stopped');return fetch(u,{headers:{'User-Agent':UA,Referer:referer||BASE+'/'},signal:c?c.signal:undefined,redirect:'follow'});}).then(async function(r){if(!r.ok)throw Error('HTTP '+r.status);var body=await r.text();finish(null,{text:body,url:r.url||u});}).catch(function(e){finish(e);});});}
var deadline=setTimeout(stop,12000);
try{
log('v'+VERSION+' simple WATCH-only TMDB='+id+' type='+type);
var meta=metadata(globalThis.VUEO_DISCOVERY_CONTEXT,id,type);
var tmdb='https://api.themoviedb.org/3/'+type+'/'+id+'?api_key=439c478a771f35c05022f9feabcca01c';
if(!meta&&typeof globalThis.vueoDiscoveryContext==='function'){var shared=await new Promise(function(resolve){var ended=false,t=setTimeout(function(){finish(null);},1000);function finish(v){if(ended)return;ended=true;clearTimeout(t);resolve(v);}Promise.resolve().then(function(){return globalThis.vueoDiscoveryContext(tmdb);}).then(finish,function(){finish(null);});});meta=metadata(shared,id,type);}
if(!meta){var md=await text(tmdb);meta=metadata(JSON.parse(md.text),id,type);}if(!meta)throw Error('missing metadata title');
var query=meta.title+(type==='tv'?' Season '+season:''),search=await text(BASE+'/?s='+encodeURIComponent(query)),$=require('cheerio-without-node-native').load(search.text),candidates=[],seen={};
$('.recent-movies > li.thumb, li.thumb, article').each(function(_,el){var a=$(el).find('a[href]').first(),u=url(a.attr('href'),search.url),name=String($(el).find('figcaption p,h2,h3').first().text()||a.attr('title')||a.text()).replace(/\s+/g,' ').trim();if(!u||seen[u]||new URL(u).origin!==new URL(search.url).origin)return;seen[u]=true;var y=/\b(19\d{2}|20\d{2})\b/.exec(name),plain=name.split(/\(\s*(?:19|20)\d{2}\s*\)/)[0].replace(/\bSeason\s*\d+\b/ig,'').trim();var matching=[meta.title,meta.original].some(function(t){return norm(t)===norm(plain);});if(!matching)return;if(type==='movie'&&y&&meta.year&&y[1]!==meta.year)return;if(type==='movie'&&/\bseason\s*\d+/i.test(name))return;if(type==='tv'){var sn=/\bseason\s*(\d+)/i.exec(name);if(!sn||+sn[1]!==season)return;}candidates.push(u);});
if(!candidates.length){log('SEARCH: no exact title/year/season match');return [];}
log('SEARCH: title matched; loading one detail page');var detail=await text(candidates[0],search.url);$=require('cheerio-without-node-native').load(detail.text);var watch=[];
$('a[href]').each(function(_,el){var a=$(el),u=url(a.attr('href'),detail.url);if(!u||!/(^|\.)hdstream4u\.[a-z]+$/i.test(new URL(u).hostname))return;if(type==='tv'){var parent=a.parent().text(),em=/\bS0*(\d+)E0*(\d+)\b/i.exec(parent);if(!em||+em[1]!==season||+em[2]!==episode)return;}if(watch.indexOf(u)<0)watch.push(u);});
if(!watch.length){log('WATCH: no matching watch link; no download fallback');return [];}
var embed=watch[0].replace(/\/(?:download|file|embed|d|f)\//,'/v/');log('WATCH: one player request');var player=await text(embed,detail.url);$=require('cheerio-without-node-native').load(player.text);var scripts=$('script').map(function(_,el){return $(el).html()||'';}).get().join('\n'),decoded=unpackPacker(scripts),streams=extractStreams(decoded+'\n'+scripts,player.url);if(!streams.length){log('WATCH: no HLS URL in player');return [];}
var captions=subtitleTracks($,player.url);log('RETURN: HLS extracted='+streams.length+' subtitles='+captions.length+'; no playlist/segment/seek probes; elapsed='+(Date.now()-started)+'ms');return streams.slice(0,3).map(function(u){return{name:'HDHub4u',title:meta.title+(type==='tv'?' S'+season+'E'+episode:''),serverName:'WATCH',url:u,type:'hls',mimeType:'application/x-mpegURL',quality:'Auto',headers:{'User-Agent':UA,Referer:player.url,Origin:new URL(player.url).origin},subtitles:captions,sourceVerified:false,playbackVerified:false};});
}catch(e){log('NO_RESULT: '+String(e.message||e));return [];}finally{clearTimeout(deadline);stop();}}
module.exports={getStreams:function(id,type,s,e){type=type==='series'?'tv':type;if(!/^[1-9]\d*$/.test(String(id))||['movie','tv'].indexOf(type)<0||type==='tv'&&(s==null||e==null||!Number.isInteger(+s)||+s<0||!Number.isInteger(+e)||+e<1))return Promise.resolve([]);return run(String(id),type,+s,+e);}};globalThis.getStreams=module.exports.getStreams;
})();
