const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),code=fs.readFileSync(path.join(root,'providers/dahmermovies.js'),'utf8');
function response(url,status,headers={},body='') {
 const normalized=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
 return {url,status,ok:status>=200&&status<300,headers:{get:k=>normalized[String(k).toLowerCase()]||null},text:async()=>body,json:async()=>JSON.parse(body)};
}
const table=files=>'<table>'+files.map(([name,url])=>'<tr><td><a href="'+(url||name)+'"><span>'+name+'</span></a></td></tr>').join('')+'</table>';
const good=(url)=>response(url,206,{'Content-Type':'video/x-matroska','Content-Range':'bytes 0-1/1000000000','Content-Length':'2'});
function setup(o={}) {
 const calls=[],logs=[];let reads=0;
 const c={module:{exports:{}},URL,URLSearchParams,setTimeout,clearTimeout,console:{log:(...x)=>logs.push(x.join(' ')),error(){}},SCRAPER_SETTINGS:o.settings||{},VUEO_DISCOVERY_CONTEXT:o.context||{tmdbId:1561726,mediaType:o.tv?'tv':'movie',tmdb:{id:1561726,title:'Masterplan',name:'Example',release_date:'2026-01-01',first_air_date:'2024-01-01'}},fetch:async(url,options={})=>{
  calls.push({url,options});
  if(url.includes('api.themoviedb.org'))return response(url,200,{},JSON.stringify(o.meta||{id:1561726,title:'Masterplan',release_date:'2026-01-01'}));
  if(options.headers&&options.headers.Range||o.hls&&/\.m3u8(?:\?|$)/.test(url)||url.startsWith('https://cdn.test')||url.startsWith('https://p.111477.xyz')) {
   const r=o.media?await o.media(url,options):good(url);
   const originalText=r.text;r.text=async()=>{reads++;return originalText()};return r;
  }
  if(o.catalogue)return o.catalogue(url,options);
  return response(url,200,{'Content-Type':'text/html'},o.html||table([['Masterplan.2026.1080p.mkv']]));
 }};
 if(o.clock){Object.assign(c,o.clock.api);c.Date=class extends Date {static now(){return o.clock.now()}};}
 c.global=c;c.self=c;vm.createContext(c);vm.runInContext(code,c,{timeout:3000});
 return {c,calls,logs,reads:()=>reads,run:(...a)=>c.module.exports.getStreams(...(a.length?a:['1561726',o.tv?'tv':'movie',o.tv?2:null,o.tv?1:null]))};
}
function clock(){let now=0,next=0;const timers=new Map();return {now:()=>now,api:{setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{at:now+ms,fn});return id},clearTimeout:id=>timers.delete(id)},async flush(){for(let i=0;i<35;i++)await Promise.resolve()},async tick(ms){await this.flush();const end=now+ms;while(true){const due=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await this.flush()}now=end;await this.flush()}};}
let total=0;async function test(name,fn){await fn();total++;console.log('PASS',name)}
(async()=>{
 const passiveScripts=[
  '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
  '<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/abc/main.js"></script>',
  '<script src="/cdn-cgi/challenge-platform/scripts/jsd/api.js"></script>',
  '<style>.cf-chl-widget{display:none}</style>',
  '<script>var example="<h1>Performing security verification</h1>"; var platform="challenge-platform";</script>'
 ];
 for(let i=0;i<passiveScripts.length;i++)await test('Normal catalogue with passive Cloudflare markup '+i+' reaches validated media',async()=>{
  const html='<title>Index of /movies/Masterplan (2026)/</title>'+table([['Masterplan.2026.1080p.mkv']])+passiveScripts[i];
  // The previous detector falsely rejected this ordinary page.
  assert(/cf-chl-|challenge-platform/.test(html));
  const x=setup({html});assert.equal((await x.run()).length,1);assert(x.logs.some(s=>s.includes('gate=none')));assert(x.logs.some(s=>s.includes('MEDIA_ACCEPT')));
 });
 await test('Reported Tenzing request can parse a normal catalogue with JSD and validate its media',async()=>{
  const context={tmdbId:1288069,mediaType:'movie',tmdb:{id:1288069,title:'Tenzing',release_date:'2026-01-01'}};
  const x=setup({context,html:'<title>Index of /movies/Tenzing (2026)/</title>'+table([['Tenzing.2026.1080p.mkv']])+passiveScripts[0]});
  assert.equal((await x.run('1288069','movie')).length,1);assert(x.calls[0].url.includes('/Tenzing%20(2026)/'));assert(x.logs.some(s=>s.includes('fileAnchors=1')));
 });
 await test('Actual challenge mitigation header is decisive even when a file anchor exists',async()=>{
  const html=table([['Masterplan.2026.1080p.mkv']]);const x=setup({catalogue:u=>response(u,200,{'cf-mitigated':'challenge'},html)});assert.equal((await x.run()).length,0);assert(x.logs.some(s=>s.includes('cf-mitigated-header')));assert.equal(x.calls.length,1);
 });
 await test('Visible verification heading with security evidence is still blocked',async()=>{
  const x=setup({html:'<h1>a.111477.xyz</h1><h2>Performing security verification</h2><p>Cloudflare</p>'});assert.equal((await x.run()).length,0);assert(x.logs.some(s=>s.includes('verification-heading')));
 });
 await test('Script/comment sample file links cannot be returned as media',async()=>{
  const html='<title>Index</title><script>var sample=\'<a href="Fake.2026.2160p.mkv">Fake.2026.2160p.mkv</a>\';</script><!-- <a href="Fake.2026.1080p.mkv">Fake.2026.1080p.mkv</a> -->'+table([['Masterplan.2026.720p.mkv']]);
  const x=setup({html});const r=await x.run();assert.equal(r.length,1);assert.equal(r[0].quality,'720p');assert(!x.calls.some(c=>c.url.includes('Fake.')));
 });
 await test('Passive JSD does not suppress a genuine downstream worker 403',async()=>{
  const x=setup({html:table([['Masterplan.2026.1080p.mkv']])+passiveScripts[0],media:u=>u.startsWith('https://a.')?response(u,302,{Location:'https://p.111477.xyz/bulk?u=published'}):response(u,403,{'Content-Type':'text/html'},'Forbidden')});
  assert.equal((await x.run()).length,0);assert(x.logs.some(s=>s.includes('gate=none')));assert(x.logs.some(s=>s.includes('HTTP 403 at p.111477.xyz')));
 });
 await test('Known GET 403 after catalogue-to-worker redirect is rejected',async()=>{
  const x=setup({media:(url)=>url.startsWith('https://a.')?response(url,302,{Location:'https://p.111477.xyz/bulk?u=published'}):response(url,403,{'Content-Type':'text/html'},'Forbidden')});
  assert.equal((await x.run()).length,0);assert(x.logs.some(s=>s.includes('HTTP 403 at p.111477.xyz')));assert.equal(x.calls.filter(c=>c.options.method==='HEAD').length,0);assert.equal(x.calls.length,3);assert(!x.logs.some(s=>s.includes('MEDIA_ACCEPT')));
 });
 await test('GET 206 media is returned with the exact request headers and no fixed playback Range',async()=>{
  const x=setup();const r=await x.run();assert.equal(r.length,1);assert.equal(r[0].quality,'1080p');assert.equal(r[0].mimeType,'video/x-matroska');assert(!('Range' in r[0].headers));const req=x.calls.find(x=>x.options.headers.Range);assert.equal(req.options.method,'GET');assert.equal(req.options.headers.Range,'bytes=0-1');assert.equal(r[0].headers['User-Agent'],req.options.headers['User-Agent']);assert.equal(r[0].headers.Referer,req.options.headers.Referer);assert.equal(x.reads(),0);
 });
 await test('Final published redirect URL retains signed query bytes',async()=>{
  const final='https://cdn.test/file.mkv?sig=a%2Fb&token=xyz';const x=setup({media:u=>u.startsWith('https://a.')?response(u,302,{Location:final}):good(u)});assert.equal((await x.run())[0].url,final);
 });
 for(const status of [401,404,416,429,500])await test('GET '+status+' never becomes a source',async()=>{const x=setup({media:u=>response(u,status,{'Content-Type':'video/mp4'})});assert.equal((await x.run()).length,0)});
 for(const mime of ['text/html','application/json','text/plain','application/xml',''])await test('Reject success response with '+(mime||'missing MIME'),async()=>{const x=setup({media:u=>response(u,200,{'Content-Type':mime},'<html>not video</html>')});assert.equal((await x.run()).length,0)});
 await test('Bad Content-Range is rejected even with video MIME',async()=>{const x=setup({media:u=>response(u,206,{'Content-Type':'video/mp4','Content-Range':'bytes 100-101/100000','Content-Length':'2'})});assert.equal((await x.run()).length,0)});
 await test('Contradictory partial total cannot become a stream',async()=>{const x=setup({media:u=>response(u,206,{'Content-Type':'video/mp4','Content-Range':'bytes 0-1/1','Content-Length':'2'})});assert.equal((await x.run()).length,0)});
 await test('Partial binary media requires a valid range and preserves MKV MIME',async()=>{const x=setup({media:u=>response(u,206,{'Content-Type':'application/octet-stream','Content-Range':'bytes 0-1/200000','Content-Length':'2'})});assert.equal((await x.run())[0].mimeType,'video/x-matroska')});
 await test('Next candidate is attempted after a failed media candidate',async()=>{const x=setup({html:table([['Masterplan.2026.2160p.mkv'],['Masterplan.2026.1080p.mkv']]),media:u=>u.includes('2160p')?response(u,403,{'Content-Type':'text/html'}):good(u)});const r=await x.run();assert.equal(r.length,1);assert.equal(r[0].quality,'1080p');assert.equal(x.calls.filter(c=>c.options.headers.Range).length,2)});
 await test('Redirect cycles fail without legacy success fallback',async()=>{const x=setup({media:u=>response(u,302,{Location:u})});assert.equal((await x.run()).length,0);assert.equal(x.calls.length,2)});
 await test('Invalid redirect schemes are rejected',async()=>{const x=setup({media:u=>response(u,302,{Location:'javascript:bad()'})});assert.equal((await x.run()).length,0)});
 await test('Catalogue 403 stops all catalogue aliases and media requests',async()=>{const x=setup({context:{tmdbId:1561726,mediaType:'movie',tmdb:{id:1561726,title:'Masterplan',original_title:'Other title',release_date:'2026-01-01'}},catalogue:u=>response(u,403,{},'blocked')});assert.equal((await x.run()).length,0);assert.equal(x.calls.length,1)});
 await test('Security challenge HTML cannot become a catalogue',async()=>{const x=setup({html:'<title>Just a moment</title><script src="/cdn-cgi/challenge-platform"></script>'});assert.equal((await x.run()).length,0);assert.equal(x.calls.length,1)});
 await test('Catalogue redirect to unrelated root is rejected',async()=>{const x=setup({catalogue:u=>response('https://a.111477.xyz/',200,{},table([['Masterplan.2026.1080p.mkv']]))});assert.equal((await x.run()).length,0)});
 await test('Exact season and episode excludes E10, E11 and wrong-season E1',async()=>{const x=setup({tv:true,html:table([['Example.S02E10.2160p.mkv'],['Example.S02E11.2160p.mkv'],['Example.S01E01.2160p.mkv'],['Example.S02E01.720p.mkv']])});const r=await x.run();assert.equal(r.length,1);assert.equal(r[0].quality,'720p')});
 await test('Quality controls apply before limits and 4K remains prioritized',async()=>{const x=setup({settings:{q2160:false},html:table([...Array.from({length:6},(_,i)=>['Masterplan.2026.2160p.'+i+'.mkv']),['Masterplan.2026.720p.mkv'],['Masterplan.2026.1080p.mkv']])});assert.deepEqual(Array.from(await x.run(),r=>r.quality),['1080p','720p']);assert.equal(x.calls.length,3)});
 await test('Special season zero and series alias are supported',async()=>{const x=setup({tv:true,html:table([['Example.S00E01.2160p.mkv']])});assert.equal((await x.run('1561726','series',0,1)).length,1)});
 await test('Unpadded published season route remains available',async()=>{const html=table([['Example.S02E01.1080p.mkv']]);const x=setup({tv:true,catalogue:u=>response(u,u.includes('Season%2002')?404:200,{},html)});assert.equal((await x.run()).length,1);assert.equal(x.calls.length,3)});
 await test('Stale context falls back to exactly one verified TMDB request',async()=>{const x=setup({context:{tmdbId:999,tmdb:{id:999,title:'Wrong'}}});assert.equal((await x.run()).length,1);assert.equal(x.calls.filter(c=>c.url.includes('themoviedb')).length,1)});
 await test('Unknown quality remains unknown',async()=>{const x=setup({html:table([['Masterplan.2026.mkv']])});assert.equal((await x.run())[0].quality,'Unknown')});
 await test('Published HLS uses playlist validation and Auto',async()=>{const x=setup({hls:true,html:table([['Masterplan.2026.m3u8']]),media:u=>response(u,200,{'Content-Type':'application/vnd.apple.mpegurl'},'#EXTM3U\n#EXTINF:6,\na.ts\n')});const r=await x.run();assert.equal(r.length,1);assert.equal(r[0].quality,'Auto');assert.equal(r[0].type,'hls')});
 await test('HTML HLS wrapper is rejected',async()=>{const x=setup({hls:true,html:table([['Masterplan.2026.m3u8']]),media:u=>response(u,200,{'Content-Type':'text/html'},'<html>error</html>')});assert.equal((await x.run()).length,0)});
 await test('Slow native catalogue request completes within its timeout and cannot start late HTTP',async()=>{const t=clock(),x=setup({clock:t,catalogue:()=>new Promise(()=>{})});const pending=x.run();await t.tick(4300);assert.equal((await pending).length,0);const calls=x.calls.length;await t.tick(20000);assert.equal(x.calls.length,calls)});
 await test('Public deadline bounds unresolved native work without exposing partial mutable results',async()=>{const t=clock(),x=setup({clock:t,media:()=>new Promise(()=>{})});const pending=x.run();await t.tick(19000);assert.equal((await pending).length,0);const calls=x.calls.length;await t.tick(20000);assert.equal(x.calls.length,calls)});
 await test('Settings and global aliases survive display adaptation',async()=>{const x=setup();assert.equal(x.c.getStreams,x.c.module.exports.getStreams);assert.equal(x.c.onSettings,x.c.module.exports.onSettings);assert((await x.c.onSettings()).some(s=>s.key==='q2160'))});
 await test('Invalid requests make no network calls',async()=>{const x=setup();for(const a of [['0','movie'],['bad','tv',1,1],['1561726','tv',-1,1],['1561726','tv',1,0]])assert.equal((await x.run(...a)).length,0);assert.equal(x.calls.length,0)});
 console.log('TOTAL',total,'passed');
})().catch(e=>{console.error(e);process.exitCode=1});
