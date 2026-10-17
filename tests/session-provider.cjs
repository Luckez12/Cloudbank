const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../providers/vidlink.js'),'utf8');
const movieToken='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAniDNpX62ejkySQVTTZ8vDcGBAMZ9dm8Z2cRK4nXgGg';
const tvToken='rEbHhHU3B_qN4IoZsD3WohImNOHtAjQmz_gW86q1A4ob0XDN56eSQItMzj0KfJevj37EQw';
const raw='https://cdn.test/film/master.mpd?sign=api';
const observed='https://flood.sourcerrr.online/sacdn/film/master.mpd?sign=browser&host=https%3A%2F%2Fcdn.test&sc=c2VjcmV0';
const mpd='<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><Representation><SegmentTemplate media="segment-$Number$.m4s"/></Representation></AdaptationSet></Period></MPD>';
function load(mode='ok'){
 const calls=[],sessions=[],logs=[];
 const sandbox={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:v=>logs.push(v),warn(){},error(){}},webviewResolve:async(url,opts)=>{
  sessions.push({url,opts});assert.equal(calls.length,0,'no separate API call');
  if(mode==='oldapp')return {sessionHandoffVersion:1};
  const tv=url.includes('/tv/');
  let api='https://vidlink.pro/api/b/'+(tv?'tv/'+tvToken+'/1/2':'movie/'+movieToken);
  if(mode==='wrongid')api='https://vidlink.pro/api/b/movie/'+tvToken;
  if(mode==='tampered')api=api.replace(movieToken,movieToken.slice(0,-5)+'AAAAA');
  if(mode==='wrongorigin')api=api.replace('vidlink.pro','wrong.test');
  if(mode==='wrongepisode')api=api.replace('/1/2','/1/3');
  let stream={deliveryType:'dash',playlist:raw,playlistHeaders:{Cookie:'upstream=secret'},requiresProxy:true,captions:[{url:'https://subs.test/en.vtt',lang:'en',type:'vtt'}]};
  if(mode==='mp4')stream={qualities:{1080:{url:'https://cdn.test/film/movie.mp4?sign=api',type:'mp4',requiresProxy:true}}};
  if(mode==='hls')stream={playlist:'https://cdn.test/film/master.m3u8?sign=api',requiresProxy:true};
  let media=mode==='mp4'?observed.replace('/sacdn/film/master.mpd','/mp/film/movie.mp4'):mode==='hls'?observed.replace('/sacdn/film/master.mpd','/proxy/film/master.m3u8'):observed;
  if(mode==='wrongfile')media=media.replace('master.mpd','other.mpd');
  if(mode==='wronghost')media=media.replace('cdn.test','other.test');
  const row={url:media,networkObserved:mode==='native',responseObserved:mode!=='unobserved',headers:{Cookie:'session=secret','User-Agent':'observed-ua',Referer:'https://vidlink.pro/movie/1288069'}};
  return {sessionResponseVersion:1,finishReason:'response-media',mediaReady:false,capturedCount:1,
   responses:mode==='noapi'?[]:[{url:api,status:mode==='apifail'?403:200,body:{sourceId:'same-session',stream,metadata:mode==='mismatch'?{tmdbId:999}:undefined}}],streams:[row]};
 },fetch:async(url,opts)=>{
  calls.push({url,opts});assert(!url.includes('/api/'));assert.equal(sessions.length,1);
  const mp4=mode==='mp4',hls=mode==='hls';
  return {ok:mode!=='428',status:mode==='428'?428:mp4?206:200,url,headers:{get:key=>({'content-type':mode==='html'?'text/html':mp4?'video/mp4':hls?'application/vnd.apple.mpegurl':'application/dash+xml','content-range':'bytes 0-1023/5000000','content-length':'1024'})[key]||null},text:async()=>mode==='badxml'?'<html>fake MPD</html>':mode==='entity'?'<!DOCTYPE MPD SYSTEM "private">'+mpd:hls?'#EXTM3U\n#EXTINF:8,\nsegment.ts':mpd};
 }};
 vm.runInNewContext(source,sandbox);return {get:sandbox.module.exports.getStreams,calls,sessions,logs};
}
(async()=>{
 let x=load(),out=await x.get(1288069,'movie');assert.equal(out.length,1);assert.equal(out[0].type,'dash');assert.equal(out[0].url,observed);assert.equal(out[0].headers.Cookie,'session=secret');assert.equal(out[0].headers['User-Agent'],'observed-ua');assert.equal(out[0].subtitles.length,1);assert.equal(x.calls.length,1);assert.equal(x.sessions[0].opts.captureSessionResponses,true);assert(x.logs.some(l=>l.includes('verifiedRoutes=1')));assert(!x.logs.join('').includes('secret'));assert(!x.calls[0].opts.headers.Range);
 for(const mode of ['oldapp','wrongid','tampered','wrongorigin','wrongfile','wronghost','unobserved','noapi','apifail','mismatch']){x=load(mode);assert.equal((await x.get(1288069,'movie')).length,0,mode);assert.equal(x.calls.length,0,mode);}
 for(const mode of ['428','html','badxml','entity']){x=load(mode);assert.equal((await x.get(1288069,'movie')).length,0,mode);assert.equal(x.calls.length,1,mode);}
 for(const mode of ['native','hls','mp4']){x=load(mode);out=await x.get(1288069,'movie');assert.equal(out.length,1,mode);assert.equal(x.calls.length,1);assert.equal(x.sessions.length,1);if(mode==='mp4')assert.equal(x.calls[0].opts.headers.Range,'bytes=0-1023');}
 x=load();assert.equal((await x.get(1399,'tv',1,2)).length,1);assert.equal(x.sessions[0].url,'https://vidlink.pro/tv/1399/1/2');
 x=load('wrongepisode');assert.equal((await x.get(1399,'tv',1,2)).length,0);assert.equal(x.calls.length,0);
 console.log('PASS: captured real public token fixtures decode to exact movie/TV ID; wrong route/episode/tampered token/metadata rejected; MPD/HLS/MP4 probes; completed-response fallback with nativeObserved=0; native request path; 428/HTML/invalid XML reject; one session + one probe, no separate API/subtitle request; cookie/token values omitted from logs');
})().catch(e=>{console.error(e);process.exit(1)});
