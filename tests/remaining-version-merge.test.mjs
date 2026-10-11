import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const report=JSON.parse(fs.readFileSync('docs/remaining-version-merge.json'));
const manifest=JSON.parse(fs.readFileSync('manifest.json'));
const registeredIds=new Set(manifest.scrapers.map(provider=>provider.id));
const activeGroups=report.groups.filter(group=>registeredIds.has(group.id));
function load(id, overrides={}) {
 const box={module:{exports:{}},require,console:{log(){},warn(){},error(){}},URL,URLSearchParams,Promise,setTimeout,clearTimeout,atob,btoa,Buffer,fetch:()=>Promise.reject(Error('offline')),...overrides};box.global=box;box.globalThis=box;vm.createContext(box);vm.runInContext(fs.readFileSync('providers/'+id+'.js','utf8'),box,{timeout:2000});return box;
}
for(const group of activeGroups){
 test(group.id+': embedded cores match audited sources, ordinary ID and fast primary retained',async()=>{
  const s=fs.readFileSync(group.filename,'utf8');assert.equal(crypto.createHash('sha256').update(s).digest('hex'),group.mergedFileSha256);for(const e of group.engines){const core=s.split('/* CLOUDBANK_MERGED_ENGINE_START:'+e.id+' */\n')[1].split('\n/* CLOUDBANK_MERGED_ENGINE_END:'+e.id+' */')[0];assert.equal(crypto.createHash('sha256').update(core).digest('hex'),e.sourceSha256);}
  const b=load(group.id);let calls=0;for(const e of b.cloudbankMergedEngines.slice(1))e.provider.getStreams=async()=>{calls++;return [{url:'https://alt.test/file.mp4'}];};
  b.cloudbankMergedEngines[0].provider.getStreams=async()=>[{name:'Primary',url:'https://cdn.test/master.m3u8',headers:{Origin:'https://origin.test'},subtitles:[{url:'https://subs.test/en.vtt'}]}];
  const rows=await b.module.exports.getStreams(123,'movie');assert.equal(rows.length,1);assert.equal(rows[0].provider,group.id);assert.equal(rows[0].headers.Origin,'https://origin.test');assert.equal(rows[0].subtitles.length,1);assert.equal(calls,0);
  assert.equal((await b.module.exports.getStreams('','movie')).length,0);assert.equal((await b.module.exports.getStreams('123','tv',1,0)).length,0);
 });
}
test('failed primary invokes alternate immediately and preserves extended arguments/episode zero',async()=>{
 const b=load('allmovieland');let received;b.cloudbankMergedEngines[0].provider.getStreams=async()=>{throw Error('primary failed');};b.cloudbankMergedEngines[1].provider.getStreams=async(...args)=>{received=args;return [{url:'https://alt.test/a.m3u8',name:'Alt',headers:{Referer:'https://embed.test'},subtitles:[{url:'https://subs.test/en.vtt'}]},{url:'javascript:alert(1)'}];};
 const rows=await b.module.exports.getStreams('123','series','0','2',{choice:'dub'});assert.equal(rows.length,1);assert.deepEqual(received,['123','tv',0,2,{choice:'dub'}]);assert.equal(rows[0].headers.Referer,'https://embed.test');assert.equal(rows[0].subtitles.length,1);
});
function fakeTimers(){const entries=[];return {entries,setTimeout(fn,ms){const e={fn,ms,cleared:false};entries.push(e);return e;},clearTimeout(e){if(e)e.cleared=true;},fire(ms){const e=entries.find(e=>e.ms===ms&&!e.cleared);assert.ok(e,'timer '+ms);e.fn();}};}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
test('slow-primary fallback retains distinct audio and completed results, late changes cannot mutate output',async()=>{
 const t=fakeTimers(),b=load('allmovieland',{setTimeout:t.setTimeout,clearTimeout:t.clearTimeout});let complete;
 const stream={name:'Sub',url:'https://cdn.test/master.m3u8',headers:{Referer:'https://embed.test'},subtitles:[{url:'https://subs.test/en.vtt'}]};
 b.cloudbankMergedEngines[0].provider.getStreams=()=>new Promise(r=>{complete=r;});b.cloudbankMergedEngines[1].provider.getStreams=async()=>[stream,stream,{...stream,name:'Dub'}];
 const pending=b.module.exports.getStreams('123','movie');await flush();t.fire(5000);await flush();t.fire(18500);const rows=await pending;assert.equal(rows.length,2);complete([{url:'https://late.test/late.mp4'}]);await flush();assert.equal(rows.length,2);
});
test('primary and already-completed alternate results combine when primary completes',async()=>{
 const t=fakeTimers(),b=load('allmovieland',{setTimeout:t.setTimeout,clearTimeout:t.clearTimeout});let complete;b.cloudbankMergedEngines[0].provider.getStreams=()=>new Promise(r=>{complete=r;});b.cloudbankMergedEngines[1].provider.getStreams=async()=>[{name:'Other',url:'https://other.test/movie.mp4'}];const pending=b.module.exports.getStreams('123','movie');await flush();t.fire(5000);await flush();complete([{name:'Primary',url:'https://primary.test/movie.mp4'}]);assert.equal((await pending).length,2);
});
test('MovieBox V3 remains a later fallback when both preceding engines fail',async()=>{
 const b=load('moviebox');b.cloudbankMergedEngines[0].provider.getStreams=async()=>[];b.cloudbankMergedEngines[1].provider.getStreams=async()=>[];b.cloudbankMergedEngines[2].provider.getStreams=async()=>[{url:'https://v3.test/movie.mp4'}];assert.equal((await b.module.exports.getStreams('123','movie'))[0].url,'https://v3.test/movie.mp4');
});
test('Videasy disabled alternate remains inactive; NetMirror alternate iOS restriction retained',async()=>{
 const v=load('videasy');let calls=0;v.cloudbankMergedEngines[0].provider.getStreams=async()=>[];v.cloudbankMergedEngines[1].provider.getStreams=async()=>{calls++;return [{url:'https://disabled.test/file.mp4'}];};assert.equal((await v.module.exports.getStreams('123','movie')).length,0);assert.equal(calls,0);
 const n=load('netmirror');n.cloudbankMergedEngines[0].provider.getStreams=async()=>[];n.cloudbankMergedEngines[1].provider.getStreams=async()=>{calls++;return [{url:'https://newtv.test/file.mp4'}];};assert.equal((await n.module.exports.getStreams('123','movie')).length,0);assert.equal((await n.module.exports.getStreams('123','movie',null,null,{platform:'ios'})).length,0);assert.equal(calls,0);assert.equal((await n.module.exports.getStreams('123','movie',null,null,{platform:'android'})).length,1);
});
test('settings preserve primary defaults, deduplicate keys and combine alternate options',async()=>{
 const b=load('allmovieland');b.cloudbankMergedEngines[0].provider.onSettings=async()=>[{type:'select',key:'domain',defaultValue:'primary',options:[{value:'primary',label:'Primary'}]}];b.cloudbankMergedEngines[1].provider.onSettings=async()=>[{type:'select',key:'domain',defaultValue:'alternate',options:[{value:'primary',label:'Primary'},{value:'alternate',label:'Alternate'}]},{type:'toggle',key:'extra',defaultValue:true}];const merged=b.cloudbankVersionMerge(b.cloudbankMergedEngines,'allmovieland');const rows=await merged.onSettings();assert.equal(rows.filter(r=>r.key==='domain').length,1);assert.equal(rows.find(r=>r.key==='domain').defaultValue,'primary');assert.equal(rows.find(r=>r.key==='domain').options.length,2);assert.ok(rows.find(r=>r.key==='extra'));
});
test('metadata adapter retains shared context and rejects stale title contexts',async()=>{
 const b=load('allmovieland');let calls=0;b.vueoSharedTmdb=async()=>({id:123,title:'Example'});const wrapped=b.cloudbankMergedMetadataFetch(async()=>{calls++;return {ok:true,json:async()=>({id:999,title:'Other'})};});assert.equal((await (await wrapped('https://api.themoviedb.org/3/movie/123')).json()).title,'Example');assert.equal(calls,0);b.VUEO_DISCOVERY_CONTEXT={tmdbId:999};assert.equal((await (await wrapped('https://api.themoviedb.org/3/movie/123')).json()).title,'Other');assert.equal(calls,1);
});
test('manifest contains no standalone version IDs and all retired files are listed for manual deletion',()=>{const m=JSON.parse(fs.readFileSync('manifest.json'));assert.equal(m.scrapers.length,59);assert.ok(!m.scrapers.some(p=>/-v\d+$/.test(p.id)));assert.equal(report.groups.length,16);assert.equal(report.groups.flatMap(g=>g.engines).length,17);});

test('expired alternate scopes start no fetches or body reads',async()=>{
 const b=load('allmovieland');let calls=0;
 const expired=b.cloudbankMergedBudgetFetch(async()=>{calls++;return {};},Date.now()-1);
 await assert.rejects(expired('https://cdn.test/file'),/budget exhausted/);assert.equal(calls,0);
 const request=b.cloudbankMergedBudgetFetch(async()=>({ok:true,status:200,json:async()=>{calls++;return {};}}),Date.now()+1000);
 const response=await request('https://cdn.test/file');const oldDate=b.Date;
 b.Date={now:()=>Date.now()+2000};await assert.rejects(response.json(),/budget exhausted/);assert.equal(calls,0);b.Date=oldDate;
});
test('stalled alternate response bodies time out within request budget',async()=>{
 const t=fakeTimers(),b=load('allmovieland',{setTimeout:t.setTimeout,clearTimeout:t.clearTimeout});
 const request=b.cloudbankMergedBudgetFetch(async()=>({ok:true,status:200,text:()=>new Promise(()=>{})}),Date.now()+6000);
 const response=await request('https://cdn.test/file');const body=response.text();await flush();t.fire(2200);await assert.rejects(body,/request timeout/);
});
test('primary magnet streams survive consolidation',async()=>{
 const b=load('allmovieland');b.cloudbankMergedEngines[0].provider.getStreams=async()=>[{name:'Torrent',url:'magnet:?xt=urn:btih:123'}];
 assert.equal((await b.module.exports.getStreams('123','movie'))[0].url,'magnet:?xt=urn:btih:123');
});
