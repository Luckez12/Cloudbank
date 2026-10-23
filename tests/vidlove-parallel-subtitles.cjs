const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/vidlove.js','utf8');
const video={meta:{id:12345,title:'Fixture'},source:{url:'https://media.example/master.m3u8'}};
const subs=[{label:'Malay',file:'https://subs.example/ms.vtt'}];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function load({videoPending=false,empty=false,payloadSubs=false}={}){
 let now=0,seq=0;const timers=new Map(),calls=[],sub=deferred(),media=deferred();let aborts=0;
 const c={module:{exports:{}},URL,Date:class extends Date{static now(){return now;}},setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);},console:{log(){}},AbortController:class{constructor(){this.signal={};}abort(){aborts++;}},fetch:async(url,options)=>{calls.push({url,at:now});if(url.includes('/subtitles/'))return {ok:true,status:200,json:()=>sub.promise};const engine=new URL(url).searchParams.get('sources');if(engine!=='vidapi'||empty)return {ok:true,status:200,json:async()=>({meta:null,source:null})};return {ok:true,status:200,json:()=>videoPending?media.promise:Promise.resolve(payloadSubs?{...video,subtitles:subs}:video)};}};
 vm.createContext(c);vm.runInContext(code,c);
 const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
 const advance=async t=>{now=t;for(const [id,x] of [...timers])if(x.at<=now){timers.delete(id);x.fn();}await flush();};
 return {run:()=>c.module.exports.getStreams('12345','movie'),sub,media,calls,flush,advance,timers,aborts:()=>aborts};
}
(async()=>{
 let count=0;const pass=name=>{count++;console.log('PASS',name);};
 let f=load({videoPending:true}),done=false,p=f.run().then(r=>{done=true;return r;});await f.flush();assert(f.calls.some(c=>c.url.includes('/subtitles/')&&c.at===0));assert(f.calls.some(c=>!c.url.includes('/subtitles/')&&c.at===0));pass('video and subtitles start together before video resolves');await f.advance(1400);f.sub.resolve(subs);await f.flush();assert.equal(done,false);await f.advance(1800);f.media.resolve(video);await f.flush();let out=await p;assert.equal(out.length,1);assert.equal(out[0].subtitles[0].language,'Malay');pass('subtitle ready before video adds no post-video delay');
 f=load();done=false;p=f.run().then(r=>{done=true;return r;});await f.flush();await f.advance(2501);assert.equal(done,false);await f.advance(3100);f.sub.resolve(subs);await f.flush();out=await p;assert.equal(out[0].subtitles.length,1);pass('subtitle exceeding old 2.5s timeout is retained');
 f=load({empty:true});p=f.run();await f.flush();assert.equal((await p).length,0);assert.equal(f.aborts(),1);assert.equal(f.timers.size,0);f.sub.resolve(subs);await f.flush();pass('no video cancels subtitle work without waiting; late result harmless');
 f=load({payloadSubs:true});p=f.run();await f.flush();out=await p;assert.equal(out[0].subtitles[0].language,'Malay');assert.equal(f.aborts(),1);assert.equal(f.timers.size,0);pass('payload subtitles cancel redundant pending subtitle work');
 f=load();done=false;p=f.run().then(r=>{done=true;return r;});await f.flush();await f.advance(17499);assert.equal(done,false);await f.advance(17500);out=await p;assert.equal(out.length,1);assert.equal(out[0].subtitles,undefined);assert.equal(f.aborts(),1);assert.equal(f.timers.size,0);pass('shared overall deadline returns video if subtitles never finish');
 console.log(count+' parallel subtitle checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
