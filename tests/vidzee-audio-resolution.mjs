import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('providers/vidzee.js','utf8');
const sps264=Buffer.from('000000016742c028da01e0089f97011000000300100000030020f1832a','hex');
const sps265=Buffer.from('0000000142010101600000030090000003000003005da00280802d165959a4932bc05a020000030002000003000210','hex');
let calls=[],logs=[],original='en',defaultLanguage='Auto',probeMode='partial',reads=0;
const context={module:{exports:{}},URL,Promise,setTimeout,clearTimeout,Uint8Array,console:{log:s=>logs.push(s)},fetch:async(url,opts)=>{
 calls.push(url);
 if(url.includes('search/'))return {ok:true,text:async()=>JSON.stringify({results:[{id:8,original_language:'hi'},{id:44217,original_language:'en'}]})};
 if(url.includes('/streams/languages/'))return {ok:true,text:async()=>JSON.stringify({languages:['Hindi','English','Japanese']})};
 if(url.includes('/streams/')){const server=new URL(url).searchParams.get('s');return {ok:true,text:async()=>JSON.stringify({url:'https://cdn.example/'+encodeURIComponent(server)+'.m3u8',language:server==='dcloud'?defaultLanguage:'Auto'})};}
 if(url.includes('/subs/'))return {ok:true,text:async()=>'[]'};
 if(url.endsWith('.m3u8'))return {ok:true,text:async()=>'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:5,\nfirst.ts'};
 if(url.endsWith('first.ts')){assert.equal(opts.headers.Range,'bytes=0-65535');return {ok:true,status:probeMode==='partial'?206:200,headers:{get:k=>k==='content-length'?String(probeMode==='partial'?sps264.length:1000000):null},arrayBuffer:async()=>{reads++;return sps264.buffer.slice(sps264.byteOffset,sps264.byteOffset+sps264.byteLength);}};}
 throw Error('unexpected request');
}};
vm.runInNewContext(source,context);
assert.equal(context.vzCodecSize(Array.from(sps264)).height,1080);assert.equal(context.vzCodecSize(Array.from(sps265)).height,720);
assert.equal(context.vzCodecSize([1,2,3]),null);assert.equal(context.vzProbeTarget('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\nfirst.ts','https://cdn.example/x.m3u8'),'');
context.VUEO_DISCOVERY_CONTEXT={tmdb:{id:44217,name:'Vikings',original_language:'en'}};
let result=await context.getStreams(44217,'tv',1,1);
assert.equal(result.length,5);assert.ok(result.every(s=>s.quality==='1080p'));
assert.ok(!calls.some(x=>x.includes('v6%3AHindi')||x.includes('v4%3AHindi')||x.includes('v4%3AJapanese')));
assert.ok(calls.some(x=>x.includes('v6%3AEnglish')));
defaultLanguage='Hindi';calls=[];result=await context.getStreams(44217,'tv',1,1);assert.ok(!result.some(s=>s.name==='VidZee • Dcloud'));assert.ok(logs.some(x=>x.includes('AUDIO_FILTER')));
context.VUEO_DISCOVERY_CONTEXT.tmdb.original_language='ja';calls=[];result=await context.getStreams(44217,'tv',1,1);assert.ok(!calls.some(x=>x.includes('v6%3AEnglish')||x.includes('v4%3AEnglish')));assert.ok(calls.some(x=>x.includes('v4%3AJapanese')));
context.VUEO_DISCOVERY_CONTEXT.tmdb.original_language='';defaultLanguage='Auto';calls=[];await context.getStreams(44217,'tv',1,1);assert.ok(calls.some(x=>x.includes('/search/tv?')));assert.ok(calls.some(x=>x.includes('v6%3AEnglish')));
probeMode='ignored';reads=0;const size=await context.vzProbeSize('#EXTM3U\nfirst.ts','https://cdn.example/index.m3u8',{}, {deadline:Date.now()+10000});assert.equal(size,null);assert.equal(reads,0);
assert.ok(!logs.some(l=>l.includes('https://cdn.example')));
console.log('PASS: original-language-only forced servers, Hindi dub excluded for Vikings, Japanese original selects Japanese, exact-ID metadata fallback, H264/HEVC sizes, bounded Range probing, encrypted playlist skipped, oversized full response not read, no guessed quality.');
