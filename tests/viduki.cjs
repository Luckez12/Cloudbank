const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('providers/viduki.js','utf8');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function test(pending){let end,release,signal,calls=[];const waiting=new Promise(r=>release=r),gate=new Promise(r=>end=r);
 const data={subtitles:[{url:'https://subs.example/albanian.vtt',lang:'Albanian'},{url:'https://subs.example/en.vtt',lang:'English'},{url:'https://subs.example/ms.srt',lang:'Malay'}]};
 const ctx={module:{exports:{}},URL,AbortController,setTimeout,clearTimeout,console:{log(){}},webviewResolve:()=>gate,fetch:async(url,opts)=>{calls.push(url);signal=opts.signal;assert.ok(url.includes('/data/subs/movie/1561726'),'Only subtitle index may be fetched');return pending?waiting:{ok:true,json:async()=>data};}};
 vm.createContext(ctx);vm.runInContext(source,ctx);const task=ctx.module.exports.getStreams('1561726','movie');await flush();end({streams:[{url:'https://cdn.example/video.m3u8'}]});await flush();const result=await task;
 assert.equal(result.length,1);assert.equal(calls.length,1);assert.equal(result[0].subtitles.length,pending?0:2);
 if(!pending){assert.equal(result[0].subtitles[0].language,'en');assert.equal(result[0].subtitles[0].mimeType,'text/vtt');assert.equal(result[0].subtitles[1].language,'ms');assert.equal(result[0].subtitles[1].mimeType,'application/x-subrip');}
 assert.equal(signal.aborted,true);if(pending){release({ok:true,json:async()=>data});await flush();assert.equal(calls.length,1);assert.equal(result[0].subtitles.length,0);}}
(async()=>{await test(false);await test(true);console.log('PASS English/Malay URL handoff, MIME, no subtitle/CDN file fetches, cancellation and late-index suppression');})().catch(e=>{console.error(e);process.exitCode=1;});
