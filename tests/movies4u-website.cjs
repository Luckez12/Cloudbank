'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../providers/movies4u.js'),'utf8'),fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/movies4u/'+n),'utf8');
const movie={title:'Bad Apples',release_date:'2025-01-01',original_language:'en',external_ids:{imdb_id:'tt29714073'}},tv={name:'Love in Disguise',first_air_date:'2026-01-01',original_language:'ko',external_ids:{imdb_id:'tt45246384'}};
function load(fetch,meta=movie){const logs=[],ctx={module:{exports:{}},require,fetch,URL,URLSearchParams,AbortController,Uint8Array,setTimeout,clearTimeout,MOVIES4U_TEST_MODE:true,VUEO_DISCOVERY_CONTEXT:{tmdb:meta},console:{log:s=>logs.push(s)}};vm.runInNewContext(code,ctx);return {p:ctx.module.exports,logs};}
const t=load().p._test,$lib=require('cheerio-without-node-native');let count=0;function check(name,f){f();count++;console.log('PASS '+name);}
const post=fixture('post.html'),links=fixture('links.html'),tvpost=fixture('tv.html'),tvlinks=fixture('tvlinks.html');
const sources=t.parsePost(post,'https://new2.movies4u.garden/',movie,'movie'),tvsrc=t.parsePost(tvpost,'https://new2.movies4u.garden/',tv,'tv',1);
check('real movie page deduplicates shared links page',()=>assert.equal(sources.length,1));
check('IMDb confirms website year mismatch',()=>{assert.equal(sources[0].postYear,'2026');assert.equal(t.parsePost(post,'https://new2.movies4u.garden/',{...movie,external_ids:{imdb_id:'tt99999'}},'movie').length,0);assert.equal(t.parsePost(post,'https://new2.movies4u.garden/',{...movie,external_ids:{}},'movie').length,0);});
check('real movie files preserve 720/1080 and exclude 480',()=>{const r=t.parseArchive(links,'https://m4ulinks.sbs/number/69790',movie,'movie',0,0,sources[0]);assert.equal(r.length,4);assert.equal(r[0].quality,1080);assert.equal(r[1].quality,720);assert.ok(!r.some(x=>x.url.endsWith('h5g5hjkqzqhj2yk')));});
check('real series quality pages and episode 1 are exact',()=>{assert.equal(tvsrc.length,2);const r=t.parseArchive(tvlinks,'https://m4ulinks.sbs/number/69826',tv,'tv',1,1,tvsrc[0]);assert.equal(r.length,1);assert.ok(r[0].url.endsWith('111ighvay1nv5yy'));assert.equal(t.parseArchive(tvlinks,'https://m4ulinks.sbs/number/69826',tv,'tv',1,3,tvsrc[0]).length,0);assert.equal(t.parsePost(tvpost,'https://new2.movies4u.garden/',tv,'tv',2).length,0);});
check('unrelated link pages rejected',()=>assert.equal(t.parseArchive(links.replaceAll('Bad Apples','Wrong Title'),'https://m4ulinks.sbs/number/1',movie,'movie',0,0,sources[0]).length,0));
check('packs rejected rather than interpreted as first episode',()=>{for(const s of ['Episodes: 1-2','Episode 1 ZIP','Season pack','Complete Episodes 1'])assert.equal(t.episodeHeading(s),null);assert.equal(t.episodeHeading('-:Episodes: 10:-').episode,10);});
check('original, dual containing original, unknown accepted; explicit dub rejected',()=>{assert.equal(t.audioPolicy('[Hindi + English]','en').status,'dual');assert.equal(t.audioPolicy('[English]','en').status,'original');assert.equal(t.audioPolicy('720p','en').allowed,true);assert.equal(t.audioPolicy('[Hindi]','en').allowed,false);assert.equal(t.audioPolicy('[Hindi] Dubbed','').allowed,false);assert.equal(t.audioPolicy('Hindi Dubbed','en').allowed,false);assert.equal(t.audioPolicy('[English Subs]','ko').status,'unknown');});
check('domain updates restricted to Movies4u',()=>{assert.equal(t.allowedDomain('https://new2.movies4u.garden'),'https://new2.movies4u.garden');assert.equal(t.allowedDomain('https://movies4u.garden.evil.invalid'),'');assert.equal(t.allowedDomain('https://evil.invalid'),'');assert.equal(t.allowedDomain('https://movies4u.garden@evil.invalid'),'');});
check('Animals platform label is not part of title; similar titles stay rejected',()=>{
 const meta={title:'Animals',release_date:'2026-10-09',original_language:'en',external_ids:{imdb_id:'tt31049299'}};
 const doc={post_title:'Animals – Netflix Original (2026) WEB-DL',permalink:'/animals/'};
 assert.equal(t.matchPost(doc,meta,'movie'),false); // Decorated text alone is not identity proof.
 for(const title of ['Dangerous Animals (2026)','Nocturnal Animals (2026)','Animals – The Netflix Original Story (2026)'])assert.equal(t.matchPost({...doc,post_title:title},meta,'movie'),false);
 const page=fixture('animals.html');
 assert.equal(t.parsePost(page,'https://new2.movies4u.garden/',meta,'movie').length,1);
 assert.equal(t.parsePost(page.replace('tt31049299','tt99999'),'https://new2.movies4u.garden/',meta,'movie').length,0);
});
check('IMDb proof works for arbitrary title decorations without a platform whitelist',()=>{
 const meta={title:'Example',release_date:'2026-01-01',external_ids:{imdb_id:'tt12345'}};
 for(const suffix of [' – Any Service',' {Alternate Local Title}',' : Special Edition']){
  const html='<title>Example'+suffix+' (2026) Full Movie</title><a href="https://www.imdb.com/title/tt12345">IMDb</a>';
  assert.equal(t.pageIdentity($lib.load(html),meta,'movie').valid,true);
  assert.equal(t.pageIdentity($lib.load(html.replace('tt12345','tt99999')),meta,'movie').valid,false);
  assert.equal(t.pageIdentity($lib.load(html.replace('www.imdb.com','imdb.com.evil.invalid')),meta,'movie').valid,false);
 }
 const exact='<title>Example (2026)</title>';
 assert.equal(t.pageIdentity($lib.load(exact),meta,'movie').valid,true);
 assert.equal(t.pageIdentity($lib.load(exact.replace('2026','2025')),meta,'movie').valid,false);
 assert.equal(t.pageIdentity($lib.load(exact.replace('Example','Another Example')),meta,'movie').valid,false);
});
check('partial multi-audio language list stays unknown; complete dub-only list rejected',()=>{
 assert.equal(t.audioPolicy('[Hindi ORG. + Multi Audio]','en').allowed,true);
 assert.equal(t.audioPolicy('[Hindi ORG. + Multi Audio]','en').status,'unknown');
 assert.equal(t.audioPolicy('[Hindi + Tamil]','en').allowed,false);
});
function response(body,opt={}){return {ok:true,status:opt.status||200,url:opt.url||'',headers:{get:k=>({'content-type':opt.type||'text/html','content-range':opt.range||'','content-disposition':opt.file?'attachment; filename="'+opt.file+'"':''}[k.toLowerCase()]||'')},text:async()=>typeof body==='string'?body:JSON.stringify(body),...(opt.noBuffer?{}:{arrayBuffer:async()=>Uint8Array.from(body).buffer})};}
function route(mode,kind,calls){return async(u,o)=>{calls.push(u);if(u.includes('domains.json'))return response({movies4u:'https://new2.movies4u.garden'});if(u.includes('/lookup.php')){assert.equal(o.headers.Accept,'application/json');assert.ok(o.headers.Referer.includes('/search.html'));return response(kind==='tv'?{hits:[{post_title:'Love in Disguise (2026) Season 1',permalink:'/tv/'}]}:JSON.parse(fixture('search.json')));}
if(u.includes('/bad-apples-2026-'))return response(mode==='wrong-id'?post.replace('tt29714073','tt99999'):post);if(u.endsWith('/tv/'))return response(tvpost);
if(u.includes('m4ulinks.sbs'))return response(kind==='tv'?tvlinks:links);
if(u.includes('hubcloud.ist/drive/')){if(mode==='partial'&&u.includes('qkvr'))throw Error('host unavailable');return response('<a href="https://gamerxyt.com/hubcloud.php?file='+u.split('/').pop()+'">Generate</a>');}
if(u.includes('gamerxyt.com'))return response('<a href="https://abc.r2.cloudflarestorage.com/'+new URL(u).searchParams.get('file')+(mode==='no-file'?'':'.mkv')+'?token=secret">R2</a>');
if(u.includes('cloudflarestorage.com')){assert.equal(o.headers.Range,'bytes=0-8191');let q=u.includes('8muj')||kind==='tv'?720:u.includes('grqm')?2160:1080;const filename=(mode==='wrong-episode'?'Show.S01E02.':'Bad.Apples.')+q+'p.x264.mkv';return response(mode==='html'?Buffer.from('<html>fake video'):Buffer.from([26,69,223,163,1,2,3,4]),{type:'application/octet-stream',status:mode==='range'?200:206,range:'bytes 0-7/1182657081',file:mode==='no-file'?undefined:filename,noBuffer:mode==='bridge'||mode==='no-file'});}
throw Error('Unexpected route '+new URL(u).hostname);};}
(async()=>{for(const kind of ['movie','tv']){const calls=[],a=load(route('good',kind,calls),kind==='tv'?tv:movie),r=await a.p.getStreams(1,kind,1,1);assert.equal(r.length,kind==='tv'?1:3,a.logs.join('\n'));assert.equal(r[0].audioStatus,'dual');assert.equal(calls.filter(u=>u.includes('/lookup.php')).length,1);assert.ok(!a.logs.join('\n').includes('token=secret'));count++;console.log('PASS full '+kind+' route');}
for(const mode of ['html','range','no-file','wrong-id']){const a=load(route(mode,'movie',[]));assert.equal((await a.p.getStreams(1,'movie')).length,0,a.logs.join('\n'));count++;console.log('PASS rejects '+mode);}
const wrongEp=load(route('wrong-episode','tv',[]),tv);assert.equal((await wrongEp.p.getStreams(1,'tv',1,1)).length,0);count++;console.log('PASS final filename rejects mismatched episode');
// This integration must use the IMDb query and the actual decorated title page.
const master={title:'Masterplan',release_date:'2026-10-16',original_language:'en',external_ids:{imdb_id:'tt38672588'}},masterPost=fixture('masterplan.html'),masterLinks=fixture('masterplan-links.html'),calls=[];
const masterFetcher=async(u,o)=>{calls.push(u);
 if(u.includes('domains.json'))return response({movies4u:'https://new2.movies4u.garden'});
 if(u.includes('/lookup.php')){assert.equal(new URL(u).searchParams.get('q'),master.external_ids.imdb_id);return response({hits:[{post_title:'Unrelated (2026)',permalink:'/wrong/'},{post_title:'Masterplan – Amazon Prime (2026)',permalink:'/masterplan/'}]});}
 if(u.endsWith('/wrong/'))return response('<title>Unrelated (2026)</title><a href="https://www.imdb.com/title/tt99999">IMDb</a>');
 if(u.endsWith('/masterplan/'))return response(masterPost);
 if(u.includes('m4ulinks.sbs'))return response(masterLinks);
 const qualities={kwaskzg5njqdxoa:1080,'7qxgh1ihxxdiokr':720,nwvvdq0oozz1zev:2160,qdqmofwqpgf0epg:1080};
 if(u.includes('hubcloud.ist/drive/'))return response('<a href="https://gamerxyt.com/hubcloud.php?q='+qualities[u.split('/').pop()]+'">Download</a>');
 if(u.includes('gamerxyt.com'))return response('<a href="https://abc.r2.cloudflarestorage.com/'+new URL(u).searchParams.get('q')+'.mkv">R2</a>');
 if(u.includes('cloudflarestorage.com'))return response([26,69,223,163,1,2,3,4],{type:'application/octet-stream',status:206,range:'bytes 0-7/1182657081',file:'Masterplan.'+new URL(u).pathname.slice(1,-4)+'p.x264.mkv'});
 throw Error('unexpected masterplan route');
};
const masterApp=load(masterFetcher,master),masterRows=await masterApp.p.getStreams(1561726,'movie');assert.equal(masterRows.length,3,masterApp.logs.join('\n'));assert.equal(masterRows[0].audioStatus,'unknown');assert.equal(calls.filter(u=>u.includes('/lookup.php')).length,1);assert.ok(masterApp.logs.some(s=>s.includes('POST_REJECT: IMDb mismatch')));assert.ok(masterApp.logs.some(s=>s.includes('IDENTITY: IMDb verified')));count++;console.log('PASS Masterplan full IMDb-first route, wrong first hit rejected, real layouts, 3 validated mocked files');
const bridge=await load(route('bridge','movie',[])).p.getStreams(1,'movie');assert.equal(bridge.length,3);assert.equal(bridge[0].videoCodec,'h264');count++;console.log('PASS VUEO text-only bridge validates range and filename codec');
const partial=await load(route('partial','movie',[])).p.getStreams(1,'movie');assert.ok(partial.length>=1);count++;console.log('PASS partial host failure retains working alternatives');console.log(count+' checks passed');})().catch(e=>{console.error(e);process.exitCode=1});
