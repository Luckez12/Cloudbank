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
(async()=>{let count=0;const pass=x=>{count++;console.log('PASS',x);};
 let sg=gate(),f=load({subGate:sg});let out=await Promise.race([f.get('12345','movie'),new Promise((_,bad)=>setTimeout(()=>bad(Error('video waited for subtitles')),200))]);
 assert.equal(out.length,1);assert.equal(out[0].subtitles,undefined);assert.equal(out[0].subtitleRequests,undefined);assert.equal(out[0].url,'https://media.example/master.m3u8');assert.equal(out[0].format,'hls');assert(f.aborted());pass('slow subtitles cancelled without holding video or using deferred API');
 let vg=gate();f=load({videoGate:vg,subtitles:[row('en'),row('ms'),row('fr'),row('id'),row('ar')]});const pending=f.get('12345','movie');await flush();assert.equal(f.calls.filter(c=>c.url.includes('/subtitles/')).length,1);assert(f.calls.some(c=>c.url.includes('/movie?')));pass('one subtitle list starts alongside video engines');vg.resolve();out=await pending;assert.equal(out[0].subtitles.length,2);assert.deepEqual(Array.from(out[0].subtitles,t=>t.language),['en','ms']);pass('already-ready English and Malay tracks included; other languages excluded');
 f=load({payload:[row('en-US'),row('ms-MY'),row('fr')],subGate:gate()});out=await f.get('12345','movie');assert.deepEqual(Array.from(out[0].subtitles,t=>t.language),['en','ms']);assert(f.aborted());pass('payload tracks use the same language filter and do not wait');
 const variants=['en','eng','en_US','en-GB','English SDH','ms','msa','may','ms-MY','Malay','Bahasa Melayu','Bahasa Malaysia'];f=load({payload:variants.map((v,i)=>row(v,'https://subs.example/'+i+'.vtt'))});out=await f.get('12345','movie');assert.equal(out[0].subtitles.length,variants.length);pass('English and Malay codes and labels recognized');
 f=load({empty:true,subGate:gate()});assert.equal((await f.get('12345','movie')).length,0);assert(f.aborted());pass('no video cancels pending subtitle work');
 f=load({payload:[row('English')],subGate:gate()});out=await f.get('12345','tv',0,7);assert(f.calls.some(c=>c.url==='https://api.vidlove.cc/subtitles/tv/12345/0/7'));pass('TV subtitle request preserves exact season zero and episode');
 const jg=gate();f=load({jsonGate:jg});out=await f.get('12345','movie');assert.equal(out[0].subtitles,undefined);jg.resolve([row('en')]);await flush();assert.equal(out[0].subtitles,undefined);pass('JSON not parsed at video completion is discarded and cannot mutate results');
 f=load({abort:false,subGate:gate()});out=await f.get('12345','movie');assert.equal(out.length,1);assert.equal(out[0].subtitleRequests,undefined);pass('host without AbortController still returns video immediately');
 f=load();assert.equal((await f.get('invalid','movie')).length,0);assert.equal(f.calls.length,0);pass('invalid request starts no video or subtitle work');
 vg=gate();f=load({videoGate:vg,subtitles:{subtitles:[row('eng','https://subs.example/same.vtt'),row('msa')]},payload:[row('English','https://subs.example/same.vtt')]});const merged=f.get('12345','movie');await flush();vg.resolve();out=await merged;assert.equal(out[0].subtitles.length,2);pass('payload and ready endpoint rows merge without duplicate URLs');
 console.log(count+' parallel no-wait subtitle checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
