// Virtual-time checks; synthetic HLS/TS/subtitle fixtures, no real media or movie IDs.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const source=fs.readFileSync(path.join(__dirname,'../providers/vidrock.js'),'utf8'),key=/BOOTSTRAP_KEY\s*=\s*'([0-9a-f]{64})'/.exec(source)[1];
function seal(url){let iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);return Buffer.concat([iv,c.update(url),c.final(),c.getAuthTag()]).toString('base64url');}
async function flush(){for(let n=0;n<100;n++)await Promise.resolve();}
function world(){let now=1000000,serial=0,timers=new Map(),store=new Map();return {
 get now(){return now;},advance:n=>now+=n,timers,
 set:(fn,ms)=>{let id=++serial;timers.set(id,{fn,at:now+Math.max(ms,0)});return id;},clear:id=>timers.delete(id),
 async next(){await flush();let x=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!x)return false;timers.delete(x[0]);now=x[1].at;x[1].fn();await flush();return true;},
 bridge:raw=>{let r=JSON.parse(raw),old=store.get(r.key);if(old&&old.exp<=now){store.delete(r.key);old=null;}if(r.op==='get')return old?JSON.stringify(old.value):'null';if(r.op==='remove'){store.delete(r.key);return 'true';}if(r.op==='put'){store.set(r.key,{value:r.value,exp:now+Math.min(r.ttlMs,300000)});return 'true';}return 'null';}
};}
async function replay(src,{w=world(),bridge=true,fast=false,badFirst=false,badSecond=false,stale=false,duplicate=false,subtitles='ready',query=false,allLate=false,rotation='a',requestId='55',mediaType='movie',season=1,episode=1,apiDelay=1000,badMaster=false,jsonRoot=false}={}){
 let start=w.now,calls=[],logs=[],done=false,value,error,staleUsed=false;class ClockDate extends Date{static now(){return w.now;}}
 const wait=n=>new Promise(resolve=>w.set(resolve,n)),prefix=Buffer.alloc(600);prefix[0]=71;prefix[1]=64;prefix[3]=16;prefix.set([0,0,1,103],10);
 const ctx={module:{exports:{}},URL,Uint8Array,atob,Date:ClockDate,setTimeout:w.set,clearTimeout:w.clear,console:{log:x=>logs.push(x)},VUEO_DISCOVERY_CONTEXT:{title:'Fixture',mediaType:mediaType,tmdbId:requestId,originalLanguage:'en'},fetch:async(url,opts)=>{
  calls.push(url);assert.equal(opts.headers.Origin,'https://vidrock.net');let ms,body,status=200;
  if(url==='https://vidrock.net/'){ms=1000;body='<script src="/assets/index-fixture.js"></script>';}
  else if(url.includes('/assets/')){ms=1600;body='const publicKey="'+key+'"; /* AES-GCM importKey decrypt */';}
  else if(url.includes('/api/')){ms=apiDelay;let first='https://first.test/token',second=duplicate?first:(rotation==='a'?'https://second.test/master.m3u8':'https://rotated.test/new-token/master.m3u8')+(query?'?signature=temporary':'');body=JSON.stringify({First:{url:seal(first),language:'Unknown'},Second:{url:seal(second),language:'Unknown'}});}
  else if(url.startsWith('https://sub.vdrk.site/')){
   if(subtitles==='hang')return new Promise(()=>{});
   ms=500;status=subtitles==='fallback'&&url.includes('/v1/')?404:200;
   body=JSON.stringify(subtitles==='none'?[]:[{label:'English 2',file:'https://caption.test/English%202.vtt'},{label:'English',file:'https://caption.test/English.vtt'},{label:'Malay',file:'https://caption.test/Malay.vtt'}]);
  }else{
   let first=url.includes('first.test');if(url.endsWith('/selected')){ms=6000;body='#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nvideo.m3u8';await wait(ms);return {ok:true,status:200,url,headers:{get:()=> 'text/html'},text:async()=>body};}
   if(url.includes('/master.m3u8')||url.endsWith('/token')){ms=first?500:2894;body='#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x800,CODECS="avc1.640028"\n'+(stale===true&&!first?'new-video.m3u8':'video.m3u8');}
   else if(url.endsWith('/video.m3u8')||url.endsWith('/new-video.m3u8')){ms=first?774:5047;body='#EXTM3U\n#EXTINF:6,\nsegment.ts';if(stale&&!first&&url.endsWith('/video.m3u8')&&!staleUsed){staleUsed=true;ms=100;if(stale==='segment')body='#EXTM3U\n#EXTINF:6,\nbad-segment.ts';else status=404;}}
   else if(url.endsWith('/bad-segment.ts')){ms=1;body='<html>expired media</html>';}
   else if(url.endsWith('/segment.ts')){assert.equal(opts.headers.Range,'bytes=0-8191');ms=first?2758:2536;body=(first?badFirst:badSecond)?'<html>error</html>':prefix.toString('utf8');}
   else throw Error('Unexpected synthetic request');
   if((jsonRoot===true||jsonRoot==='second'&&!first)&&(url.includes('/master.m3u8')||url.endsWith('/token'))){body=JSON.stringify([{resolution:1080,url:new URL('/selected',url).href}]);ms=6000;}
   if(badMaster&&first)body='<html>not HLS</html>';
   if(fast)ms=first?50:75;if(allLate)ms=url.endsWith('/segment.ts')?(allLate==='retain'&&first?2600:3700):6900;
  }
  await wait(ms);return {ok:status===200,status,url,headers:{get:()=> 'text/html'},text:async()=>body};
 }};
 if(bridge)ctx.vueoMetadataCache=w.bridge;vm.createContext(ctx);vm.runInContext(src,ctx);
 ctx.module.exports.getStreams(requestId,mediaType,season,episode).then(x=>{done=true;value=x;},e=>{done=true;error=e;});await flush();
 for(let n=0;!done&&n<300;n++)if(!await w.next())throw Error('Request stalled');assert(done);if(error)throw error;let elapsed=w.now-start;
 await flush();let count=value.length,requests=calls.length,logCount=logs.length;for(let n=0;w.timers.size&&n<300;n++)await w.next();
 assert.equal(value.length,count);assert.equal(calls.length,requests);assert.equal(logs.length,logCount);assert.equal(w.timers.size,0);
 return {elapsed,count,calls,logs,sources:value,w};
}
(async()=>{
 const w=world(),cold=await replay(source,{w});assert.equal(cold.count,2);assert.equal(cold.elapsed,3894);assert(cold.sources.every(x=>x.isAdaptive&&x.quality==='Auto'));assert(cold.sources.every(x=>x.subtitles.length===3));assert(!cold.calls.some(x=>x.includes('/video.m3u8')||x.includes('/segment.ts')));assert.equal(cold.calls.filter(x=>x.includes('first.test')||x.includes('second.test')).length,2);
 const warm=await replay(source,{w});assert.equal(warm.count,2);assert.equal(warm.elapsed,3894);assert(warm.logs.some(x=>x.includes('keyCache=hit')));assert(!warm.calls.some(x=>x.startsWith('https://sub.vdrk.site/')));
 const moved=await replay(source,{w,rotation:'b'});assert.equal(moved.count,2);assert(moved.calls.includes('https://rotated.test/new-token/master.m3u8'));assert(!moved.calls.some(x=>x.includes('second.test')));assert(moved.sources.some(x=>x.url==='https://rotated.test/new-token/master.m3u8'));
 const bad=await replay(source,{badMaster:true});assert.equal(bad.count,1);assert.equal(bad.elapsed,3894);
 const downstream=await replay(source,{badFirst:true,badSecond:true});assert.equal(downstream.count,2);assert(!downstream.calls.some(x=>x.includes('segment.ts'))); // downstream playback is delegated to the player
 const quick=await replay(source,{fast:true,subtitles:'hang'});assert.equal(quick.count,2);assert.equal(quick.elapsed,1075);assert.equal(quick.sources[0].subtitles.length,0);
 const deadline=await replay(source,{apiDelay:9000,jsonRoot:true});assert.equal(deadline.count,0);assert.equal(deadline.elapsed,17500);
 const retained=await replay(source,{apiDelay:9000,jsonRoot:'second'});assert.equal(retained.count,1);assert.equal(retained.elapsed,17500);
 const fallback=await replay(source,{subtitles:'fallback'});assert.equal(fallback.count,2);assert(fallback.sources.every(x=>x.subtitles.length===3));
 const dup=await replay(source,{duplicate:true});assert.equal(dup.count,1);assert.equal(dup.calls.filter(x=>x==='https://first.test/token').length,1);
 if(process.env.VIDROCK_V31_BASELINE){const previous=fs.readFileSync(process.env.VIDROCK_V31_BASELINE,'utf8'),old=await replay(previous);assert.equal(old.count,2);assert.equal(old.elapsed,11477);assert.equal(old.calls.filter(x=>x.includes('first.test')||x.includes('second.test')).length,6);console.log('CONTROLLED cold replay: 3.1.0 '+old.elapsed+'ms / 6 host requests / 2 links; 4.0.0 '+cold.elapsed+'ms / 2 host requests / 2 original masters.');}
 console.log('PASS: one master fetch per source; no rendition/segment probes; both original masters retained; Auto quality; cold/warm/rotating URL paths; subtitle behavior; duplicate routes; deadline retention; cleanup/no late work.');
})().catch(e=>{console.error(e);process.exitCode=1});
