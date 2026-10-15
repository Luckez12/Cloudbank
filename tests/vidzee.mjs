import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync('providers/vidzee.js','utf8');
const calls=[],logs=[];let mode='normal';
const sandbox={module:{exports:{}},URL,Promise,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},VUEO_DISCOVERY_CONTEXT:{tmdb:{name:'Test Title',id:1396,original_language:'en'}},fetch:async(url,options)=>{
 calls.push({url,options});let body;
 if(url.includes('/subs/'))body=JSON.stringify([{label:'Malay',file:'https://subs.example/ms.vtt'},{label:'English',file:'https://subs.example/en.vtt'},{label:'Indonesian',file:'https://subs.example/id.vtt'},{label:'English',file:'https://subs.example/en.vtt'}]);
 else if(url.includes('/streams/languages/'))body=JSON.stringify({languages:['English']});
 else if(url.includes('/streams/')){const id=new URL(url).searchParams.get('s');if(id==='tik')return {ok:false,status:502};if(id==='v6:Hindi')body='{"c":"encrypted"}';else body=JSON.stringify({url:'https://cdn.example/'+encodeURIComponent(id)+'.m3u8',language:'Auto',headers:{'X-Server':'yes'}});}
 else if(url.includes('cdn.example'))body=mode==='html'?'<!doctype html>blocked':'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1920x1080\none.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000,RESOLUTION=3840x2160\ntwo.m3u8';
 else throw Error('Unexpected request');return {ok:true,text:async()=>body};
}};
vm.runInNewContext(src,sandbox);
const get=sandbox.module.exports.getStreams;
assert.equal((await get('abc','tv',1,1)).length,0);assert.equal(calls.length,0);
assert.equal((await get(1396,'tv',1,0)).length,0);assert.equal(calls.length,0);
let result=await get(1396,'tv',1,1);assert.equal(result.length,4);assert.deepEqual(Array.from(result,x=>x.name),['VidZee • Dcloud','VidZee • Acme English','VidZee • IPcloud','VidZee • English']);
assert.ok(calls.filter(c=>c.url.includes('/streams/')&&!c.url.includes('/languages/')).every(c=>c.url.includes('/tv/1396/1/1?')));
assert.ok(result.every(x=>x.quality==='2160p'&&x.url.endsWith('.m3u8')&&x.headers.Referer==='https://player.vidzee.wtf/'&&x.headers['X-Server']==='yes'));
assert.deepEqual(Array.from(result[0].subtitles,x=>x.lang),['en','ms','id']);
assert.ok(result[0].subtitles.every(x=>x.id.startsWith('vidzee-')));
const p=sandbox.vzPlaylistInfo('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:9,\none.ts');assert.equal(p.height,0);assert.equal(p.master,false);
assert.equal(sandbox.vzPlaylistInfo('<html>not hls</html>').valid,false);
mode='html';result=await get(550,'movie');assert.equal(result.length,0);
assert.ok(calls.some(c=>c.url.includes('/streams/movie/550?')));
assert.ok(!logs.some(l=>l.includes('https://cdn.example/')));
console.log('PASS: exact TV/movie routing, invalid-input guard, server failures isolated, encrypted response diagnosis, Acme language discovery, website server order, headers, master-only result, measured 2160p, media-playlist unknown quality, HTML rejection, subtitles and sanitized logs.');
