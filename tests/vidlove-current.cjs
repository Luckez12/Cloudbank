const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/vidlove.js','utf8');
const url='https://cdn.example/api?d=fixture%2Bvalue&internal_token=fixture%25signature';
function payload(overrides={}) {return {meta:{id:12345,title:'Fixture',original_language:'en',release_date:'2025-01-01'},source:{source:'vidapi',label:'VidAPI',url,manifest:'#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nhttps://cdn.example/1080.m3u8',...overrides}};}
function load(data=payload(),{status=200,vueoRuntime=false}={}) {
 const calls=[],logs=[];
 const c={module:{exports:{}},URL,URLSearchParams,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},fetch:async(u,options)=>{
  calls.push({url:u,options});assert.equal(calls.length,1,'Only the current API request is allowed, no master/subtitle/metadata/probes');
  return {ok:status===200,status,json:async()=>data};},webviewResolve(){throw Error('WebView must not be used');}};
 if(vueoRuntime) {
  c.__vueoUrlOp=raw=>{const {input,base}=JSON.parse(raw);const u=new URL(input,base||undefined);return JSON.stringify({href:u.href,origin:u.origin,protocol:u.protocol,hostname:u.hostname,host:u.host,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash,queryPairs:Array.from(u.searchParams.entries())});};
  vm.runInNewContext(fs.readFileSync('tests/fixtures/vidlove-vueo-url-shim.js','utf8'),c,{timeout:1000});
 }
 vm.runInNewContext(code,c,{timeout:1000});return {provider:c.module.exports,calls,logs};
}
(async()=>{
 for(const vueoRuntime of [false,true]) {
  const f=load(payload(),{vueoRuntime});const rows=await f.provider.getStreams('12345','movie');assert.equal(rows.length,1);
  assert.equal(f.calls[0].url,'https://api.vidlove.cc/movie?id=12345&mode=json&sources=vidapi');
  assert.equal(rows[0].url,url,'Opaque signed master must remain byte-identical');assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].mimeType,'application/x-mpegURL');assert.equal(rows[0].isAdaptive,true);
  assert.equal(rows[0].headers.Referer,'https://player.vidlove.cc/');assert.equal(rows[0].headers.Origin,'https://player.vidlove.cc');
  assert.equal(rows[0].audioLanguage,undefined,'TMDB original language is not stream audio evidence');assert.equal(rows[0].subtitles,undefined);
 }
 const tv=load({meta:{id:24680,name:'Fixture TV'},source:payload().source},{vueoRuntime:true});await tv.provider.getStreams('24680','series',2,7);assert.equal(tv.calls[0].url,'https://api.vidlove.cc/tv?id=24680&season=2&episode=7&mode=json&sources=vidapi');
 const invalid=load();await invalid.provider.getStreams('bad/id','movie');await invalid.provider.getStreams('1','tv',null,1);assert.equal(invalid.calls.length,0);
 const wrong=load({...payload(),meta:{id:999}});assert.equal((await wrong.provider.getStreams('12345','movie')).length,0);
 for(const p of [{meta:null,source:null},payload({source:'different-engine'}),payload({url:'blob:fixture'}),payload({url:'https://user:password@cdn.example/file.mp4'}),payload({url:'https://player.example/watch',manifest:''})]) {
  const f=load(p);assert.equal((await f.provider.getStreams('12345','movie')).length,0);
 }
 const error=load(null,{status:403});assert.equal((await error.provider.getStreams('12345','movie')).length,0);assert.ok(error.logs.some(x=>x.includes('HTTP 403')));assert.equal(error.calls.length,1);
 const dub=load(payload({isDubbed:true,audioLanguage:'hi'}));assert.equal((await dub.provider.getStreams('12345','movie')).length,0);
 const dual=load(payload({isDubbed:true,isDualAudio:true}));assert.equal((await dual.provider.getStreams('12345','movie')).length,1);
 const nonOriginal=load(payload({isDualAudio:true,audioLanguages:['hi','ta']}));assert.equal((await nonOriginal.provider.getStreams('12345','movie')).length,0);
 const withOriginal=load(payload({isDualAudio:true,audioLanguages:['hi','eng']}));assert.equal((await withOriginal.provider.getStreams('12345','movie')).length,1);
 const low=load(payload({url:'https://cdn.example/file.mp4',manifest:'',quality:'480p'}));assert.equal((await low.provider.getStreams('12345','movie')).length,0);
 const adaptive=load(payload({quality:'480p'}));assert.equal((await adaptive.provider.getStreams('12345','movie')).length,1,'Adaptive master is never filtered by a release quality label');
 const headers=load(payload({headers:{Referer:'https://custom.example/',Cookie:'fixture',Range:'bytes=0-200','X-Injected':'bad\r\nvalue'}}));const h=(await headers.provider.getStreams('12345','movie'))[0].headers;
 assert.equal(h.Referer,'https://custom.example/');assert.equal(h.Cookie,'fixture');assert.equal(h.Range,undefined);assert.equal(h['X-Injected'],undefined);
 console.log('VidLove: one current API request, exact movie/episode query, actual VUEO URL-shim signed master preservation, opaque HLS MIME, no probes/WebView, identity/empty/error/audio/quality/header cases passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
