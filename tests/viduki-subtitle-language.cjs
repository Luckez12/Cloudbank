const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('providers/viduki.js','utf8');
let releaseDiscovery;const gate=new Promise(r=>releaseDiscovery=r),calls=[];
const data=[...Array.from({length:4},(_,i)=>({url:'https://subs.example/albanian_'+i+'.vtt',lang:'Albanian'})),{url:'https://subs.example/en.vtt',lang:'English'},{url:'https://subs.example/en2.vtt',lang:'eng'},{url:'https://subs.example/ms.vtt',lang:'Malay'},{url:'https://subs.example/ms2.vtt',lang:'msa'},{url:'https://subs.example/en3.vtt',lang:'en'}];
const ctx={module:{exports:{}},URL,AbortController,setTimeout,clearTimeout,console:{log(){}},webviewResolve:()=>gate,fetch:async(url)=>{calls.push(url);if(url.includes('/data/subs/'))return {ok:true,json:async()=>({subtitles:data})};return {ok:true,text:async()=> 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n'};}};
vm.createContext(ctx);vm.runInContext(source.replace('module.exports={getStreams:getStreams};','module.exports={getStreams:getStreams,lang:subtitleLanguage,choose:chooseSubtitles};'),ctx);
(async()=>{
 const p=ctx.module.exports;
 for(const [row,want] of [[{lang:'Albanian'},'sq'],[{lang:'alb'},'sq'],[{lang:'sqi'},'sq'],[{lang:'Bengali'},'bn'],[{lang:'eng-US'},'en-us'],[{language:'und',lang:'eng'},'en'],[{label:'English SDH'},'en'],[{lang:'Bahasa Melayu'},'ms'],[{lang:'unknown'},'und']])assert.equal(p.lang(row),want);
 for(const lang of ['Albanian','sq','Indonesian','id','Japanese','ja','unknown','und','Bengali'])assert.equal(p.choose([{url:'https://subs.example/a.vtt',lang}]).length,0,lang);for(const lang of ['English','en-US','eng','Malay','ms-MY','msa'])assert.equal(p.choose([{url:'https://subs.example/a.vtt',lang}]).length,1,lang);
 assert.equal(p.choose([{url:'https://subs.example/a.vtt',lang:'English'},{url:'https://subs.example/a.vtt',lang:'English'}]).length,1);
 const task=p.getStreams('1236045','movie');for(let i=0;i<40;i++)await Promise.resolve();
 assert.deepEqual(calls.slice(1),['https://subs.example/en.vtt','https://subs.example/en2.vtt','https://subs.example/ms.vtt','https://subs.example/ms2.vtt']);
 releaseDiscovery({streams:[{url:'https://cdn.example/master.m3u8'}]});const result=await task;
 assert.deepEqual(Array.from(result[0].subtitles,t=>t.language),['en','en','ms','ms']);
 assert.equal(calls.length,5,'One index and four subtitle fetches; no video fetch');
 console.log('PASS: English/Malay selected ahead of initial Albanian rows; normalized language aliases/labels; four-fetch cap; URL deduplication; returned language priority.');
})().catch(e=>{console.error(e);process.exitCode=1;});
