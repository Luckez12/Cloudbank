const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('providers/vidsrc.js','utf8');
function load(streams, detailed=false){
 const calls=[],logs=[];
 const context={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},
  VUEO_DISCOVERY_CONTEXT:{tmdbId:'12345',mediaType:'movie',tmdb:{id:12345,title:'Fixture',original_language:'en'}},
  fetch(){throw Error('Native HTTP must not be called');},
  __vueoNativeFetch(){throw Error('Binary HTTP must not be called');},
  webviewResolve:async(url,options)=>{calls.push({url,options});return detailed?{sessionResponseVersion:1,streams,finishReason:'response-media',diagnostics:{pageFinished:true}}:{streams};}};
 vm.runInNewContext(source,context,{timeout:1000});return {provider:context.module.exports,calls,logs};
}
(async()=>{
 const url='https://media.example/pl/fixture/master.m3u8?token=fixture';
 const actualBasic=load([{url,label:'HLS',headers:{Referer:'https://player.example/',Origin:'https://player.example',Cookie:'fixture-cookie',Range:'bytes=0-99'}}]);
 const rows=await actualBasic.provider.getStreams('12345','movie');
 assert.equal(rows.length,1,'Accept basic bridge results that omit observation flags');
 assert.equal(rows[0].url,url);assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].mimeType,'application/x-mpegURL');assert.equal(rows[0].isAdaptive,true);
 assert.equal(rows[0].headers.Referer,'https://player.example/');assert.equal(rows[0].headers.Origin,'https://player.example');assert.equal(rows[0].headers.Cookie,'fixture-cookie');assert.equal(rows[0].headers.Range,undefined);
 assert.equal(actualBasic.calls.length,1);const opts=actualBasic.calls[0].options;
 assert.equal(actualBasic.calls[0].url,'https://vidsrc.sh/embed/movie/12345');
 assert.equal(opts.waitForMediaReady,false);assert.equal(opts.blockMatchedRequests,false);assert.equal(opts.captureSessionResponses,false);assert.equal(opts.captureSubtitles,false);
 assert.equal(opts.framePlaySelectors.join(','),'button#bigPlay');assert.equal(opts.playerFrameSelectors.join(','),'iframe#player_frame');
 assert.equal(opts.clickDelaysMs.join(','),'0');assert.equal(opts.timeoutMs,12000);
 assert.ok(actualBasic.logs.some(x=>x.includes('pageFinished=not-provided')));
 const mixed=load([{url},{url},{url:'blob:https://player.example/fixture'},{url:'https://player.example/watch/12345'},{url:'https://media.example/segment.mp4'},{url:'https://media.example/init.mp4'},{url:'https://media.example/dub.mp4',isDubbed:true,audioLanguage:'hi'},{url:'https://media.example/dual.mp4',isDubbed:true,isDualAudio:true}]);
 assert.equal((await mixed.provider.getStreams('12345','movie')).length,2);
 const observed=load([{url,networkObserved:true},{url:'https://media.example/not-observed.mp4',networkObserved:false,responseObserved:false}],true);
 assert.equal((await observed.provider.getStreams('12345','movie')).length,1);
 const tv=load([]);assert.equal((await tv.provider.getStreams('67890','series',2,7)).length,0);assert.equal(tv.calls[0].url,'https://vidsrc.sh/embed/tv/67890/2/7');
 assert.equal((await tv.provider.getStreams('67890','tv',null,7)).length,0);assert.equal((await tv.provider.getStreams('bad/id','movie')).length,0);assert.equal(tv.calls.length,1);
 console.log('VidSrc session: actual basic result accepted, master/header preservation, no native HTTP or binary capability, strict detailed flags, episode identity and empty sessions passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
