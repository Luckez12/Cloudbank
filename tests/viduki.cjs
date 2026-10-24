const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync('providers/viduki.js','utf8');
async function run(options={}){
 const calls=[],bridgeCalls=[],logs=[];
 const row=Object.assign({url:'https://cdn.example/master.m3u8?token=signed',headers:{Referer:'https://www.viduki.net/',Cookie:'session=test'}},options.row);
 const ctx={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},
 webviewResolve:async(url,opts)=>{bridgeCalls.push({url,opts});const session={streams:options.empty?[]:[row],mediaReady:false,subtitles:options.nativeSubs||[]};if(options.detailed)session.sessionResponseVersion=1;return options.string?JSON.stringify(session):session;},
 fetch:async(url,opts)=>{
  calls.push({url,opts});
  // A CDN recheck is a regression, even if it would return quickly.
  if(url.startsWith('https://cdn.example/'))throw Error('FORBIDDEN CDN RECHECK');
  if(url.startsWith('https://rezesubs.com/data/subs/'))return {ok:true,json:async()=>({subtitles:options.noSubs?[]:[{url:'https://subs.example/sub.vtt',lang:'English'}]})};
  assert.equal(url,'https://subs.example/sub.vtt');
  return {ok:options.subHttp!==403,status:options.subHttp||200,text:async()=>options.subtitle===undefined?'WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n':options.subtitle};
 }};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const result=await ctx.module.exports.getStreams(options.id||'1561726',options.type||'movie',options.s,options.e);
 assert.equal(calls.filter(c=>c.url.startsWith('https://cdn.example')).length,0,'No duplicate video HTTP request');
 return {result,calls,bridgeCalls,logs};
}
(async()=>{
 let r=await run();assert.equal(r.result.length,1);assert.equal(r.result[0].url,'https://cdn.example/master.m3u8?token=signed');assert.equal(r.result[0].headers.Cookie,'session=test');assert.equal(r.result[0].mimeType,'application/x-mpegURL');assert.equal(r.result[0].subtitles[0].language,'en');assert.equal(r.result[0].subtitles[0].mimeType,'text/vtt');assert.equal(r.bridgeCalls[0].url,'https://www.viduki.net/1/movie/1561726');assert.equal(r.bridgeCalls[0].opts.waitForMediaReady,false);
 for(const opts of [{detailed:true},{row:{networkObserved:false}},{row:{statusCode:410}},{row:{quality:'480p'}},{row:{height:576}},{row:{isDubbed:true}},{row:{contentType:'text/html'}},{row:{contentType:'application/json'}},{empty:true}]) assert.equal((await run(opts)).result.length,0,JSON.stringify(opts));
 for(const opts of [{detailed:true,row:{networkObserved:true}},{row:{responseObserved:true}},{row:{isDubbed:true,isMultiAudio:true}},{string:true}])assert.equal((await run(opts)).result.length,1);
 for(const subtitle of ['<html>blocked</html>','WEBVTT\n','',':)']){r=await run({subtitle});assert.equal(r.result.length,1);assert.equal(r.result[0].subtitles.length,0);}
 r=await run({subtitle:'1\n00:00:00,000 --> 00:00:02,000\nHello\n'});assert.equal(r.result[0].subtitles[0].mimeType,'application/x-subrip');
 r=await run({subHttp:403});assert.equal(r.result.length,1);assert.equal(r.result[0].subtitles.length,0);
 r=await run({noSubs:true,nativeSubs:[{url:'https://subs.example/sub.vtt',language:'en'},{url:'https://subs.example/sub.vtt',lang:'English'}],row:{subtitles:[{url:'https://subs.example/sub.vtt',lang:'en'}]}});assert.equal(r.result[0].subtitles.length,1);assert.equal(r.calls.filter(c=>c.url==='https://subs.example/sub.vtt').length,1);
 r=await run({id:'1399',type:'series',s:1,e:2});assert.equal(r.bridgeCalls[0].url,'https://www.viduki.net/1/tv/1399/1/2');
 for(const opts of [{id:'bad'},{type:'tv',s:1,e:0}]){r=await run(opts);assert.equal(r.result.length,0);assert.equal(r.bridgeCalls.length,0);}
 console.log('PASS: no video CDN rechecks; exact routes; unchanged captured URL/headers; basic/detailed bridge; captured error/MIME/audio/quality filters; cue-validated VTT/SRT; deduplicated native subtitles.');
})().catch(e=>{console.error(e);process.exitCode=1;});
