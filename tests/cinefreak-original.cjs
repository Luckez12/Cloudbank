'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../providers/cinefreak.js'),'utf8');
const fixtureMeta = {id:296096,title:'Me Before You',original_title:'Me Before You',release_date:'2016-06-01',original_language:'en'};
function load(fetcher,meta=fixtureMeta) {
  const logs=[],context={module:{exports:{}},require,URL,URLSearchParams,setTimeout,clearTimeout,AbortController,Uint8Array,
    console:{log:(s)=>logs.push(s)},CINEFREAK_TEST_MODE:true,VUEO_DISCOVERY_CONTEXT:{tmdb:meta},fetch:fetcher||(()=>{throw Error('unexpected network');})};
  vm.runInNewContext(source,context,{timeout:2000});
  return {provider:context.module.exports,logs};
}
const {provider:p}=load();const t=p._test;
const original='https://new5.cinecloud.site/f/original720',dub='https://new5.cinecloud.site/f/dub1080';
const movie=`<h1>Me Before You (2016) English BluRay</h1><div class="download-links-div">
<div aria-hidden="true"><h4 class="movie-title">Me Before You (2016) <span>[English]</span> 1080p</h4><div class="dlbtn-container"><a class="dlbtn-download" href="https://new5.cinecloud.site/f/hidden">Download</a></div></div>
<h4 class="movie-title">Me Before You (2016) <span>[English]</span> 480p</h4><div class="dlbtn-container"><a class="dlbtn-download" href="https://new5.cinecloud.site/f/low">Download</a></div>
<h4 class="movie-title">Me Before You (2016) <span>[English]</span> 720p</h4><div class="dlbtn-container"><a class="dlbtn-download" href="${original}">Download</a></div>
<h4 class="movie-title">Me Before You (2016) <span>[Hindi & English] Dual Audio</span> 1080p</h4><div class="dlbtn-container"><a class="dlbtn-download" href="${dub}">Download</a></div></div>`;
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('original English accepted',()=>assert.equal(t.originalOnly('[English]','en'),true));
test('explicit non-original dub rejected; dual and unknown accepted',()=>{
 for(const s of ['[Hindi]','[Japanese]','Hindi Dubbed','Dubbed'])assert.equal(t.originalOnly(s,'en'),false,s);
 assert.equal(t.originalOnly('[English]','ja'),false);
 assert.equal(t.originalOnly('[English]','xx'),true);
 for(const label of ['[Hindi & English]','English Dual Audio','Unknown','', 'Dual Audio'])assert.equal(t.originalOnly(label,'en'),true,label);
 assert.equal(t.originalOnly('[Hindi & Tamil]','en'),false);
 assert.equal(t.audioPolicy('Unknown','en').status,'unknown');
 assert.equal(t.audioPolicy('[Hindi & English]','en').status,'dual');
});
test('native Hindi accepted for a Hindi-original request',()=>assert.equal(t.originalOnly('[Hindi]','hi'),true));
test('exact title and year; no sequel fallback',()=>{
 assert.equal(t.matchedTitle('Me Before You (2016) English',fixtureMeta),true);
 assert.equal(t.matchedTitle('Me Before You 2 (2016)',fixtureMeta),false);
 assert.equal(t.matchedTitle('Me Before You (2020)',fixtureMeta),false);
});
test('movie rejects hidden and 480p, accepts dual containing original',()=>{
 const rows=t.extractFiles(movie,'en','movie');assert.equal(rows.length,2);assert.equal(rows[0].url,dub);assert.equal(rows[0].audioStatus,'dual');assert.equal(rows[1].url,original);assert.equal(rows[1].quality,720);
});
test('unknown file labels remain unknown, never relabelled original',()=>{
 const html=movie.replace(/\[English\]/g,'[Unknown]').replace(/\[Hindi & English\] Dual Audio/g,'[Unknown]');
 const rows=t.extractFiles(html,'en','movie');assert.equal(rows.length,2);
 assert.ok(rows.every(r=>r.audioStatus==='unknown'&&r.language===''&&r.audioLanguages.length===0));
});
test('episode and season exact; ranges/packs refused',()=>{
 assert.equal(t.episodeKey('es02e03',2,3),true);
 for(const k of ['es01e03','es02e04','ps02e01-03','es02e01-03','es02e03.zip'])assert.equal(t.episodeKey(k,2,3),false);
 const cards=`<div class="cft-it" data-k="es02e03"><span class="cft-meta">English BluRay</span><div class="cft-qs"><a class="cfs-dl" href="${original}">720p</a></div></div><div class="cft-it" data-k="ps02e01-03"><span class="cft-meta">English</span><div class="cft-qs"><a class="cfs-dl" href="${dub}">1080p</a></div></div>`;
 assert.equal(t.extractFiles(cards,'en','tv',2,3).length,1);assert.equal(t.extractFiles(cards,'en','tv',1,3).length,0);
});
test('HTML/embed/archive are not returned as direct files',()=>{
 const d=t.extractDirect('<a href="https://ads.invalid/player">ad</a><a id="fsl" href="https://files.example/movie.mkv?a=1&amp;b=2">File</a><a href="https://files.example/pack.zip">Pack</a>','https://new5.cinecloud.site/f/test');
 assert.equal(d.length,1);assert.match(d[0],/a=1&b=2/);
 assert.equal(t.isMagic(new Uint8Array([0x1a,0x45,0xdf,0xa3,1,2,3,4])),true);
 assert.equal(t.isMagic(new Uint8Array(Buffer.from('<html>fake'))),false);
});
function response(body,opts={}) {
 return {ok:true,status:opts.status||200,url:opts.url||'',headers:{get:(key)=>({'content-type':opts.ct||'text/html','content-range':opts.range||'','content-length':opts.length||''}[key.toLowerCase()]||'')},text:async()=>typeof body==='string'?body:JSON.stringify(body),arrayBuffer:async()=>Uint8Array.from(body).buffer};
}
async function run(){
 let calls=[];
 const search={results:[{t:'Me Before You (2016) English BluRay',l:'me-before-you-2016-full-movie-download'}]};
 function router(u,opts){
  calls.push({u,opts});
  if(u.includes('search-api.php'))return response(search);
  if(u.includes('full-movie-download'))return response(movie);
  if(u===dub)return {ok:false,status:403,headers:{get:()=>''}};
  if(u===original)return response('<a id="fsl" href="https://files.example/movie.mkv">File</a>');
  if(u==='https://files.example/movie.mkv'){
   assert.equal(opts.headers.Range,'bytes=0-1023');
   return response([0x1a,0x45,0xdf,0xa3,1,2,3,4],{status:206,ct:'video/x-matroska',range:'bytes 0-7/900000000',length:'8'});
  }
  throw Error('Unexpected URL '+u);
 }
 let app=load(async(u,o)=>router(u,o));let streams=await app.provider.getStreams('296096','movie');
 assert.equal(streams.length,1);assert.equal(streams[0].url,'https://files.example/movie.mkv');assert.equal(streams[0].language,'en');assert.equal(calls.length,5);checks++;console.log('PASS complete eligible-audio discovery and bounded file probe');
 calls=[];app=load(async(u,o)=>u===original?{ok:false,status:403,headers:{get:()=>''}}:router(u,o));streams=await app.provider.getStreams('296096','movie');assert.equal(streams.length,0);assert.ok(app.logs.some(s=>s.includes('HTTP 403')));checks++;console.log('PASS host 403 returns no source');
 app=load(async(u,o)=>u==='https://files.example/movie.mkv'?response([],{status:200,ct:'video/x-matroska'}):router(u,o));streams=await app.provider.getStreams('296096','movie');assert.equal(streams.length,0);checks++;console.log('PASS server ignoring Range rejected before reading body');
 app=load();assert.equal((await app.provider.getStreams('296096','tv',1,0)).length,0);assert.equal((await app.provider.getStreams('bad','movie')).length,0);checks++;console.log('PASS invalid request makes no network calls');
 console.log(`${checks} checks passed. Fixture tests do not confirm live playback.`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
