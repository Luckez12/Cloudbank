import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),CryptoJS=require('crypto-js');
const source=fs.readFileSync('providers/hdhub4u.js','utf8').split('/* CLOUDBANK_TEST_PLUGIN_SOURCE_START */\n')[1].split('\n/* CLOUDBANK_TEST_PLUGIN_SOURCE_END */')[0];
function load(extra={}){const b={module:{exports:{}},require,console:{log(){},warn(){},error(){}},URL,URLSearchParams,setTimeout,clearTimeout,Promise,Date,atob,btoa,fetch:()=>Promise.reject(Error('offline')),...extra};vm.createContext(b);vm.runInContext(source,b);return b;}
const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio/en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,AUDIO="audio"\nvideo/720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,AUDIO="audio"\nvideo/1080.m3u8';
test('verified HLS master stays intact as Auto with audio groups, HTML rejected despite HLS content type',async()=>{
 const b=load();b.fetchText=async()=>({text:master,url:'https://cdn.test/master.m3u8',headers:{get:()=> 'application/vnd.apple.mpegurl'}});
 const hit=await b.verifyHls('https://cdn.test/master.m3u8','https://hubstream.test/#id');assert.equal(hit.url,'https://cdn.test/master.m3u8');assert.equal(hit.isMaster,true);assert.equal(b.expandResolvedHit(hit).length,1);assert.equal(b.toStream(hit,{title:'Example'},'movie').quality,'Auto');
 b.fetchText=async()=>({text:'<html>Blocked</html>',url:'https://cdn.test/blocked',headers:{get:()=> 'application/vnd.apple.mpegurl'}});assert.equal(await b.verifyHls('https://cdn.test/blocked',''),null);
});
test('same-quality independent servers and header/subtitle variants are retained; exact duplicates removed',()=>{
 const b=load(),a={url:'https://one.test/file.mp4',quality:1080,headers:{Referer:'https://source.test'}},other={...a,url:'https://two.test/file.mp4'},audio={...a,headers:{Referer:'https://other.test'}};
 assert.equal(b.dedupeMovieHits([a,a,other,audio]).length,3);
});
test('V2 Vidstack subtitle behavior is preserved through AES resolution and output without HTTPS downgrade',async()=>{
 const b=load();const iv=CryptoJS.enc.Utf8.parse('1234567890oiuytr'),key=CryptoJS.enc.Utf8.parse('kiemtienmua911ca');
 const payload=JSON.stringify({source:'https://cdn.test/master.m3u8',subtitle:{English:'/subs/en.vtt#label',Hindi:'https://subs.test/hi.vtt'}});
 const encrypted=CryptoJS.AES.encrypt(payload,key,{iv}).ciphertext.toString(CryptoJS.enc.Hex);
 b.fetchText=async url=>url.includes('/api/v1/video')?{text:encrypted}:{text:master,url,headers:{get:()=> 'application/vnd.apple.mpegurl'}};
 const hit=await b.resolveHubstream('https://hubstream.test/#videoid','https://site.test');assert.ok(hit);assert.equal(hit.isMaster,true);assert.ok(hit.url.startsWith('https:'));assert.equal(hit.subtitles.length,2);assert.equal(hit.subtitles[0].url,'https://hubstream.test/subs/en.vtt');assert.equal(hit.headers.Origin,'https://hubstream.test');assert.equal(b.toStream(hit,{title:'Example'},'movie').subtitles.length,2);
});
test('imported Hblinks player hosts are included in dispatch',async()=>{
 const b=load();b.fetchText=async()=>({text:'<div class="entry-content"><a href="https://hubstream.test/#x">Player</a><a href="https://vidstack.test/#y">Player 2</a><a href="https://hdstream4u.test/embed/x">Watch</a></div>',url:'https://hblinks.test/page'});
 let links;b.resolveCandidates=async items=>{links=items;return null;};await b.resolveHblinks('https://hblinks.test/page','');assert.equal(links.length,3);
});
test('domain refresh is cached/coalesced, V2/V3 fallback domains retained, unsafe updater ignored',async()=>{
 const b=load();let calls=0;b.fetchJson=async()=>{calls++;return {HDHUB4u:'https://new3.hdhub4u.free/'};};
 assert.equal((await Promise.all([b.discoverCurrentBase(),b.discoverCurrentBase()]))[0],'https://new3.hdhub4u.free');await b.discoverCurrentBase();assert.equal(calls,1);assert.ok(b.FALLBACK_BASES.includes('https://new6.hdhub4u.cl'));assert.ok(b.FALLBACK_BASES.includes('https://new6.hdhub4u.fo'));
 const c=load();c.fetchJson=async()=>({HDHUB4u:'javascript:alert(1)'});assert.equal(await c.discoverCurrentBase(),null);
});
test('refreshed domain is used for API discovery; stale season candidates are rejected',async()=>{
 const b=load();b.discoverCurrentBase=async()=> 'https://new9.hdhub4u.test';let base;b.searchApi=async(current)=>{base=current;return {base:current,item:{title:'Example',url:current+'/example'}};};await b.findDetail({title:'Example'},'movie',1);assert.equal(base,'https://new9.hdhub4u.test');assert.ok(b.scoreCandidate({title:'Example Season 2'},{title:'Example'},'tv',0)<0);
});
test('HTTP timeout covers stalled response body, not just response headers',async()=>{
 const b=load({fetch:async()=>({ok:true,text:()=>new Promise(()=>{})})});await assert.rejects(b.fetchText('https://site.test',{},10),/timeout/i);
});
test('provider integration preserves season zero and subtitles in returned streams',async()=>{
 const b=load();b.tmdbInfo=async()=>({title:'Example'});b.findDetail=async()=>({base:'https://site.test',item:{title:'Example Season 0',url:'https://site.test/example'}});b.fetchText=async()=>({text:'detail',url:'https://site.test/example'});b.resolveTvPage=async()=>({url:'https://cdn.test/master.m3u8',isHls:true,isMaster:true,headers:{Origin:'https://site.test'},subtitles:[{url:'https://subs.test/en.vtt',language:'en'}]});
 const rows=await b.module.exports.getStreams('123','tv',0,2);assert.equal(rows.length,1);assert.match(rows[0].title,/S00E02/);assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].subtitles.length,1);
});
test('manifest has one HDHub4u and all leading provider-name emoji removed',()=>{
 const m=JSON.parse(fs.readFileSync('manifest.json'));assert.equal(m.scrapers.filter(p=>/^hdhub4u(?:-v\d+)?$/.test(p.id)).length,1);
 for(const p of m.scrapers)assert.ok(!/^[\s\p{Extended_Pictographic}\uFE0F\u200D]/u.test(p.name),p.id);
 assert.equal(m.scrapers.find(p=>p.id==='castle').name,'Castle');
});
