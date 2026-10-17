const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../providers/vidlink.js'),'utf8');
const raw='https://cdn.test/resource/film.mp4?sign=api',observed='https://flood.sourcerrr.online/mp/resource/film.mp4?sign=browser&headers=%7B%7D&host=https%3A%2F%2Fcdn.test';
function load(mode='ok'){
 const calls=[],sessions=[],logs=[];
 const s={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:x=>logs.push(x),warn(){},error(){}},webviewResolve:async(url,opts)=>{
  sessions.push({url,opts});assert.equal(calls.length,1);
  if(mode==='oldapp')return {streams:[]};
  const row={url:mode==='wrongfile'?observed.replace('film.mp4','other.mp4'):mode==='wronghost'?observed.replace('cdn.test','other.test'):mode==='bloburl'?'blob:https://vidlink.pro/id':observed,mediaReady:!['timeout','timeout428','unsupported','js-first'].includes(mode),networkObserved:mode!=='notnetwork',headers:{Cookie:'session=private',Origin:'https://vidlink.pro',Referer:'https://vidlink.pro/movie/1288069','User-Agent':'native-ua'}};
  return {networkHandoffVersion:mode==='unsupported'?undefined:1,blobHandoffVersion:1,readinessBasis:mode==='blob'?'blob-single-network':'direct-http',sessionHandoffVersion:1,mediaReady:!['timeout','timeout428','unsupported','js-first'].includes(mode),finishReason:['timeout','timeout428','unsupported'].includes(mode)?'timeout':mode==='js-first'?'network-candidate':'media-ready',capturedCount:1,sessionDiagnosticsVersion:1,diagnostics:{hookSeen:true,pageFinished:true,pageHttpStatus:0,mediaHttpStatus:mode==='timeout'?428:0,pageNetworkError:0,mediaNetworkError:0,mseObserved:false,blobObserved:false,video:{count:1,readyState:mode==='timeout'?0:2,networkState:2,errorCode:0,paused:true,sourceKind:'https',pageSignal:'none',visibility:'hidden'},secret:'do-not-log',cookie:'do-not-log'},streams:mode==='empty'?[]:mode==='js-first'?[Object.assign({},row,{url:row.url.replace('film.mp4','other.mp4'),networkObserved:false}),row]:[row]};
 },fetch:async(url,opts)=>{
  calls.push({url,opts});
  if(url.startsWith('https://vidlink.pro/api/b/'))return {ok:true,status:200,json:async()=>({sourceId:'Primary',stream:{qualities:{720:{url:raw,type:'mp4',requiresProxy:true}},captions:[]}})};
  assert.equal(sessions.length,1);return {ok:!['428','timeout428'].includes(mode),status:['428','timeout428'].includes(mode)?428:206,url,headers:{get:k=>({'content-type':mode==='html'?'text/html':'video/mp4','content-range':'bytes 0-1023/5000000','content-length':'1024'})[k]||null},text:async()=>''};
 }};
 vm.runInNewContext(source,s);return {get:s.module.exports.getStreams,calls,sessions,logs};
}
(async()=>{
 let x=load(),out=await x.get(1288069,'movie');assert.equal(out.length,1);assert.equal(x.calls.length,2);assert.equal(x.sessions.length,1);assert.equal(x.sessions[0].url,'https://vidlink.pro/movie/1288069');assert.equal(x.sessions[0].opts.waitForMediaReady,true);assert.equal(x.sessions[0].opts.allowBlobMediaReady,true);assert.deepStrictEqual(Array.from(x.sessions[0].opts.mediaHosts),['flood.sourcerrr.online']);assert.deepStrictEqual(Array.from(x.sessions[0].opts.mediaRequestMatchers),['https://flood.sourcerrr.online/mp/resource/film.mp4?host=https%3A%2F%2Fcdn.test']);assert.equal(out[0].url,observed);assert.equal(out[0].headers.Cookie,'session=private');assert.equal(out[0].headers['User-Agent'],'native-ua');assert(!out[0].headers.Range);assert.equal(x.calls[1].opts.headers.Range,'bytes=0-1023');assert(!x.logs.join('').includes('private'));
 for(const mode of ['oldapp','wrongfile','wronghost','notnetwork','empty','bloburl']){x=load(mode);assert.equal((await x.get(1288069,'movie')).length,0,mode);assert.equal(x.calls.length,1,mode);}
 for(const mode of ['428','html','timeout428']){x=load(mode);assert.equal((await x.get(1288069,'movie')).length,0,mode);assert.equal(x.calls.length,2,mode);assert(x.logs.some(l=>l.includes('HANDOFF_HTTP: status=')));}
 for(const mode of ['timeout','unsupported','js-first']){x=load(mode);assert.equal((await x.get(1288069,'movie')).length,1,mode);assert.equal(x.calls.length,2,mode);assert.equal(x.sessions.length,1);assert(x.logs.some(l=>l.includes('browserReady=false')));assert(x.logs.some(l=>l.includes('apiMatched=1')));assert(!x.logs.join('').includes('do-not-log'));}
 x=load('blob');assert.equal((await x.get(1288069,'movie')).length,1);assert.equal(x.calls.length,2);assert(x.logs.some(l=>l.includes('basis=blob-single-network')));
 x=load();await x.get(80539,'tv',1,2);assert.equal(x.sessions[0].url,'https://vidlink.pro/tv/80539/1/2');
 console.log('PASS: one API/session/probe; expected route/upstream matchers; ready=false and timeout reach HTTP; native-observed + API identity required; JS-only/unmatched/blob rejection; 428/HTML rejection; old companion compatibility; session header handoff; scalar-only logs');
})().catch(e=>{console.error(e);process.exit(1)});
