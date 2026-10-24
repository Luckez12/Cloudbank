const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/vidlove.js','utf8');
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const video=(subtitles=[])=>({meta:{id:12345,title:'Fixture'},source:{url:'https://media.example/master.m3u8'},subtitles});
const row=(language,url='https://subs.example/'+language+'.vtt')=>({language,file:url});
function load({subtitles=[],empty=false,subGate,videoGate,jsonGate,abort=true,payload=[]}={}){
 const calls=[];let aborted=false;
 const ctx={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log(){}},...(abort?{AbortController}:{}),fetch:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/subtitles/')){
   options.signal?.addEventListener('abort',()=>{aborted=true;subGate?.reject(new Error('aborted'));},{once:true});
   if(subGate)await subGate.promise;
   return{ok:true,status:200,json:async()=>jsonGate?await jsonGate.promise:subtitles};
  }
  if(videoGate)await videoGate.promise;
  return{ok:true,status:200,json:async()=>empty?{source:null}:video(payload)};
 }};
 vm.createContext(ctx);vm.runInContext(code,ctx);return{get:(...args)=>ctx.module.exports.getStreams(...args),calls,aborted:()=>aborted};
}
(async()=>{
 let n=0;const pass=s=>{console.log('PASS '+s);n++;};
 let sg=gate(),f=load({subGate:sg,subtitles:[row('en'),row('ms')]});setTimeout(()=>sg.resolve(),80);let out=await f.get('12345','movie');assert.equal(out[0].subtitles.length,2);pass('late list included within grace');
 sg=gate();f=load({subGate:sg});let t=Date.now();out=await f.get('12345','movie');assert.equal(out.length,1);assert(Date.now()-t>=950&&Date.now()-t<1600);assert(f.aborted());pass('maximum one-second grace, then abort and return video');
 const many=[...Array.from({length:12},(_,i)=>row('en','https://subs.test/en'+i+'.vtt')),...Array.from({length:9},(_,i)=>row('ms','https://subs.test/ms'+i+'.vtt')),row('fr')];
 f=load({payload:many,subGate:gate()});t=Date.now();out=await f.get('12345','movie');assert.equal(out[0].subtitles.filter(x=>x.language==='en').length,5);assert.equal(out[0].subtitles.filter(x=>x.language==='ms').length,5);assert(Date.now()-t<500);assert(f.aborted());pass('full payload quota returns immediately; five English plus five Malay');
 sg=gate();f=load({subGate:sg,subtitles:[row('en')]});setTimeout(()=>sg.resolve(),40);t=Date.now();out=await f.get('12345','movie');assert.equal(out[0].subtitles.length,1);assert(Date.now()-t<500);pass('partial list returns without waiting to fill quota');
 sg=gate();f=load({empty:true,subGate:sg});t=Date.now();out=await f.get('12345','movie');assert.equal(out.length,0);assert(Date.now()-t<500);assert(f.aborted());pass('no video cancels subtitles without grace');
 const vg=gate();f=load({videoGate:vg,subtitles:[row('ms')]});await flush();vg.resolve();out=await f.get('12345','movie');assert.equal(out[0].subtitles.length,1);assert.equal(f.calls.filter(c=>c.url.includes('/subtitles/')).length,1);pass('one subtitle request only');
 console.log(n+' grace checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
