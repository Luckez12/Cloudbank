const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../providers/vidlink.js'),'utf8');
const raw='https://cdn.test/resource/film.mp4?sign=api',observed='https://flood.sourcerrr.online/mp/resource/film.mp4?sign=browser&headers=%7B%7D&host=https%3A%2F%2Fcdn.test';
function load(mode='ok'){
 const calls=[],sessions=[],logs=[];
 const s={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:x=>logs.push(x),warn(){},error(){}},webviewResolve:async(url,opts)=>{
  sessions.push({url,opts});assert.equal(calls.length,1);
  if(mode==='oldapp')return {streams:[]};
  const row={url:mode==='wrongfile'?observed.replace('film.mp4','other.mp4'):observed,mediaReady:true,networkObserved:mode!=='notnetwork',headers:{Cookie:'session=private',Origin:'https://vidlink.pro',Referer:'https://vidlink.pro/movie/1288069','User-Agent':'native-ua'}};
  return {sessionHandoffVersion:1,mediaReady:mode!=='timeout',finishReason:mode==='timeout'?'timeout':'media-ready',capturedCount:1,streams:[row]};
 },fetch:async(url,opts)=>{
  calls.push({url,opts});
  if(url.startsWith('https://vidlink.pro/api/b/'))return {ok:true,status:200,json:async()=>({sourceId:'Primary',stream:{qualities:{720:{url:raw,type:'mp4',requiresProxy:true}},captions:[]}})};
  assert.equal(sessions.length,1);return {ok:mode!=='428',status:mode==='428'?428:206,url,headers:{get:k=>({'content-type':mode==='html'?'text/html':'video/mp4','content-range':'bytes 0-1023/5000000','content-length':'1024'})[k]||null},text:async()=>''};
 }};
 vm.runInNewContext(source,s);return {get:s.module.exports.getStreams,calls,sessions,logs};
}
(async()=>{
 let x=load(),out=await x.get(1288069,'movie');assert.equal(out.length,1);assert.equal(x.calls.length,2);assert.equal(x.sessions.length,1);assert.equal(x.sessions[0].url,'https://vidlink.pro/movie/1288069');assert.equal(x.sessions[0].opts.waitForMediaReady,true);assert.deepStrictEqual(Array.from(x.sessions[0].opts.mediaHosts),['flood.sourcerrr.online']);assert.equal(out[0].url,observed);assert.equal(out[0].headers.Cookie,'session=private');assert.equal(out[0].headers['User-Agent'],'native-ua');assert(!out[0].headers.Range);assert.equal(x.calls[1].opts.headers.Range,'bytes=0-1023');assert(!x.logs.join('').includes('private'));
 for(const mode of ['timeout','oldapp','wrongfile','notnetwork']){x=load(mode);assert.equal((await x.get(1288069,'movie')).length,0,mode);assert.equal(x.calls.length,1,mode);}
 for(const mode of ['428','html']){x=load(mode);assert.equal((await x.get(1288069,'movie')).length,0,mode);assert.equal(x.calls.length,2,mode);}
 x=load();await x.get(80539,'tv',1,2);assert.equal(x.sessions[0].url,'https://vidlink.pro/tv/80539/1/2');
 console.log('PASS: one API/session/check; ready + matching observed network media required; browser URL/signature/header handoff; blocked post-session HTTP rejection; missing companion/timeout/identity rejection; no cookie values logged');
})().catch(e=>{console.error(e);process.exit(1)});
