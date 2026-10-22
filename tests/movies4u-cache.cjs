'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../providers/movies4u.js'),'utf8');
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/movies4u/'+n),'utf8');
const meta={title:'Bad Apples',release_date:'2025-01-01',original_language:'en',external_ids:{imdb_id:'tt29714073'}};
let now=Date.now(),generation=0,checks=0;const entries=new Map();
function bridge(request){const r=JSON.parse(request);if(r.op==='get'){const e=entries.get(r.key);return e&&e.expires>now?JSON.stringify(e.value):'null';}if(r.op==='put'){entries.set(r.key,{value:r.value,expires:now+r.ttlMs});return 'true';}if(r.op==='remove'){entries.delete(r.key);return 'true';}throw Error('bad op');}
function response(body,opt={}){return {ok:opt.status!==403,status:opt.status||200,url:opt.url||'',headers:{get:k=>({'content-type':opt.type||'text/html','content-range':opt.range||'','content-disposition':opt.file?'attachment; filename="'+opt.file+'"':''}[k.toLowerCase()]||'')},text:async()=>typeof body==='string'?body:JSON.stringify(body),arrayBuffer:async()=>Uint8Array.from(body).buffer};}
function load(mode='good',metadata=meta,bridgeOn=true){const calls=[],logs=[],run=++generation,isTV=!!metadata.name;
 const fetch=async(u,o)=>{calls.push(u);
 if(u.includes('domains.json'))return response({movies4u:'https://new2.movies4u.garden'});
 if(u.includes('/lookup.php'))return response(isTV?{hits:[{post_title:'Love in Disguise (2026) Season 1',permalink:'/tv/'}]}:JSON.parse(fixture('search.json')));
 if(u.endsWith('/tv/'))return response(fixture('tv.html'));
 if(u.includes('/bad-apples-2026-'))return response(fixture('post.html'));
 if(u.includes('m4ulinks.sbs'))return response(fixture(isTV?'tvlinks.html':'links.html'));
 if(u.includes('hubcloud.ist/drive/'))return response('<a href="https://gamerxyt.com/hubcloud.php?file='+u.split('/').pop()+'&token=fresh'+run+'">Generate</a>');
 if(u.includes('gamerxyt.com'))return response('<a href="https://abc.r2.cloudflarestorage.com/'+new URL(u).searchParams.get('file')+'.mkv?signature=fresh'+run+'">R2</a>');
 if(u.includes('cloudflarestorage.com')){const q=isTV?720:u.includes('8muj')?720:u.includes('grqm')?2160:1080;return response([26,69,223,163,1,2,3,4],{status:mode==='failed'?403:206,type:'application/octet-stream',range:'bytes 0-7/1182657081',file:(isTV?'Show.S01E0'+(u.includes('g075')?'2':'1')+'.':'Bad.Apples.')+q+'p.x264.mkv'});}
 throw Error('Unexpected URL');};
 const ctx={module:{exports:{}},require,fetch,URL,URLSearchParams,Uint8Array,AbortController,setTimeout,clearTimeout,Date:class extends Date{static now(){return now;}},VUEO_DISCOVERY_CONTEXT:{tmdb:metadata},console:{log:s=>logs.push(s)},...(bridgeOn?{vueoMetadataCache:bridge}:{})};
 vm.runInNewContext(code,ctx);return {p:ctx.module.exports,calls,logs};
}
function check(name,fn){fn();checks++;console.log('PASS '+name);}
(async()=>{
 let app=load(),cold=await app.p.getStreams(1,'movie');
 check('cold route validates three files',()=>{assert.equal(cold.length,3,app.logs.join('\n'));assert.equal(app.calls.length,13);});
 const coldCalls=app.calls.length,serialized=JSON.stringify([...entries.values()].map(e=>e.value));
 check('cache contains metadata/public routes only',()=>{assert.ok(!serialized.includes('signature='));assert.ok(!serialized.includes('hubcloud.php'));assert.ok(!serialized.includes('cloudflarestorage.com'));assert.ok(!serialized.includes('<html'));});
 app=load();let warm=await app.p.getStreams(1,'movie');
 check('fresh runtime reuses native metadata cache',()=>{assert.equal(warm.length,3,app.logs.join('\n'));assert.equal(app.calls.length,9);assert.equal(app.calls.filter(u=>u.includes('lookup.php')||u.includes('m4ulinks.sbs')).length,0);assert.ok(app.logs.some(s=>s.includes('CACHE: file routes hit')));});
 check('warm route refreshes all signed tokens and probes',()=>{assert.notEqual(warm[0].url,cold[0].url);assert.equal(app.calls.filter(u=>u.includes('gamerxyt.com')).length,3);assert.equal(app.calls.filter(u=>u.includes('cloudflarestorage.com')).length,3);});
 now+=121000;app=load();await app.p.getStreams(1,'movie');
 check('expired file list refreshes; verified post metadata retained',()=>{assert.equal(app.calls.length,10);assert.equal(app.calls.filter(u=>u.includes('m4ulinks.sbs')).length,1);assert.equal(app.calls.filter(u=>u.includes('lookup.php')).length,0);});
 now+=301000;app=load();await app.p.getStreams(1,'movie');
 check('full TTL expiry rediscovers and verifies identity',()=>assert.equal(app.calls.length,coldCalls));
 app=load('good',{...meta,release_date:'2024-01-01'});await app.p.getStreams(1,'movie');
 check('metadata revision cannot reuse old identity entry',()=>assert.ok(app.calls.some(u=>u.includes('lookup.php'))));
 app=load('failed');assert.equal((await app.p.getStreams(1,'movie')).length,0);
 check('failed cached hosts clear discovery entries',()=>assert.ok(![...entries.keys()].some(k=>k.endsWith(':files')||k.endsWith(':post'))));
 app=load();await app.p.getStreams(1,'movie');
 check('scan following failed cached hosts performs fresh discovery',()=>assert.ok(app.calls.some(u=>u.includes('lookup.php'))));
 const fileEntry=[...entries.entries()].find(([k])=>k.endsWith(':files'));fileEntry[1].value.rows[0].url='https://abc.r2.cloudflarestorage.com/file.mkv?signature=forged';
 app=load();await app.p.getStreams(1,'movie');
 check('malformed cache URL never treated as a source',()=>{assert.ok(!app.calls.some(u=>u.includes('signature=forged')));assert.ok(app.calls.some(u=>u.includes('m4ulinks.sbs')));});
 app=load('good',meta,false);await app.p.getStreams(1,'movie');
 check('missing native bridge falls back to normal discovery',()=>{assert.equal(app.calls.length,13);assert.ok(app.logs.some(s=>s.includes('runtime-only')));});
 app=load('good',{...meta,original_language:'hi'});await app.p.getStreams(1,'movie');
 check('audio language changes cannot reuse the previous language policy',()=>assert.ok(app.calls.some(u=>u.includes('lookup.php'))));
 const tv={name:'Love in Disguise',first_air_date:'2026-01-01',original_language:'ko',external_ids:{imdb_id:'tt45246384'}};
 app=load('good',tv);const episode1=await app.p.getStreams(2,'tv',1,1);assert.equal(episode1.length,1,app.logs.join('\n'));
 app=load('good',tv);const episode2=await app.p.getStreams(2,'tv',1,2);
 check('cached TV episode never leaks into another episode',()=>{assert.equal(episode2.length,1,app.logs.join('\n'));assert.notEqual(episode1[0].url,episode2[0].url);assert.ok(app.calls.some(u=>u.includes('g075ef871fgd0ey')));assert.ok(!app.calls.some(u=>u.includes('111ighvay1nv5yy')));});
 console.log(checks+' cache checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
