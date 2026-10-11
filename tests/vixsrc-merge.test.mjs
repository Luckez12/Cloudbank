import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=fs.readFileSync('providers/vixsrc.js','utf8').split('/* CLOUDBANK_UPSTREAM_SOURCE_START */\n')[1].split('\n/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0];
function load(extra={}){const box={module:{exports:{}},console:{log(){}},URL,setTimeout,clearTimeout,Date,fetch:()=>Promise.reject(Error('Offline')),...extra};vm.createContext(box);vm.runInContext(source,box);return box;}
const page='https://vixsrc.to/embed/10';
const html=`<script>const ad={url:'https://ads.invalid/ad'}; window.masterPlaylist = { params: { "token": "a+b/=&", "expires": 1799999999 }, "url": "/playlist/10?edge=sc1&b=1" };</script>`;
test('scoped parser preserves query and extensionless path, encodes signed parameters once',()=>{
 const b=load(),u=new URL(b.vixsrcExtract(html,page));assert.equal(u.origin,'https://vixsrc.to');assert.equal(u.pathname,'/playlist/10');assert.equal(u.searchParams.get('edge'),'sc1');assert.equal(u.searchParams.get('b'),'1');assert.equal(u.searchParams.get('token'),'a+b/=&');assert.equal(u.searchParams.get('expires'),'1799999999');assert.equal(u.searchParams.get('h'),'1');assert.equal(u.searchParams.get('lang'),'en');
});
test('single quotes, escaped values, existing tokens and direct M3U8 fallback',()=>{
 const b=load();const u=new URL(b.vixsrcExtract(`window.masterPlaylist={url:'https:\\/\\/cdn.invalid/playlist/1?b=1',token:'abc\\u002bdef',expires:'123'};`,page));assert.equal(u.searchParams.get('token'),'abc+def');
 assert.ok(b.vixsrcExtract(`window.masterPlaylist={url:'/playlist/1?token=x&expires=12'};`,page));
 assert.equal(b.vixsrcExtract(`<script>const src='https://cdn.invalid/master.m3u8?x=1&amp;y=2'</script>`,page),'https://cdn.invalid/master.m3u8?x=1&y=2');
 assert.equal(b.vixsrcExtract(`<script>window.masterPlaylist={url:'/playlist/1',token:'x'};</script>`,page),null);
 assert.equal(b.vixsrcExtract(`<script>window.masterPlaylist={url:'javascript:bad',token:'x',expires:123};</script>`,page),null);
});
function response(body,url,json=false){return {ok:true,url,text:async()=>body,json:async()=>body};}
test('official API follows relative embed, validates HLS and attaches English subtitles',async()=>{
 const calls=[];const b=load({fetch:async(u,o)=>{calls.push({u,o});if(u==='https://vixsrc.to/movie/550')return response('<html>No payload</html>',u);if(u.includes('/api/movie/550'))return response({src:'/embed/10'},u,true);if(u===page)return response(html,u);if(u.includes('/playlist/10'))return response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/variant?type=video',u);if(u.includes('sub.wyzie'))return response([{url:'https://subs.invalid/en.srt',display:'English',encoding:'UTF-8'}],u,true);throw Error('unexpected '+u);}});
 const rows=await b.module.exports.getStreams('550','movie');assert.equal(rows.length,1);assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].subtitles[0].language,'en');assert.equal(rows[0].headers.Referer,page);assert.equal(rows[0].headers.Origin,'https://vixsrc.to');assert.ok(calls.some(x=>x.u.includes('themoviedb')));assert.ok(!calls.some(x=>x.u.includes('komiknostalgia')));
});
test('direct route supports TV season zero and optional subtitle failure preserves master',async()=>{
 const calls=[];const b=load({fetch:async(u)=>{calls.push(u);if(u.includes('/tv/123/0/2'))return response(html,u);if(u.includes('/playlist/'))return response('#EXTM3U\n#EXT-X-VERSION:3',u);throw Error('subtitle offline');}});
 assert.equal((await b.module.exports.getStreams('123','tv',0,2)).length,1);assert.ok(calls.includes('https://vixsrc.to/tv/123/0/2'));assert.equal(calls.find(u=>u.startsWith('https://vixsrc.to')),'https://vixsrc.to/api/tv/123/0/2');
});
test('HTML instead of HLS is rejected, original custom-domain API remains fallback',async()=>{
 const b=load({fetch:async(u)=>{if(u.startsWith('https://vixsrc.to/api'))throw Error('API offline');if(u.startsWith('https://vixsrc.to/movie'))return response(html,u);if(u.startsWith('https://vixsrc.to/playlist'))return response('<html>Access denied</html>',u);if(u.startsWith('https://komiknostalgia.id/api'))return response({src:'https://mirror.invalid/embed/10'},u,true);if(u.startsWith('https://mirror.invalid/embed'))return response(html.replace('/playlist/10','https://mirror.invalid/playlist/10'),u);if(u.startsWith('https://mirror.invalid/playlist'))return response('#EXTM3U\n#EXT-X-VERSION:3',u);throw Error('no subtitles');}});
 const rows=await b.module.exports.getStreams('550','movie');assert.equal(rows.length,1);assert.equal(rows[0].headers.Origin,'https://mirror.invalid');
});
test('all extraction routes failing returns no link, stalled reads are bounded',async()=>{const b=load();assert.equal((await b.module.exports.getStreams('550','movie')).length,0);await assert.rejects(b.vixsrcBounded(()=>new Promise(()=>{}),10),/timed out/);});
