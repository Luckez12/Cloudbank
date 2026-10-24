const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/mapple.js','utf8');let calls=[],bridges=[],state;
const tracks=[{file:'https://sub.test/en.vtt',label:'English 2'},{file:'https://sub.test/ms.vtt',label:'Malay'},{file:'https://sub.test/fr.vtt',label:'French'}];
const ctx={module:{exports:{}},console,setTimeout,clearTimeout,URL,AbortController,require:()=>{throw Error('Host crypto forbidden');},
 fetch:async(url,opts)=>{calls.push({url,opts});assert.ok(url.startsWith('https://sub.vdrk.site/'),'Provider must not replay token/PoW/API/media HTTP');return {ok:true,status:200,json:async()=>tracks};},
 webviewResolve:async(route,options)=>{bridges.push({route,options});return state;}};
vm.createContext(ctx);vm.runInContext(code,ctx);
const good={url:'https://cdn.test/master.m3u8?token=exact&expires=123',headers:{Referer:'https://source.test/',Origin:'https://source.test',Range:'bytes=0-1'},mimeType:'application/vnd.apple.mpegurl'};
(async()=>{
 state={streams:[good,{...good},{url:'https://ads.doubleclick.net/advert.mp4'},{url:'https://cdn.test/segment.ts'},{url:'blob:abc'}],subtitles:tracks,finishReason:'network-candidate'};
 let rows=await ctx.module.exports.getStreams('1236045','movie');
 assert.equal(rows.length,1);assert.equal(rows[0].url,good.url);assert.equal(rows[0].headers.Referer,good.headers.Referer);assert.ok(!rows[0].headers.Range);assert.equal(rows[0].quality,'Unknown');
 assert.deepEqual(Array.from(rows[0].subtitles,x=>x.label),['English 2','Malay']);
 assert.equal(bridges[0].route,'https://mapple.fun/watch/movie/1236045');assert.equal(bridges[0].options.injectAbyssHook,false);assert.equal(bridges[0].options.captureSubtitles,true);
 state=JSON.stringify({sessionResponseVersion:1,streams:[{...good,networkObserved:true},{...good,url:'https://cdn.test/denied.m3u8',networkObserved:true,status:403},{...good,url:'https://cdn.test/unobserved.m3u8'}]});
 rows=await ctx.module.exports.getStreams('218539','tv',1,3);assert.equal(rows.length,1);assert.equal(bridges.at(-1).route,'https://mapple.fun/watch/tv/218539-1-3');
 const before=bridges.length;assert.equal((await ctx.module.exports.getStreams('1','tv',1,null)).length,0);assert.equal(bridges.length,before);
 ctx.webviewResolve=async()=>{throw Error('Website unavailable');};assert.equal((await ctx.module.exports.getStreams('1236045','movie')).length,0);
 delete ctx.webviewResolve;assert.equal((await ctx.module.exports.getStreams('1236045','movie')).length,0);
 assert.ok(calls.every(x=>x.url.includes('sub.vdrk.site')));
 console.log('PASS: browser-owned session/PoW, exact movie/episode routes, preserved source URL/headers/labels, no native API replay, failed/unobserved/ad/segment/blob rejection, missing/error bridge');
})().catch(e=>{console.error(e);process.exitCode=1});
