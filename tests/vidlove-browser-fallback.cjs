const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/vidlove.js','utf8');
const shim=fs.readFileSync('tests/fixtures/vidlove-vueo-url-shim.js','utf8');
const URLNative=URL;
function payload(id='12345'){return {meta:{id:Number(id),title:'Fixture',original_language:'en'},source:{label:'MovieBox',source:'moviebox',url:'https://a2.ravenflix.st/api?d=auto',qualities:[{type:'mp4',quality:'1080p',codec:'h264',url:'https://a2.ravenflix.st/api?d=1080'},{type:'mp4',quality:'480p',url:'https://a2.ravenflix.st/api?d=480'}]},subtitles:[{label:'Malay',file:'https://subs.example/ms.vtt'}]};}
function record(id='12345',type='movie',s,e){return {status:200,url:'https://api.vidlove.cc/'+type+'?id='+id+(type==='tv'?'&season='+s+'&episode='+e:'')+'&mode=json&sources=moviebox&vh=1',body:payload(id)};}
function session(r=record()){return {sessionResponseVersion:1,responses:[r],streams:[{url:r.body.source.url,headers:{'User-Agent':'Browser fixture',Referer:'https://player.vidlove.cc/embed/movie/12345',Cookie:'fixture'},networkObserved:true}]};}
function load(reply=session(),nativePayload=null){let webCalls=0;const calls=[];const c={module:{exports:{}},setTimeout,clearTimeout,console:{log(){}},fetch:async(url,opts)=>{calls.push(url);return {ok:true,status:200,json:async()=>nativePayload||{meta:null,source:null}};},webviewResolve:async(url,options)=>{webCalls++;assert.equal(options.waitForMediaReady,true);assert.equal(options.captureSessionResponses,true);assert.equal(options.jsonResponsePrefixes[0],'https://api.vidlove.cc/');assert(options.timeoutMs<=8000);assert.equal(options.blockMatchedRequests,false);if(reply instanceof Error)throw reply;return typeof reply==='function'?reply(url,options):reply;},__vueoUrlOp:raw=>{const a=JSON.parse(raw),u=new URLNative(a.input,a.base||undefined);return JSON.stringify({href:u.href,origin:u.origin,protocol:u.protocol,hostname:u.hostname,host:u.host,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash,queryPairs:Array.from(u.searchParams.entries())});}};vm.createContext(c);vm.runInContext(shim,c);vm.runInContext(code,c);return {get:(...a)=>c.module.exports.getStreams(...a),calls,webCalls:()=>webCalls};}
let n=0;async function test(name,fn){await fn();n++;console.log('PASS',name);}
(async()=>{
 await test('native success never opens browser',async()=>{const f=load(session(),payload());assert.equal((await f.get('12345','movie')).length,1);assert.equal(f.webCalls(),0);});
 await test('all five empty responses trigger exactly one browser session',async()=>{const f=load((url)=>{assert.equal(url,'https://player.vidlove.cc/embed/movie/12345');return session();});const out=await f.get('12345','movie');assert.equal(f.calls.length,5);assert.equal(f.webCalls(),1);assert.equal(out.length,1);assert.equal(out[0].quality,'1080p');assert.equal(out[0].subtitles[0].language,'Malay');assert.equal(out[0].headers.Cookie,'fixture');assert.equal(out[0].headers['User-Agent'],'Browser fixture');});
 await test('TV exact episode route, season zero and string envelope',async()=>{const f=load((url)=>{assert.equal(url,'https://player.vidlove.cc/embed/tv/24680/0/2');return JSON.stringify(session(record('24680','tv',0,2)));});assert.equal((await f.get('24680','series',0,2)).length,1);});
 for(const [name,mutate] of [
  ['different request ID',s=>s.responses[0].url=s.responses[0].url.replace('id=12345','id=999')],
  ['different metadata ID',s=>s.responses[0].body.meta.id=999],
  ['different API host',s=>s.responses[0].url=s.responses[0].url.replace('api.vidlove.cc','other.example')],
  ['different media type',s=>s.responses[0].url=s.responses[0].url.replace('/movie?','/tv?')],
  ['failed response status',s=>s.responses[0].status=403],
  ['explicit dubbed audio',s=>s.responses[0].body.source.audioLanguage='hi'],
  ['only low resolution',s=>s.responses[0].body.source.qualities.shift()],
  ['basic bridge without captured JSON',s=>delete s.sessionResponseVersion],
 ]) await test('reject '+name,async()=>{let s=session();mutate(s);assert.equal((await load(s).get('12345','movie')).length,0);});
 await test('reject other TV episode',async()=>assert.equal((await load(session(record('24680','tv',1,3))).get('24680','tv',1,2)).length,0));
 await test('ignore unrelated records before eligible response',async()=>{let s=session();s.responses.unshift({...record(),url:'https://api.vidlove.cc/tmdb/3/movie/12345'});assert.equal((await load(s).get('12345','movie')).length,1);});
 await test('never copy cookies to another media origin',async()=>{let s=session();s.responses[0].body.source.qualities[0].url='https://other.example/1080.mp4';const out=await load(s).get('12345','movie');assert.equal(out.length,1);assert.equal(out[0].headers.Cookie,undefined);});
 await test('browser exception returns empty',async()=>assert.equal((await load(new Error('bridge failure')).get('12345','movie')).length,0));
 await test('invalid request opens no browser',async()=>{const f=load();assert.equal((await f.get('12345','tv',1)).length,0);assert.equal(f.webCalls(),0);assert.equal(f.calls.length,0);});
 console.log(n+' browser fallback checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
