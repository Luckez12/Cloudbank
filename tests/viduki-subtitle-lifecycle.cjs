const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync('providers/viduki.js','utf8');
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function scenario(stage,fail=false){
 let finishDiscovery,releasePending,calls=[],signals=[];
 const pending=new Promise(r=>releasePending=r),discovery=new Promise((r,j)=>finishDiscovery=()=>fail?j(Error('load failure')):r({streams:[{url:'https://cdn.example/video.m3u8'}]}));
 const timers=new Set();
 const ctx={module:{exports:{}},URL,AbortController,console:{log(){}},setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);timers.add(t);return t;},clearTimeout:t=>{timers.delete(t);clearTimeout(t);},webviewResolve:()=>discovery,
 fetch:async(url,opts={})=>{calls.push(url);signals.push(opts.signal);if(stage==='index')return pending;if(url.includes('/data/subs/'))return {ok:true,json:async()=>({subtitles:[{url:'https://subs.example/a.vtt',lang:'English'}]})};return {ok:true,text:()=>pending};}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 let settled=false;const resultPromise=ctx.module.exports.getStreams('1561726','movie').then(r=>{settled=true;return r;});await tick();
 const before=calls.length;finishDiscovery();await tick();assert.equal(settled,true,'Video must not await pending subtitles');
 const result=await resultPromise;assert.equal(result.length,fail?0:1);if(!fail)assert.equal(result[0].subtitles.length,0);
 assert.equal(timers.size,0,'All provider timers cleared');assert.ok(signals.every(s=>s.aborted),'Pending fetch aborted');
 releasePending(stage==='index'?{ok:true,json:async()=>({subtitles:[{url:'https://subs.example/late.vtt',lang:'en'}]})}:'WEBVTT\n\n00:00.000 --> 00:01.000\nLate\n');await tick();
 assert.equal(calls.length,before,'Late results cannot start more fetches');if(!fail)assert.equal(result[0].subtitles.length,0,'Late cues cannot mutate returned results');
}
(async()=>{await scenario('index');await scenario('body');await scenario('index',true);console.log('PASS: discovery success/failure aborts pending subtitles, clears timers, returns without waiting, ignores late results and prevents further requests.');})().catch(e=>{console.error(e);process.exitCode=1;});
