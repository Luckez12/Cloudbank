import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const source=fs.readFileSync('providers/4khdhub.js','utf8').split('/* CLOUDBANK_TEST_PLUGIN_SOURCE_START */\n')[1].split('\n/* CLOUDBANK_TEST_PLUGIN_SOURCE_END */')[0];
function load(extra={}){const box={module:{exports:{}},require,URL,URLSearchParams,setTimeout,clearTimeout,Promise,Date,atob,btoa,console:{log(){},error(){}},fetch:()=>Promise.reject(Error('Offline')),...extra};vm.createContext(box);vm.runInContext(source,box);return box;}
test('nested V2 Hblinks and hubstream.dad route resolves with depth limit',async()=>{
 const b=load();const pages={'https://hubstream.dad/a':'<a href="https://hblinks.test/b">next</a>','https://hblinks.test/b':'<a href="https://hubcloud.test/c">cloud</a>'};
 b.fetchText=async u=>pages[u]||'';b.resolveHubCloud=async()=>({url:'https://cdn.test/file.mp4',label:'Cloud'});
 assert.equal((await b.resolveServer('https://hubstream.dad/a','')).url,'https://cdn.test/file.mp4');assert.equal(await b.resolveHblinks('https://hubstream.dad/a','',3),null);
 b.fetchText=async u=>u==='https://hubstream.dad/a'?'<a href="https://hblinks.test/b">b</a>':'<a href="https://hubstream.dad/a">a</a>';assert.equal(await b.resolveHblinks('https://hubstream.dad/a',''),null);
});
test('independent same-quality servers survive, workers capped at three, failure isolated',async()=>{
 const b=load();let active=0,peak=0;b.resolveServer=async u=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;if(u.includes('bad'))throw Error('failed');return {url:u,headers:{Origin:'https://embed.test'}};};
 const rows=await b.resolveBlocks([{quality:'1080p',text:'1080p',links:['https://one.test/f.mp4','https://two.test/f.mp4','https://bad.test/f.mp4','https://three.test/f.mp4']}],'https://detail.test');assert.equal(rows.length,3);assert.equal(peak,3);assert.ok(rows.every(r=>r.headers.Origin==='https://embed.test'));
});
test('verified master is returned once as Auto, duplicate quality buttons do not duplicate it',async()=>{
 const b=load();b.fetchResp=async u=>({text:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080\nvideo.m3u8',url:u});
 const rows=await b.resolveBlocks([{quality:'2160p',links:['https://cdn.test/master.m3u8']},{quality:'1080p',links:['https://cdn.test/master.m3u8']}],'https://embed.test');assert.equal(rows.length,1);assert.equal(rows[0].url,'https://cdn.test/master.m3u8');assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].headers.Origin,'https://embed.test');
 b.fetchResp=async()=>({text:'<html>blocked</html>'});assert.equal(await b.verifyFourKHls('https://cdn.test/master.m3u8',''),null);
});
test('early completed sources survive a slow source at the collection deadline',async()=>{
 const b=load();b.resolveServer=async u=>u.includes('slow')?new Promise(()=>{}):{url:u};const rows=await b.resolveBlocks([{quality:'720p',links:['https://fast.test/video.mp4','https://slow.test/video.mp4']}],'https://detail.test',Date.now()+20);assert.equal(rows.length,1);assert.equal(rows[0].url,'https://fast.test/video.mp4');
});
test('quality groups remain represented within eight-candidate limit',async()=>{
 const b=load();b.resolveServer=async u=>({url:u});const rows=await b.resolveBlocks([{quality:'2160p',links:Array.from({length:9},(_,i)=>'https://fourk.test/'+i+'.mp4')},{quality:'720p',links:['https://720.test/video.mp4']}],'https://detail.test');assert.equal(rows.length,8);assert.ok(rows.some(r=>r.quality==='720p'));
});
test('body reads are bounded and domain refresh uses cached/coalesced current domain',async()=>{
 const b=load({fetch:async()=>({ok:true,text:()=>new Promise(()=>{})})});await assert.rejects(b.fourKBounded(()=>b.fetchResp('https://site.test'),10),/timeout/);
 const c=load();let calls=0;c.fetchJson=async()=>{calls++;return {'4khdhub':'https://4khdhub.one/'};};await Promise.all([c.latestFourKDomain(),c.latestFourKDomain()]);await c.latestFourKDomain();assert.equal(calls,1);
 c.fetchText=async u=>{assert.ok(u.startsWith('https://4khdhub.one/'));return '<a class="movie-card" href="/example"><span class="movie-card-title">Example</span><span class="movie-card-format">Movies</span><span class="movie-card-meta">2026</span></a>';};assert.ok(await c.findDetail({title:'Example',year:2026},'movie'));
});
test('movie fallback recognizes V2 Hblinks-only pages and metadata fields are preserved',()=>{
 const b=load();assert.equal(b.parseMovieBlocks('<a href="https://hubstream.dad/a">server</a>','https://detail.test').length,1);
 const row=b.buildStream({url:'https://cdn.test/v.mp4',headers:{Origin:'https://source.test'},subtitles:[{url:'https://subs.test/en.vtt'}]},'720p','https://detail.test');assert.equal(row.subtitles.length,1);assert.equal(row.headers.Origin,'https://source.test');
});
test('manifest has one 4KHDHub and retains name cleanup',()=>{const m=JSON.parse(fs.readFileSync('manifest.json'));assert.equal(m.scrapers.filter(p=>/^4khdhub(?:-v\d+)?$/.test(p.id)).length,1);assert.equal(m.scrapers.find(p=>p.id==='castle').name,'Castle');});
