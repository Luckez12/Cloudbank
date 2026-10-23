// Regression replacement: subtitle list I/O belongs to the selected player, not this scan.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/vidlove.js','utf8');
function load({payload=false,empty=false}={}){const calls=[];const ctx={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log(){}},fetch:async url=>{calls.push(url);if(url.includes('/subtitles/'))throw Error('Subtitle I/O must not hold video discovery');return {ok:true,status:200,json:async()=>empty?{source:null}:{meta:{id:12345,title:'Fixture'},source:{url:'https://media.example/master.m3u8'},...(payload?{subtitles:[{label:'Malay',file:'https://subs.example/ms.vtt'}]}:{})}};}};vm.createContext(ctx);vm.runInContext(code,ctx);return {get:(...args)=>ctx.module.exports.getStreams(...args),calls};}
(async()=>{let count=0;const pass=x=>{count++;console.log('PASS',x);};
let f=load(),out=await f.get('12345','movie');assert.equal(out.length,1);assert.equal(out[0].subtitles,undefined);assert.equal(out[0].subtitleRequests[0].url,'https://api.vidlove.cc/subtitles/movie/12345');assert(f.calls.every(u=>!u.includes('/subtitles/')));pass('video returns without starting or waiting for any subtitle request');
assert.equal(out[0].url,'https://media.example/master.m3u8');assert.equal(out[0].quality,'Auto');assert.equal(out[0].format,'hls');pass('video URL, adaptive format and quality preserved');
f=load({payload:true});out=await f.get('12345','movie');assert.equal(out[0].subtitles.length,1);assert.equal(out[0].subtitleRequests,undefined);pass('existing payload captions require no deferred request');
f=load({empty:true});assert.equal((await f.get('12345','movie')).length,0);assert(f.calls.every(u=>!u.includes('/subtitles/')));pass('no video creates no subtitle work');
f=load();out=await f.get('12345','tv',0,7);assert.equal(out[0].subtitleRequests[0].url,'https://api.vidlove.cc/subtitles/tv/12345/0/7');pass('deferred request belongs to exact season zero episode');
assert.equal(out[0].subtitleRequests[0].headers.Origin,'https://player.vidlove.cc');assert.equal(out[0].subtitleRequests[0].headers.Referer,'https://player.vidlove.cc/');pass('subtitle API profile carried separately from media URL');
console.log(count+' video-first subtitle checks passed');})().catch(e=>{console.error(e);process.exitCode=1;});
