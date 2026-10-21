'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../providers/moviesdrive.js'),'utf8');
const movieMeta={id:740925,title:'No One Gets Out Alive',original_title:'No One Gets Out Alive',release_date:'2021-09-29',original_language:'en',external_ids:{imdb_id:'tt13056008'}};
const tvMeta={id:70824,name:'A Korean Odyssey',original_name:'화유기',first_air_date:'2017-12-23',original_language:'ko',external_ids:{imdb_id:'tt7099334'}};
function load(fetcher,meta=movieMeta){const logs=[],sandbox={module:{exports:{}},require,URL,URLSearchParams,AbortController,Uint8Array,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},MOVIESDRIVE_TEST_MODE:true,VUEO_DISCOVERY_CONTEXT:{tmdb:meta},fetch:fetcher||(()=>{throw Error('Unexpected request');})};vm.runInNewContext(code,sandbox,{timeout:2000});return {provider:sandbox.module.exports,logs};}
const t=load().provider._test;let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
const postMovie='<h1>No One Gets Out Alive (2021) BluRay [Hindi ORG + English]</h1><main><h5>No One Gets Out Alive (2021) [Hindi ORG + English] 480p</h5><h5><a href="https://mdrive.lol/archive/1/">480p</a></h5><h5>No One Gets Out Alive (2021) [Hindi ORG + English] 720p</h5><h5><a href="https://mdrive.lol/archive/2/">720p</a></h5><h5>No One Gets Out Alive (2021) [Hindi ORG + English] 1080p</h5><h5><a href="https://mdrive.lol/archive/3/">1080p</a></h5></main>';
const postTV='<h1>A Korean Odyssey (Season 1) 2017 [Hindi – Korean]</h1><h5>A Korean Odyssey (Season 1) WEB-DL [Hindi – Korean] 720p x265</h5><h5><a href="https://mdrive.lol/archive/4/">720p Single Episode</a></h5><h5><a href="https://mdrive.lol/archive/5/">Zip [6GB]</a></h5>';
const movieArchive='<h1>Menu</h1><h1>No One Gets Out Alive (2021) [Hindi + English] 1080p</h1><h5><a href="https://hubcloud.ist/drive/movie1080">HubCloud</a></h5>';
const tvArchive='<h1>A Korean Odyssey (Season 1) WEB-DL [Hindi – Korean] 720p</h1><h5>EP01 – 720p [485MB]</h5><h5><a href="https://hubcloud.ist/drive/episode1">HubCloud</a></h5><h5>EP02 – 720p [456MB]</h5><h5><a href="https://hubcloud.ist/drive/episode2">HubCloud</a></h5><h5>EP03-04 – 720p</h5><h5><a href="https://hubcloud.ist/drive/pack">HubCloud</a></h5>';
const doc={post_title:'No One Gets Out Alive (2021) [Hindi + English]',permalink:'/movie/',imdb_id:'tt13056008'};
test('exact title/year; never choose unrelated first hit',()=>{assert.equal(t.matchPost(doc,movieMeta,'movie'),true);assert.equal(t.matchPost({...doc,post_title:'Someone Else (2021)',imdb_id:'tt00000'},movieMeta,'movie'),false);assert.equal(t.matchPost({...doc,post_title:'No One Gets Out Alive 2 (2021)',imdb_id:''},movieMeta,'movie'),false);assert.equal(t.matchPost({...doc,post_title:'No One Gets Out Alive (2026)',imdb_id:''},movieMeta,'movie'),false);});
test('series requires requested season',()=>{const d={post_title:'A Korean Odyssey (Season 1) 2017',permalink:'/tv/',imdb_id:'tt7099334'};assert.equal(t.matchPost(d,tvMeta,'tv',1),true);assert.equal(t.matchPost(d,tvMeta,'tv',2),false);assert.equal(t.matchPost(d,tvMeta,'movie'),false);});
test('dual containing original and unknown audio allowed',()=>{assert.equal(t.audioPolicy('[Hindi + English]','en').status,'dual');assert.equal(t.audioPolicy('[Hindi – Korean]','ko').status,'dual');assert.equal(t.audioPolicy('720p','en').status,'unknown');assert.equal(t.audioPolicy('[English Subs]','ko').status,'unknown');assert.equal(t.audioPolicy('[English]','en').status,'original');});
test('dub-only and non-original language lists rejected',()=>{assert.equal(t.audioPolicy('[Hindi]','en').allowed,false);assert.equal(t.audioPolicy('Hindi Dubbed 1080p','en').allowed,false);assert.equal(t.audioPolicy('[Hindi + Tamil]','en').allowed,false);});
test('movie quality blocks linked correctly, minimum 720p',()=>{const rows=t.parsePost(postMovie,'https://new3.moviesdrive.beer/',movieMeta,'movie');assert.equal(rows.length,2);assert.equal(rows[0].quality,1080);assert.equal(rows[0].url,'https://mdrive.lol/archive/3/');assert.equal(rows[1].quality,720);});
test('TV single-episode route chosen; ZIP rejected',()=>{const rows=t.parsePost(postTV,'https://new3.moviesdrive.beer/',tvMeta,'tv',1);assert.equal(rows.length,1);assert.equal(rows[0].url,'https://mdrive.lol/archive/4/');assert.equal(t.parsePost(postTV,'https://new3.moviesdrive.beer/',tvMeta,'tv',2).length,0);});
test('episode boundary distinguishes E01/E02/E10 and packs',()=>{assert.equal(t.episodeValue('EP01 – 720p').episode,1);assert.equal(t.episodeValue('EP10 – 720p').episode,10);assert.equal(t.episodeValue('EP01-03 – 720p'),null);assert.equal(t.episodeValue('Episodes 1-3'),null);assert.equal(t.episodeValue('Season pack'),null);});
test('archive returns only the exact episode host',()=>{const src={quality:720,audio:{status:'dual',languages:['hi','ko']}};let rows=t.parseArchive(tvArchive,'https://mdrive.lol/archive/4/',tvMeta,'tv',1,1,src);assert.equal(rows.length,1);assert.equal(rows[0].url,'https://hubcloud.ist/drive/episode1');assert.equal(t.parseArchive(tvArchive,'https://mdrive.lol/archive/4/',tvMeta,'tv',1,3,src).length,0);assert.equal(t.parseArchive(tvArchive,'https://mdrive.lol/archive/4/',tvMeta,'tv',2,1,src).length,0);});
test('archive identity rechecked',()=>assert.equal(t.parseArchive(movieArchive.replace('No One Gets Out Alive','Wrong Title'),'https://mdrive.lol/archive/3/',movieMeta,'movie',0,0,{quality:1080,audio:{}}).length,0));
test('HubCloud follows the real supplied intermediate URL',()=>{assert.equal(t.hubNext('<a href="https://gamerxyt.com/hubcloud.php?id=opaque&amp;x=1">Download</a>','https://hubcloud.ist/drive/test'),'https://gamerxyt.com/hubcloud.php?id=opaque&x=1');assert.equal(t.hubNext('<script>var url = "https://ads.example/popup";</script>','https://hubcloud.ist/drive/test'),'');});
test('direct storage candidates exclude ad/player/ZIP links',()=>{const rows=t.directLinks('<a href="https://abc.r2.cloudflarestorage.com/bucket/file.mkv?sig=secret">FSL</a><a href="https://ads.example/redirect">Download</a><a href="https://hbplay.pages.dev/?id=x">Play</a><a href="https://abc.r2.cloudflarestorage.com/pack.zip">ZIP</a>','https://gamerxyt.com/hubcloud.php');assert.equal(rows.length,1);assert.equal(rows[0].server,'FSL');});
test('hidden storage and post links ignored',()=>{assert.equal(t.directLinks('<div hidden><a href="https://a.r2.cloudflarestorage.com/file.mkv">FSL</a></div>','https://gamerxyt.com/').length,0);assert.equal(t.parsePost(postMovie.replace('<main>','<main hidden>'),'https://new3.moviesdrive.beer/',movieMeta,'movie').length,0);});
test('H.264 720p precedes HEVC 1080p; HEVC stays available',()=>{
 const rows=t.rank([{quality:1080,codecInfo:t.codecHint('x265 10bit')},{quality:1080,codecInfo:t.codecHint('x265')},{quality:720,codecInfo:t.codecHint('x264')},{quality:1080,codecInfo:t.codecHint('x264')}]);
 assert.equal(rows[0].quality,1080);assert.equal(rows[0].codecInfo.codec,'h264');assert.equal(rows[1].quality,720);assert.equal(rows[2].codecInfo.codec,'hevc');assert.equal(rows[3].codecInfo.bitDepth,10);
});
test('source selection keeps a different quality ahead of duplicate encodes',()=>{
 const rows=t.sourceChoices([{url:'a',quality:1080,codecInfo:t.codecHint('x264')},{url:'b',quality:1080,codecInfo:t.codecHint('x264')},{url:'c',quality:720,codecInfo:t.codecHint('x264')},{url:'d',quality:1080,codecInfo:t.codecHint('HEVC')}]);
 assert.equal(rows[0].url,'a');assert.equal(rows[1].url,'c');assert.equal(rows[2].url,'d');
});
test('codec detection does not invent H.264 for unknown or HEVC',()=>{
 assert.equal(t.codecFromBytes(new Uint8Array(Buffer.from('header V_MPEG4/ISO/AVC trailer'))),'h264');
 assert.equal(t.codecFromBytes(new Uint8Array(Buffer.from('header V_MPEGH/ISO/HEVC trailer'))),'hevc');
 assert.equal(t.codecFromBytes(new Uint8Array([26,69,223,163,1,2,3,4])),'unknown');
 assert.equal(t.codecHint('1080p').codec,'unknown');
});
function response(body,opts={}){return {ok:true,status:opts.status||200,url:opts.url||'',headers:{get:key=>({'content-type':opts.ct||'text/html','content-range':opts.range||'','content-disposition':opts.disposition||''}[key.toLowerCase()]||'')},text:async()=>typeof body==='string'?body:JSON.stringify(body),...(opts.noBinary?{}:{arrayBuffer:async()=>Uint8Array.from(body).buffer})};}
function route(mode,type,calls){return async(u,o)=>{calls.push(u);
 if(u.includes('domains.json'))return response({moviesdrive:'https://new3.moviesdrive.beer'});
 if(u.includes('/search.php'))return response({hits:[{document:{post_title:'Unrelated (2021)',imdb_id:'tt00000',permalink:'/wrong/'}},{document:type==='tv'?{post_title:'A Korean Odyssey (Season 1) 2017',imdb_id:'tt7099334',permalink:'/tv/'}:doc}]});
 if(u.endsWith('/movie/'))return response(postMovie);if(u.endsWith('/tv/'))return response(postTV);
 if(u.includes('/archive/3/'))return response(movieArchive);if(u.includes('/archive/4/'))return response(tvArchive);
 if(u.includes('hubcloud.ist/drive/'))return response('<script>var url = "https://gamerxyt.com/hubcloud.php?id=opaque";</script>');
 if(u.includes('gamerxyt.com/hubcloud.php'))return response('<a href="https://abc.r2.cloudflarestorage.com/file.mkv?signature=secret">Download [FSL Server]</a>');
 if(u.includes('cloudflarestorage.com')){assert.equal(o.headers.Range,'bytes=0-8191');if(mode==='403')return {ok:false,status:403};return response(mode==='bad'?Array.from(Buffer.from('<html>fake')):[26,69,223,163,1,2,3,4],{status:mode==='ignored-range'?200:206,ct:'application/octet-stream',range:'bytes 0-7/1973138950',noBinary:mode==='no-binary'});}
 if(u.includes('/archive/2/'))throw Error('fallback unavailable');throw Error('Unexpected route '+u);
};}
async function run(){
 for(const type of ['movie','tv']){const calls=[],app=load(route('good',type,calls),type==='tv'?tvMeta:movieMeta);const rows=await app.provider.getStreams(type==='tv'?70824:740925,type,1,1);assert.equal(rows.length,1,app.logs.join('\n'));assert.equal(rows[0].audioStatus,'dual');assert.equal(rows[0].quality,type==='tv'?'720p':'1080p');assert.equal(calls.filter(u=>u.includes('/search.php')).length,1);assert.equal(calls.length,type==='tv'?7:8);assert.ok(!app.logs.join('\n').includes('signature=secret'));checks++;console.log('PASS full '+type+' website route uses one engine and validates file');}
 for(const mode of ['403','bad','ignored-range']){const app=load(route(mode,'movie',[]));assert.equal((await app.provider.getStreams(740925,'movie')).length,0);checks++;console.log('PASS media rejection: '+mode);}
 const twoPost=postMovie.replace(/<\/main>/,'<h5>No One Gets Out Alive (2021) [Hindi + English] 1080p HEVC 10bit</h5><h5><a href="https://mdrive.lol/archive/6/">1080p HEVC</a></h5></main>');
 function alternateRouter(mode){const fallback=route('good','movie',[]);return async(u,o)=>{
  if(u.endsWith('/movie/'))return response(twoPost);
  if(u.includes('/archive/')){
   const q=u.includes('/2/')?720:1080;
   if(mode==='partial-error'&&u.includes('/2/'))throw Error('alternate timeout');
   const key=u.includes('/6/')?'hevc1080':q===720?'avc720':'avc1080';
   return response('<h1>Menu</h1><h1>No One Gets Out Alive (2021) [Hindi + English] '+q+'p</h1><h5><a href="https://hubcloud.ist/drive/'+key+'">HubCloud</a></h5>');
  }
  if(u.includes('hubcloud.ist/drive/'))return response('<script>var url = "https://gamerxyt.com/hubcloud.php?file='+u.split('/').pop()+'";</script>');
  if(u.includes('gamerxyt.com/hubcloud.php'))return response('<a href="https://abc.r2.cloudflarestorage.com/'+new URL(u).searchParams.get('file')+'.mkv?signature=secret">FSL</a>');
  if(u.includes('cloudflarestorage.com')){
   const codec=u.includes('hevc')?'V_MPEGH/ISO/HEVC':'V_MPEG4/ISO/AVC';
   const bytes=Uint8Array.from([26,69,223,163,1,2,3,4,...Buffer.from(codec)]);
   return response(bytes,{status:206,ct:'application/octet-stream',range:'bytes 0-'+(bytes.length-1)+'/1973138950'});
  }
  return fallback(u,o);
 };}
 let variants=await load(alternateRouter('good')).provider.getStreams(740925,'movie');
 assert.equal(variants.length,3);assert.equal(variants[0].videoCodec,'h264');assert.equal(variants[0].quality,'1080p');assert.equal(variants[1].quality,'720p');assert.equal(variants[2].videoCodec,'hevc');assert.match(variants[0].name,/H\.264/);assert.match(variants[2].name,/HEVC/);checks++;console.log('PASS validated 1080p/720p H.264 and HEVC alternatives returned with visible codec labels');
 variants=await load(alternateRouter('partial-error')).provider.getStreams(740925,'movie');assert.equal(variants.length,2);assert.equal(variants[0].videoCodec,'h264');checks++;console.log('PASS valid source retained when a later alternate fails');
 let active=0,peak=0;
 const parallelBase=alternateRouter('good');
 const parallelApp=load(async(u,o)=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,15));return await parallelBase(u,o);}finally{active--;}});
 variants=await parallelApp.provider.getStreams(740925,'movie');assert.equal(variants.length,3);assert.equal(peak,3);assert.equal(variants[0].videoCodec,'h264');assert.equal(variants[0].quality,'1080p');assert.equal(variants[1].quality,'720p');assert.ok(parallelApp.logs.some(s=>s.includes('peakRoutes=3')));checks++;console.log('PASS independent source requests overlap with maximum concurrency three');
 const outOfOrderBase=alternateRouter('good');
 const outOfOrder=load(async(u,o)=>{if(u.includes('avc1080'))await new Promise(r=>setTimeout(r,20));return outOfOrderBase(u,o);});
 variants=await outOfOrder.provider.getStreams(740925,'movie');assert.equal(variants.length,3);assert.equal(variants[0].videoCodec,'h264');assert.equal(variants[0].quality,'1080p');assert.equal(variants[2].videoCodec,'hevc');checks++;console.log('PASS completion order does not change H.264/quality priority');
 const fourPost=twoPost.replace(/<\/main>/,'<h5>No One Gets Out Alive (2021) [Hindi + English] 720p HEVC 10bit</h5><h5><a href="https://mdrive.lol/archive/7/">720p HEVC</a></h5></main>');
 let activeFallback=0,fallbackStarted=false;
 const fallbackBase=alternateRouter('partial-error');
 const fourthApp=load(async(u,o)=>{
  if(u.includes('/archive/7/')){assert.equal(activeFallback,0,'fourth route must wait for initial batch');fallbackStarted=true;}
  activeFallback++;
  try{await new Promise(r=>setTimeout(r,5));
   if(u.endsWith('/movie/'))return response(fourPost);
   if(u.includes('/archive/7/'))return response('<h1>No One Gets Out Alive (2021) [Hindi + English] 720p</h1><h5><a href="https://hubcloud.ist/drive/rescue720">HubCloud</a></h5>');
   return await fallbackBase(u,o);
  }finally{activeFallback--;}
 });
 variants=await fourthApp.provider.getStreams(740925,'movie');assert.equal(fallbackStarted,true);assert.equal(variants.length,3);assert.equal(variants[0].videoCodec,'h264');checks++;console.log('PASS fourth route runs only as fallback after initial batch settles');
 let app=load(route('no-binary','movie',[]));assert.equal((await app.provider.getStreams(740925,'movie')).length,1);checks++;console.log('PASS embedded runtime without arrayBuffer uses range and video filename');
 app=load();assert.equal((await app.provider.getStreams('bad','movie')).length,0);assert.equal((await app.provider.getStreams(1,'tv',0,1)).length,0);checks++;console.log('PASS invalid input makes no request');
 console.log(checks+' checks passed. Fixture checks do not confirm VUEO playback.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
