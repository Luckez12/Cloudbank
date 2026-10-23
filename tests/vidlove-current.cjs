const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/vidlove.js','utf8');
const url='https://cdn.example/api?d=fixture%2Bvalue&internal_token=fixture%25signature';
function payload(overrides={}) {return {meta:{id:12345,title:'Fixture',original_language:'en'},source:{source:'vidapi',label:'VidAPI',url,manifest:'#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nhttps://cdn.example/1080.m3u8',...overrides}};}
function load(data=payload(),{status=200,vueoRuntime=false,routes={},subtitleRows=[],subtitleStatus=200,delay=0}={}) {
 const calls=[],logs=[];let active=0,peak=0;
 const c={module:{exports:{}},URL,URLSearchParams,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},fetch:async(u,options)=>{
  calls.push({url:u,options});const parsed=new URL(u),sub=parsed.pathname.startsWith('/subtitles/');
  assert.equal(options.headers.Origin,'https://player.vidlove.cc','Match current website API Origin');
  assert.equal(parsed.origin,'https://api.vidlove.cc','No media body probes or unrelated hosts');
  if(!sub) {assert.match(parsed.searchParams.get('id'),/^\d+$/);assert.equal(parsed.searchParams.get('mode'),'json');assert.equal(parsed.searchParams.has('hevc'),false);}
  active++;peak=Math.max(peak,active);if(delay)await new Promise(r=>setTimeout(r,delay));active--;
  if(sub)return {ok:subtitleStatus===200,status:subtitleStatus,json:async()=>subtitleRows};
  const engine=parsed.searchParams.get('sources');const selected=Object.hasOwn(routes,engine)?routes[engine]:engine==='vidapi'?data:{source:null};
  return {ok:status===200,status,json:async()=>selected};},webviewResolve(){throw Error('WebView must not be used');}};
 if(vueoRuntime) {
  c.__vueoUrlOp=raw=>{const {input,base}=JSON.parse(raw);const u=new URL(input,base||undefined);return JSON.stringify({href:u.href,origin:u.origin,protocol:u.protocol,hostname:u.hostname,host:u.host,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash,queryPairs:Array.from(u.searchParams.entries())});};
  vm.runInNewContext(fs.readFileSync('tests/fixtures/vidlove-vueo-url-shim.js','utf8'),c,{timeout:1000});
 }
 vm.runInNewContext(code,c,{timeout:1000});return {provider:c.module.exports,calls,logs,peak:()=>peak};
}
(async()=>{
 for(const vueoRuntime of [false,true]) {
  const f=load(payload(),{vueoRuntime,subtitleRows:[{label:'English',file:'https://subs.example/fixture.vtt',type:'vtt'},{label:'Malay',file:'https://subs.example/ms.srt',type:'srt'},{label:'Fake',file:'data:text/vtt;base64,fixture'}]});
  const rows=await f.provider.getStreams('12345','movie');assert.equal(rows.length,1);
  assert.equal(f.calls[0].url,'https://api.vidlove.cc/movie?id=12345&mode=json&sources=moviebox&vh=1');assert.ok(f.calls.some(x=>x.url==='https://api.vidlove.cc/subtitles/movie/12345'));
  assert.ok(f.logs.some(x=>x.includes('API_REQUEST: https://api.vidlove.cc/movie?id=12345&mode=json&sources=vidapi')));
  assert.equal(rows[0].url,url);assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].mimeType,'application/x-mpegURL');assert.equal(rows[0].isAdaptive,true);
  assert.equal(rows[0].headers.Referer,'https://player.vidlove.cc/');assert.equal(rows[0].headers.Origin,'https://player.vidlove.cc','API header change must not remove the playback Origin');assert.equal(rows[0].audioLanguage,undefined);
  assert.equal(rows[0].subtitles.length,2);assert.equal(rows[0].subtitles[0].language,'English');assert.equal(rows[0].subtitles[1].language,'Malay');assert.equal(rows[0].subtitles[0].mimeType,'text/vtt');assert.equal(rows[0].subtitles[1].mimeType,'application/x-subrip');
 }
 const tv=load({meta:{id:24680,name:'Fixture TV'},source:payload().source},{vueoRuntime:true});await tv.provider.getStreams('24680','series',2,7);
 assert.equal(tv.calls[0].url,'https://api.vidlove.cc/tv?id=24680&season=2&episode=7&mode=json&sources=moviebox&vh=1');assert.ok(tv.calls.some(x=>x.url==='https://api.vidlove.cc/subtitles/tv/24680/2/7'));
 const fallback=load({source:null},{routes:{dcloud:payload({source:'dcloud'})},delay:5});assert.equal((await fallback.provider.getStreams('12345','movie')).length,1);assert.ok(fallback.peak()<=3);
 const finalEngine=load({source:null},{routes:{tcloud:payload({source:'tcloud'})},delay:5});assert.equal((await finalEngine.provider.getStreams('12345','movie')).length,1);assert.ok(finalEngine.peak()<=3);assert.equal(finalEngine.calls.filter(x=>!x.url.includes('/subtitles/')).length,5);
 const empty=load({source:null});assert.equal((await empty.provider.getStreams('12345','movie')).length,0);assert.equal(empty.calls.length,5);assert.ok(empty.calls.every(x=>!x.url.includes('/subtitles/')));
 const embedded=load({...payload(),subtitles:[{language:'ms',url:'https://subs.example/inline.vtt'},{language:'ms',file:'https://subs.example/inline.vtt'}]});const er=await embedded.provider.getStreams('12345','movie');assert.equal(er[0].subtitles.length,1);assert.ok(embedded.calls.every(x=>!x.url.includes('/subtitles/')));
 const subFail=load(payload(),{subtitleStatus:503});assert.equal((await subFail.provider.getStreams('12345','movie')).length,1);
 const invalid=load();await invalid.provider.getStreams('bad/id','movie');await invalid.provider.getStreams('1','tv',null,1);assert.equal(invalid.calls.length,0);
 for(const p of [{...payload(),meta:{id:999}},payload({url:'blob:fixture'}),payload({url:'https://user:password@cdn.example/file.mp4'}),payload({url:'https://player.example/watch',manifest:''}),payload({isDubbed:true,audioLanguage:'hi'}),payload({isDualAudio:true,audioLanguages:['hi','ta']}),payload({url:'https://cdn.example/file.mp4',manifest:'',quality:'480p'})]) {
  assert.equal((await load(p).provider.getStreams('12345','movie')).length,0);
 }
 const error=load(null,{status:403});assert.equal((await error.provider.getStreams('12345','movie')).length,0);assert.ok(error.logs.some(x=>x.includes('HTTP 403')));
 const dual=load(payload({isDubbed:true,isDualAudio:true}));assert.equal((await dual.provider.getStreams('12345','movie')).length,1);
 const adaptive=load(payload({quality:'480p'}));assert.equal((await adaptive.provider.getStreams('12345','movie')).length,1);
 const headers=load(payload({headers:{Referer:'https://custom.example/',Cookie:'fixture',Range:'bytes=0-200','X-Injected':'bad\r\nvalue'}}));const h=(await headers.provider.getStreams('12345','movie'))[0].headers;assert.equal(h.Referer,'https://custom.example/');assert.equal(h.Cookie,'fixture');assert.equal(h.Range,undefined);assert.equal(h['X-Injected'],undefined);
 console.log('VidLove: actual VUEO URL shim, visible exact ID/episode query, bounded engine fallback (peak <=3), signed master/header preservation, payload/website subtitle handoff, language/MIME/dedupe, data URL rejection, subtitle failure isolation and empty/error/audio/quality cases passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
