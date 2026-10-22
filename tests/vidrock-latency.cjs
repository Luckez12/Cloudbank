// Deterministic virtual time. Synthetic HLS and TS-prefix fixtures only.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const source=fs.readFileSync(path.join(__dirname,'../providers/vidrock.js'),'utf8');
const key='0123456789abcdef'.repeat(4);
function seal(url){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);return Buffer.concat([iv,c.update(url),c.final(),c.getAuthTag()]).toString('base64url');}
async function flush(){for(let i=0;i<100;i++)await Promise.resolve();}
async function replay(src,{second=13077,badFirst=false,badSecond=false,allHung=false,allLate=false,delayFirst=6632}={}){
 let now=1000000,origin=now,serial=0,timers=new Map(),calls=[],logs=[],resolved=false,value,error;
 const timeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+Math.max(0,ms)});return id;};
 const clear=id=>timers.delete(id),wait=ms=>new Promise(done=>timeout(done,ms));
 class FakeDate extends Date{static now(){return now;}}
 const ctx={module:{exports:{}},console:{log:s=>logs.push(s)},setTimeout:timeout,clearTimeout:clear,Date:FakeDate,URL,Uint8Array,atob,VUEO_DISCOVERY_CONTEXT:{title:'Fixture',mediaType:'movie',tmdbId:55,originalLanguage:'en'},fetch:async(url,opts)=>{
  calls.push({url,at:now-origin});assert.equal(opts.headers.Origin,'https://vidrock.net');let body,ms;
  if(url==='https://vidrock.net/'){body='<script src="/assets/index-fixture.js"></script>';ms=1000;}
  else if(url.includes('/assets/')){body='const websiteKey="'+key+'"; /* AES-GCM importKey decrypt */';ms=1000;}
  else if(url.includes('/api/')){body=JSON.stringify({First:{url:seal('https://first.test/master'),language:'Unknown'},Second:{url:seal('https://second.test/master'),language:'Unknown'}});ms=2600;}
  else{
   const first=url.includes('first.test'),host=first?'https://first.test':'https://second.test';
   if(allHung)return new Promise(()=>{});
   if(url.endsWith('/master')){body='#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x800,CODECS="avc1.640028"\nvideo.m3u8';ms=first?500:second<10541?700:2894;}
   else if(url.endsWith('/video.m3u8')){body='#EXTM3U\n#EXTINF:6,\nsegment.ts';ms=first?774:second<10541?900:5047;}
   else if(url.endsWith('/segment.ts')){
    assert.equal(opts.headers.Range,'bytes=0-8191');const bytes=Buffer.alloc(600);bytes[0]=71;bytes[1]=64;bytes[3]=16;bytes.set([0,0,1,103],10);
    body=(first?badFirst:badSecond)?'<html>not a segment</html>':bytes.toString('utf8');
    ms=(first?delayFirst:second)-(first?3874:second<10541?4200:10541);assert(ms>=0);
   }else throw Error('Unexpected route '+host);
   if(allLate)ms=url.endsWith('/segment.ts')?(allLate==='retain'&&first?1000:2000):6900;
  }
  await wait(ms);return {ok:true,status:200,url,headers:{get:()=> 'text/html'},text:async()=>body};
 }};
 vm.createContext(ctx);vm.runInContext(src,ctx);
 ctx.module.exports.getStreams('55','movie').then(x=>{value=x;resolved=true;},e=>{error=e;resolved=true;});
 async function next(){await flush();let entry=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!entry)return false;timers.delete(entry[0]);now=entry[1].at;entry[1].fn();await flush();return true;}
 await flush();for(let n=0;!resolved&&n<300;n++){if(!await next())throw Error('No timer can complete request');}
 assert(resolved,'request must finish');if(error)throw error;const elapsed=now-origin;
 // Simulate late native fetch completions: no additional requests/logs or result mutations.
 await flush();const count=value.length,requestCount=calls.length,logCount=logs.length;
 for(let n=0;timers.size&&n<300;n++)await next();
 assert.equal(value.length,count);assert.equal(calls.length,requestCount);assert.equal(logs.length,logCount);
 assert(![...timers.values()].some(x=>x.at>now),'provider must clean up its timers');
 return {elapsed,count,calls:calls.length,logs};
}
(async()=>{
 const slow=await replay(source);assert.equal(slow.count,1);assert.equal(slow.elapsed,8132);assert(slow.logs.some(x=>x.includes('firstSourceMs=6632')));assert(slow.logs.some(x=>x.includes('finish=alternative wait elapsed')));
 const together=await replay(source,{second:7500});assert.equal(together.count,2);assert.equal(together.elapsed,7500);
 const invalid=await replay(source,{badFirst:true});assert.equal(invalid.count,1);assert.equal(invalid.elapsed,13077);assert(invalid.logs.some(x=>x.includes('firstSourceMs=13077')));
 const failed=await replay(source,{badFirst:true,badSecond:true});assert.equal(failed.count,0);assert(!failed.logs.some(x=>x.includes('FIRST_SOURCE')));
 const stalled=await replay(source,{allHung:true});assert.equal(stalled.count,0);assert(stalled.elapsed<=17500);
 const deadline=await replay(source,{allLate:true});assert.equal(deadline.count,0);assert.equal(deadline.elapsed,17500);
 const retained=await replay(source,{allLate:'retain'});assert.equal(retained.count,1);assert.equal(retained.elapsed,17500);
 if(process.env.VIDROCK_BASELINE){const old=await replay(fs.readFileSync(process.env.VIDROCK_BASELINE,'utf8'));assert.equal(old.count,2);assert.equal(old.elapsed,13077);console.log('REPLAY comparison: baseline='+old.elapsed+'ms / '+old.count+' sources; new='+slow.elapsed+'ms / '+slow.count+' source; '+Math.round((1-slow.elapsed/old.elapsed)*100)+'% faster.');}
 console.log('PASS: return first validated source +1500ms; retain timely alternatives; invalid first segment does not start grace; no-source/full deadline; no late mutation, requests or logs; timer cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
