import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const report=JSON.parse(fs.readFileSync('docs/test-plugin-adaptation.json'));
function load(id, fetch) {
 const sandbox={module:{exports:{}},require,console:{log(){},error(){},warn(){}},fetch,Promise,URL,URLSearchParams,setTimeout,clearTimeout,atob,btoa,
 VUEO_DISCOVERY_CONTEXT:{tmdbId:123,mediaType:'movie',title:'Example',year:'2026',tmdb:{id:123,title:'Example',release_date:'2026-01-01'}}};
 sandbox.global=sandbox; sandbox.globalThis=sandbox;
 vm.runInNewContext(fs.readFileSync('providers/'+id+'.js','utf8'),sandbox);
 return sandbox;
}
for(const entry of report.providers) {
 test(entry.id+': transferred source integrity and original fallback retained',async()=>{
 const s=fs.readFileSync('providers/'+entry.id+'.js','utf8');
 const core=s.split('/* CLOUDBANK_TEST_PLUGIN_SOURCE_START */\n')[1].split('\n/* CLOUDBANK_TEST_PLUGIN_SOURCE_END */')[0];
 assert.equal(crypto.createHash('sha256').update(core).digest('hex'),entry.adaptedSourceSha256 || entry.sourceSha256);
 const box=load(entry.id,()=>Promise.reject(Error('Offline')));
 assert.equal(typeof box.cloudbankLegacyProvider.getStreams,'function');
 assert.equal(typeof box.cloudbankTestPluginProvider.getStreams,'function');
 let primary=0,legacy=0;
 box.cloudbankTestPluginProvider.getStreams=async()=>{primary++;return [{url:'https://cdn.test/master.m3u8',headers:{Origin:'https://origin.test/'},subtitles:[{url:'https://cdn.test/en.vtt'}]}];};
 box.cloudbankLegacyProvider.getStreams=async()=>{legacy++;return [{url:'https://cdn.test/fallback.mp4'}];};
 const out=await box.module.exports.getStreams('123','movie');
 assert.equal(out[0].url,'https://cdn.test/master.m3u8');assert.equal(out[0].headers.Origin,'https://origin.test/');assert.equal(out[0].subtitles.length,1);assert.equal(legacy,0);
 box.cloudbankTestPluginProvider.getStreams=async()=>[];
 assert.equal((await box.module.exports.getStreams('123','movie'))[0].url,'https://cdn.test/fallback.mp4');assert.equal(legacy,1);
 box.cloudbankTestPluginProvider.getStreams=async()=>{throw Error('Primary failed');};
 assert.equal((await box.module.exports.getStreams('123','movie'))[0].url,'https://cdn.test/fallback.mp4');
 assert.equal((await box.module.exports.getStreams('','movie')).length,0);
 assert.equal((await box.module.exports.getStreams('123','tv',1,0)).length,0);
 });
}
test('KissKH adapted public provider reuses matching shared metadata and direct source',async()=>{
 const calls=[];
 const box=load('kisskh',async url=>{
 calls.push(url);
 let data;
 if(url.includes('themoviedb')) throw Error('Shared metadata should avoid TMDB');
 if(url.includes('/DramaList/Search'))data=[{id:22,title:'Example',year:2026,type:'movie'}];
 else if(url.includes('/DramaList/Drama/22'))data={id:22,title:'Example',releaseDate:'2026-01-01',type:'movie',episodes:[{id:220,number:1}]};
 else if(url.includes('script.google.com'))data={key:'fixture-key'};
 else if(url.includes('/DramaList/Episode/220.png'))data={Video:'https://cdn.test/master.m3u8'};
 else throw Error('Unexpected '+url);
 return {ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)};
 });
 const out=await box.module.exports.getStreams('123','movie');assert.equal(out.length,1);assert.equal(out[0].url,'https://cdn.test/master.m3u8');assert.equal(calls.some(u=>u.includes('themoviedb')),false);
});

test('HDHub4u transferred discovery rejects an explicit wrong season',()=>{
 const s=fs.readFileSync('providers/hdhub4u.js','utf8');
 const core=s.split('/* CLOUDBANK_TEST_PLUGIN_SOURCE_START */\n')[1].split('\n/* CLOUDBANK_TEST_PLUGIN_SOURCE_END */')[0];
 const box={module:{exports:{}},require,console:{log(){}},URL,Promise,setTimeout,clearTimeout};
 vm.runInNewContext(core+'\nmodule.exports = { scoreCandidate, bestSearchResult };',box);
 const info={title:'Example',aliases:['Example'],year:2026};
 const wrong={title:'Example Season 8',year:2026};
 assert.ok(box.module.exports.scoreCandidate(wrong,info,'tv',1)<0);
 assert.equal(box.module.exports.bestSearchResult([wrong],info,'tv',1),null);
});

test('transferred MSM21, PencuriMovie and KissKH reference regressions',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {default:path}=await import('node:path');
 const temp=fs.mkdtempSync(path.join(process.cwd(),'.test-plugin-qa-'));
 try {
  fs.mkdirSync(path.join(temp,'providers'));fs.mkdirSync(path.join(temp,'tests'));
  fs.writeFileSync(path.join(temp,'package.json'),'{"type":"commonjs"}');
  for(const entry of report.providers) {
   const s=fs.readFileSync('providers/'+entry.id+'.js','utf8');
   const core=s.split('/* CLOUDBANK_TEST_PLUGIN_SOURCE_START */\n')[1].split('\n/* CLOUDBANK_TEST_PLUGIN_SOURCE_END */')[0];
   fs.writeFileSync(path.join(temp,'providers',entry.id+'.js'),core);
  }
  for(const name of ['test-msm21-playerx-race.js','test-pencurimovie-extraction.js','test-pencurimovie-selection.js','test-kisskh-regression.js']) {
   const file=path.join(temp,'tests',name);
   fs.copyFileSync(path.join('tests/fixtures/test-plugin-regressions',name),file);
   const output=execFileSync(process.execPath,[file],{encoding:'utf8',timeout:15000});
   assert.match(output,/passed/i);
  }
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
