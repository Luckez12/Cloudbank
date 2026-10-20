const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),code=fs.readFileSync(path.join(root,'providers/dahmermovies.js'),'utf8');
function setup(options={}){
 const calls=[],logs=[];
 const c={module:{exports:{}},URL,URLSearchParams,console:{log:(...s)=>logs.push(s.join(' ')),error(){}},setTimeout,clearTimeout,require:()=>({}),SCRAPER_SETTINGS:options.settings||{},VUEO_DISCOVERY_CONTEXT:{tmdbId:'123',mediaType:options.tv?'tv':'movie',tmdb:{id:123,title:'Example',name:'Example',release_date:'2024-01-01',first_air_date:'2024-01-01'}},fetch:async(url,init={})=>{
  calls.push({url,init});
  if(options.fetch)return options.fetch(url,init);
  if(url.includes('api.themoviedb'))throw Error('Shared metadata should avoid HTTP');
  if(init.method==='HEAD')return {ok:true,status:200,url,headers:{get:()=>null}};
  let body=options.html||'';
  if(options.page)body=options.page(url);
  return {ok:body!==null,status:body===null?404:200,url,headers:{get:()=>null},text:async()=>body||''};
 }};c.global=c;c.self=c;vm.createContext(c);vm.runInContext(code,c,{timeout:3000});
 return {c,calls,logs,run:(...a)=>c.module.exports.getStreams(...(a.length?a:['123',options.tv?'tv':'movie',options.tv?2:undefined,options.tv?1:undefined]))};
}
const table=files=>'<table>'+files.map(([name,href])=>'<tr><td><a href="'+(href||'https://cdn.test/'+name)+'">'+name+'</a></td></tr>').join('')+'</table>';
let total=0;async function test(name,fn){await fn();total++;console.log('PASS',name)}
(async()=>{
 await test('TV 4K and FHD are both exposed under the main Dahmermovies ID',async()=>{
  const x=setup({tv:true,html:table([['Example.S02E01.1080p.mkv'],['Example.S02E01.2160p.mkv']])});
  const rows=await x.run();assert.equal(rows.length,2);assert.deepEqual(Array.from(rows,r=>r.quality),['2160p','1080p']);assert(rows.every(r=>r.provider==='dahmermovies'));assert(rows.every(r=>r.headers.Range==='bytes=0-'));assert(rows.every(r=>r.headers.Referer==='https://a.111477.xyz/'));assert(x.calls[0].url.endsWith('/Season%2002/'));assert(!x.logs.some(s=>s.includes('existing main fallback')));
 });
 await test('Movie quality labels retain 720p and Unknown instead of invented 1080p',async()=>{
  const x=setup({html:table([['Example.720p.mp4'],['Example.4K.mkv'],['Example.noquality.mkv']])});const r=await x.run();assert.deepEqual(Array.from(r,s=>s.quality),['2160p','720p','Unknown']);assert(x.calls[0].url.includes('/movies/Example%20(2024)/'));
 });
 await test('Episode 1 cannot select E10, E11 or another season',async()=>{
  const x=setup({tv:true,html:table([['Example.S02E10.2160p.mkv'],['Example.S02E11.1080p.mkv'],['Example.S01E01.2160p.mkv'],['Example.S02E01.720p.mkv'],['Example.E1.1080p.mkv']])});const r=await x.run();assert.equal(r.length,2);assert(r.every(s=>!s.url.includes('E10')&&!s.url.includes('E11')&&!s.url.includes('S01')));
 });
 await test('Unpadded season route remains available after padded route misses',async()=>{
  const x=setup({tv:true,page:u=>u.includes('Season%2002')?null:table([['Example.S02E01.2160p.mkv']])});assert.equal((await x.run()).length,1);assert.equal(x.calls.filter(c=>!c.init.method).length,2);
 });
 await test('Quality switches apply before the five-link cap',async()=>{
  const x=setup({settings:{q2160:false},html:table([...Array.from({length:6},(_,i)=>['Example.2160p.'+i+'.mkv']),['Example.1080p.mkv']])});const r=await x.run();assert.equal(r.length,1);assert.equal(r[0].quality,'1080p');assert.equal(x.calls.filter(c=>c.init.method==='HEAD').length,1);
 });
 await test('Existing merged settings are retained',async()=>{const x=setup();const r=await x.c.module.exports.onSettings();assert(r.some(s=>s.key==='q2160'));assert(r.some(s=>s.key==='q720'));});
 await test('Main fallback is only started after a preferred miss and retains stream metadata',async()=>{
  const x=setup();let count=0,args;const headers={Authorization:'sample'},subtitles=[{language:'en',url:'https://cdn.test/en.vtt'}];
  x.c.cloudbankDahmerLegacy=()=>({getStreams(...a){count++;args=a;return [{name:'Legacy',url:'https://cdn.test/fallback.mkv',quality:'1080p',headers,subtitles}];}});
  const r=await x.run('123','movie');assert.equal(count,1);assert.deepEqual(args,['123','movie',null,null]);assert.equal(r.length,1);assert.equal(r[0].headers,headers);assert.equal(r[0].subtitles,subtitles);assert.equal(r[0].provider,'dahmermovies');
 });
 await test('Series alias and season zero remain valid',async()=>{
  const x=setup({tv:true,html:table([['Example.S00E01.2160p.mkv']])});const r=await x.run('123','series',0,1);assert.equal(r.length,1);assert(x.calls[0].url.includes('Season%2000'));
 });
 await test('Invalid coordinates produce no HTTP',async()=>{const x=setup();assert.equal((await x.run('','movie')).length,0);assert.equal((await x.run('123','tv',-1,1)).length,0);assert.equal((await x.run('123','tv',1,0)).length,0);assert.equal(x.calls.length,0)});
 await test('Global entry points use the final formatted provider',async()=>{const x=setup();assert.equal(x.c.getStreams,x.c.module.exports.getStreams);assert.equal(x.c.self.getStreams,x.c.getStreams);assert.equal(x.c.onSettings,x.c.module.exports.onSettings)});
 await test('Expired request scopes cannot start HTTP',async()=>{let calls=0;const x=setup();const f=x.c.cloudbankDahmerScope(async()=>{calls++},Date.now()-1);await assert.rejects(()=>f('https://cdn.test/a'),/budget exhausted/);assert.equal(calls,0)});
 await test('Both actual extraction paths can finish empty without network retries beyond their scope',async()=>{const x=setup();assert.equal((await x.run()).length,0);assert(x.logs.some(s=>s.includes('existing main fallback')));assert(x.calls.length<10)});
 await test('Manifest removes All-Wish and standalone TV, preserves all other entries',async()=>{
  const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));assert.equal(m.version,'1.20.46');assert.equal(m.scrapers.length,51);assert(!m.scrapers.some(s=>s.id==='allwish'||s.id==='dahmermovies-tv'));assert.equal(m.scrapers.find(s=>s.id==='dahmermovies').version,'1.1.0');
 });
 console.log('TOTAL',total,'passed');
})().catch(e=>{console.error(e);process.exitCode=1});
