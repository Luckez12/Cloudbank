import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('providers/vidzee.js','utf8');
let calls=[],logs=[],defaultLanguage='Auto';
const c={module:{exports:{}},URL,Promise,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},VUEO_DISCOVERY_CONTEXT:{tmdb:{id:44217,name:'Vikings',original_language:'en'}},fetch:async(url,options)=>{
 calls.push({url,options});assert.ok(!options?.headers?.Range,'No media Range probe allowed');
 if(url.includes('/search/'))return {ok:true,text:async()=>JSON.stringify({results:[{id:8,original_language:'hi'},{id:44217,original_language:'en'}]})};
 if(url.includes('/streams/languages/'))return {ok:true,text:async()=>JSON.stringify({languages:['Hindi','English','Japanese']})};
 if(url.includes('/streams/')){const server=new URL(url).searchParams.get('s');return {ok:true,text:async()=>JSON.stringify({url:'https://cdn.example/'+encodeURIComponent(server)+'.m3u8',language:server==='dcloud'?defaultLanguage:server==='v6:English'?'English':'Auto',headers:{'X-Upstream':'retained'}})};}
 if(url.includes('/subs/'))return {ok:true,text:async()=>'[]'};
 if(url.endsWith('.m3u8'))return {ok:true,text:async()=>'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:5,\n0.jpg'};
 throw Error('Unexpected media/init/segment request');
}};
vm.runInNewContext(source,c);
assert.equal(typeof c.vzProbeSize,'undefined');assert.ok(!source.includes('arrayBuffer('));
let result=await c.getStreams(44217,'tv',1,1);assert.equal(result.length,5);assert.ok(result.every(x=>x.quality==='auto'));
assert.ok(!calls.some(x=>x.url.includes('v6%3AHindi')||x.url.includes('v4%3AHindi')));
const english=result.find(x=>x.name==='VidZee • English');assert.equal(english.url,'https://cdn.example/v6%3AEnglish.m3u8');assert.equal(english.type,'m3u8');assert.equal(english.headers.Referer,'https://player.vidzee.wtf/');assert.equal(english.headers['X-Upstream'],'retained');
assert.ok(!calls.some(x=>x.url.endsWith('0.jpg')));
defaultLanguage='Hindi';result=await c.getStreams(44217,'tv',1,1);assert.ok(!result.some(x=>x.name==='VidZee • Dcloud'));
c.VUEO_DISCOVERY_CONTEXT.tmdb.original_language='ja';calls=[];await c.getStreams(44217,'tv',1,1);assert.ok(!calls.some(x=>x.url.includes('v6%3AEnglish')||x.url.includes('v4%3AEnglish')));assert.ok(calls.some(x=>x.url.includes('v4%3AJapanese')));
c.VUEO_DISCOVERY_CONTEXT.tmdb.original_language='';calls=[];await c.getStreams(44217,'tv',1,1);assert.ok(calls.some(x=>x.url.includes('/search/tv?')));assert.ok(calls.some(x=>x.url.includes('v6%3AEnglish')));
console.log('PASS: no binary/segment/init/Range requests; media-only quality remains Auto; returned source URL/type/headers preserved; original-language forced-server selection and dubbed-payload filtering retained.');
