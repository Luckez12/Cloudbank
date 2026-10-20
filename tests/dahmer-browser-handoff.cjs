const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../providers/dahmermovies.js'),'utf8');
const site='https://a.111477.xyz', file='Masterplan.2026.1080p.mkv';
const table=files=>'<title>Index of /</title><table>'+files.map(x=>'<tr><td><a href="'+x+'">'+x+'</a></td></tr>').join('')+'</table>';
function response(url,status,body,headers={}){return {url,status,ok:status>=200&&status<300,headers:{get:k=>headers[k.toLowerCase()]||null},text:async()=>body,json:async()=>JSON.parse(body)}}
function redirect(url,token='fresh00001') {return {version:1,status:200,redirectObserved:true,url:'https://generated-cdn.workers.dev/d/'+token+'/'+new URL(url).pathname.split('/').pop(),headers:{'User-Agent':'Android WebView test'}}}
function setup(o={}) {
 const calls=[],bridges=[],logs=[];let serial=0;
 const c={URL,URLSearchParams,setTimeout,clearTimeout,module:{exports:{}},console:{log:(...a)=>logs.push(a.join(' '))},SCRAPER_SETTINGS:o.settings||{},
 VUEO_DISCOVERY_CONTEXT:o.context||{tmdbId:'1561726',mediaType:'movie',tmdb:{id:1561726,title:'Masterplan',release_date:'2026-01-01'}},
 fetch:async(url,options={})=>{calls.push({url,options});if(url.includes('api.themoviedb.org')) return response(url,200,JSON.stringify({id:1561726,title:'Masterplan',release_date:'2026-01-01'}));assert(url.startsWith(site));return o.catalogue?o.catalogue(url):response(url,200,o.html||table([file]));}};
 if(!o.noBridge)c.vueoDahmerResolve=async raw=>{const request=JSON.parse(raw);bridges.push(request);const value=o.bridge?await o.bridge(request,++serial):redirect(request.url,'fresh0000'+(++serial));return typeof value==='string'?value:JSON.stringify(value)};
 vm.createContext(c);vm.runInContext(code,c,{timeout:3000});return {calls,bridges,logs,run:(...a)=>c.module.exports.getStreams(...(a.length?a:['1561726','movie']))};
}
let n=0;async function test(name,fn){await fn();n++;console.log('PASS',name)}
(async()=>{
 await test('Fresh redirect is handed directly to player without CDN or broker HTTP preflight',async()=>{let x=setup(),r=await x.run();assert.equal(r.length,1);assert.equal(x.calls.length,1);assert.equal(x.bridges.length,1);assert.equal(r[0].headers.Range,'bytes=0-');assert.equal(r[0].headers['User-Agent'],'Android WebView test');assert.equal(r[0].quality,'1080p');assert(x.logs.some(v=>v.includes('MEDIA_HANDOFF')))});
 await test('Each discovery obtains a new redirect',async()=>{let x=setup();assert.notEqual((await x.run())[0].url,(await x.run())[0].url);assert.equal(x.bridges.length,2)});
 await test('No companion app gives actionable message with no old native proxy fallback',async()=>{let x=setup({noBridge:true});assert.equal((await x.run()).length,0);assert.equal(x.calls.length,1);assert(x.logs.some(v=>v.includes('APP_UPDATE_REQUIRED')))});
 for(let status of [428,429,403,503,0])await test('Browser status '+status+' stops candidates',async()=>{let x=setup({html:table(['Masterplan.2026.2160p.mkv',file]),bridge:()=>({version:1,status})});assert.equal((await x.run()).length,0);assert.equal(x.bridges.length,1);if(status===429)assert(x.logs.some(v=>v.includes('RATE_LIMITED')));if(status===428)assert(x.logs.some(v=>v.includes('ACCESS_REQUIRED')))});
 for(let [label,edit] of [
  ['HTTP URL',r=>r.url=r.url.replace('https:','http:')],['wrong host',r=>r.url=r.url.replace('generated-cdn.workers.dev','evil.test')],
  ['wrong filename',r=>r.url=r.url.replace(file,'Wrong.2026.1080p.mkv')],['credentials',r=>r.url=r.url.replace('https://','https://user:pass@')],
  ['wrong route',r=>r.url=r.url.replace('/d/','/bulk/')],['short token',r=>r.url=r.url.replace('fresh00001','a')],
  ['fragment',r=>r.url+='#bad'],['nondefault port',r=>r.url=r.url.replace('.dev/','.dev:444/')],
  ['unobserved redirect',r=>r.redirectObserved=false],['wrong bridge version',r=>r.version=2],
  ['missing browser UA',r=>r.headers={}],['invalid browser UA',r=>r.headers['User-Agent']='x\r\nCookie: x']]) {
  await test('Reject '+label,async()=>{let x=setup({bridge:q=>{let r=redirect(q.url);edit(r);return r}});assert.equal((await x.run()).length,0)});
 }
 await test('Malformed bridge result is stopped',async()=>{let x=setup({bridge:()=>'{broken'});assert.equal((await x.run()).length,0);assert.equal(x.bridges.length,1)});
 await test('Bridge exception is stopped',async()=>{let x=setup({bridge:()=>{throw Error('browser stopped')}});assert.equal((await x.run()).length,0);assert.equal(x.bridges.length,1)});
 await test('Highest quality first, first result wins',async()=>{let x=setup({html:table(['Masterplan.2026.720p.mkv',file,'Masterplan.2026.2160p.mkv'])});let r=await x.run();assert.equal(r.length,1);assert.equal(r[0].quality,'2160p');assert.equal(x.bridges.length,1)});
 await test('Quality setting is respected',async()=>{let x=setup({html:table(['Masterplan.2026.2160p.mkv',file]),settings:{q2160:false}});assert.equal((await x.run())[0].quality,'1080p')});
 await test('Unknown quality remains accepted',async()=>{let x=setup({html:table(['Masterplan.2026.mkv'])});assert.equal((await x.run())[0].quality,'Unknown')});
 await test('Exact movie year enforced',async()=>{let x=setup({html:table(['Masterplan.2025.1080p.mkv'])});assert.equal((await x.run()).length,0);assert.equal(x.bridges.length,0)});
 await test('Foreign catalogue file cannot enter browser bridge',async()=>{let x=setup({html:table(['https://evil.test/'+file])});assert.equal((await x.run()).length,0);assert.equal(x.bridges.length,0)});
 for(let script of ['<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>','<style>.cf-chl-widget{display:none}</style>','<script>var x="Performing security verification"</script>'])await test('Passive Cloudflare markup does not hide a valid catalogue',async()=>{let x=setup({html:table([file])+script});assert.equal((await x.run()).length,1)});
 await test('Actual Cloudflare challenge header stops catalogue',async()=>{let x=setup({catalogue:u=>response(u,200,table([file]),{'cf-mitigated':'challenge'})});assert.equal((await x.run()).length,0);assert.equal(x.bridges.length,0)});
 await test('Actual verification interstitial stops catalogue',async()=>{let x=setup({html:'<title>Just a moment...</title><script>_cf_chl_opt={}</script>'});assert.equal((await x.run()).length,0);assert.equal(x.bridges.length,0)});
 await test('Catalogue HTTP 429 stops without retry',async()=>{let x=setup({catalogue:u=>response(u,429,'slow down')});assert.equal((await x.run()).length,0);assert.equal(x.calls.length,1);assert.equal(x.bridges.length,0)});
 await test('Wrong catalogue redirect rejected',async()=>{let x=setup({catalogue:u=>response(site+'/',200,table([file]))});assert.equal((await x.run()).length,0)});
 await test('Comment and script file samples ignored',async()=>{let x=setup({html:'<!-- <a href="Fake.2026.2160p.mkv">Fake</a> --><script>var x=\'<a href="Fake.2026.2160p.mkv">Fake</a>\'</script>'+table([file])});assert.equal((await x.run())[0].quality,'1080p')});
 await test('Shared metadata skips TMDB network call',async()=>{let x=setup();await x.run();assert(!x.calls.some(c=>c.url.includes('themoviedb')))});
 await test('Metadata fallback used only when absent',async()=>{let x=setup({context:{}});assert.equal((await x.run()).length,1);assert.equal(x.calls.filter(c=>c.url.includes('themoviedb')).length,1)});
 await test('Exact TV episode and season kept',async()=>{let x=setup({context:{tmdbId:1561726,mediaType:'tv',tmdb:{id:1561726,name:'Example'}},html:table(['Example.S02E10.2160p.mkv','Example.S01E01.2160p.mkv','Example.S02E01.1080p.mkv'])});let r=await x.run('1561726','tv',2,1);assert.equal(r.length,1);assert.equal(r[0].quality,'1080p');assert(x.calls[0].url.includes('Season%2002/'))});
 await test('Invalid request does not access network or browser',async()=>{let x=setup();assert.equal((await x.run('bad','tv',1,1)).length,0);assert.equal(x.calls.length,0);assert.equal(x.bridges.length,0)});
 console.log(n+' browser handoff checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
