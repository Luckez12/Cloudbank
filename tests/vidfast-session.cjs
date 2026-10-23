const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('providers/vidfast.js','utf8');
function load(streams,{detailed=false,vueoRuntime=false}={}) {
 const calls=[],logs=[];
 const context={module:{exports:{}},URL,setTimeout,clearTimeout,
  console:{log:s=>logs.push(s)},VUEO_DISCOVERY_CONTEXT:{tmdbId:'12345',mediaType:'movie',tmdb:{id:12345,title:'Fixture',original_language:'en'}},
  fetch(){throw Error('No native HTTP, external decoder or playlist probes allowed');},
  webviewResolve:async(url,options)=>{calls.push({url,options});return detailed?{sessionResponseVersion:1,finishReason:'first-candidate',streams}:{streams};}};
 if(vueoRuntime) {
  context.__vueoUrlOp=raw=>{const {input,base}=JSON.parse(raw);const u=new URL(input,base||undefined);return JSON.stringify({href:u.href,origin:u.origin,protocol:u.protocol,hostname:u.hostname,host:u.host,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash,queryPairs:Array.from(u.searchParams.entries())});};
  vm.runInNewContext(fs.readFileSync('tests/fixtures/vidfast-vueo-url-shim.js','utf8'),context,{timeout:1000});
 }
 vm.runInNewContext(source,context,{timeout:1000});return {provider:context.module.exports,calls,logs};
}
(async()=>{
 const url='https://media.example/master.m3u8?token=fixture%2Bsignature&expires=9999999999';
 for(const vueoRuntime of [false,true]) {
  const fixture=load([{url,headers:{Referer:'https://vidfast.vc/movie/12345/',Origin:'https://vidfast.vc',Cookie:'fixture-cookie','User-Agent':'fixture-ua',Range:'bytes=0-100'}}],{vueoRuntime});
  const rows=await fixture.provider.getStreams('12345','movie');assert.equal(rows.length,1);assert.equal(rows[0].url,url,'Signed URL must be byte-preserved in actual VUEO URL shim too');
  assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].isAdaptive,true);assert.equal(rows[0].mimeType,'application/x-mpegURL');
  assert.equal(rows[0].headers.Cookie,'fixture-cookie');assert.equal(rows[0].headers['User-Agent'],'fixture-ua');assert.equal(rows[0].headers.Range,undefined);
  assert.equal(rows[0].headers.Referer,'https://vidfast.vc/movie/12345/');assert.equal(rows[0].headers.Origin,'https://vidfast.vc');
  assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].url,'https://vidfast.vc/movie/12345/');
  const opts=fixture.calls[0].options;assert.equal(opts.waitForMediaReady,false);assert.equal(opts.directLoad,true);assert.equal(opts.finishAfterFirstMs,100);
  assert.equal(opts.captureSessionResponses,false);assert.equal(opts.captureSubtitles,false);assert.equal(opts.blockMatchedRequests,false);
  assert.equal(opts.clickDelaysMs[0],opts.timeoutMs,'No coordinate actions scheduled during this session');
 }
 const tv=load([]);await tv.provider.getStreams('54321','series',2,7);assert.equal(tv.calls[0].url,'https://vidfast.vc/tv/54321/2/7/');
 const invalid=load([]);await invalid.provider.getStreams('bad/id','movie');await invalid.provider.getStreams('1','tv',null,1);assert.equal(invalid.calls.length,0);
 const mixed=load([{url},{url},{url:'blob:https://vidfast.vc/fixture'},{url:'https://media.example/segment.mp4'},{url:'https://media.example/init.mp4'},
  {url:'https://media.example/preview.mp4'},{url:'https://vidfast.vc/watch/fixture'},{url:'https://media.example/dub.mp4',isDubbed:true,audioLanguage:'hi'},
  {url:'https://media.example/dual.mp4',isDubbed:true,isDualAudio:true}]);
 assert.equal((await mixed.provider.getStreams('12345','movie')).length,2);
 const detailed=load([{url,networkObserved:true},{url:'https://media.example/unobserved.m3u8',networkObserved:false,responseObserved:false}],{detailed:true});
 assert.equal((await detailed.provider.getStreams('12345','movie')).length,1);
 const empty=load([]);assert.equal((await empty.provider.getStreams('12345','movie')).length,0);assert.ok(empty.logs.some(x=>x.includes('playback unverified')));
 console.log('VidFast: single website session, exact movie/episode routes, VUEO URL-shim signature/header preservation, master unchanged, no native probes/decoder/subtitle fetches, observed/basic compatibility and invalid candidate rejection passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
