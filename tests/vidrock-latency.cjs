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
async function replay(src,{w=world(),bridge=true,fast=false,badFirst=false,badSecond=false,stale=false,duplicate=false,subtitles='ready',query=false,allLate=false,rotation='a',requestId='55',mediaType='movie',season=1,episode=1}={}){
 let start=w.now,calls=[],logs=[],done=false,value,error,staleUsed=false;class ClockDate extends Date{static now(){return w.now;}}
 const wait=n=>new Promise(resolve=>w.set(resolve,n)),prefix=Buffer.alloc(600);prefix[0]=71;prefix[1]=64;prefix[3]=16;prefix.set([0,0,1,103],10);
 const ctx={module:{exports:{}},URL,Uint8Array,atob,Date:ClockDate,setTimeout:w.set,clearTimeout:w.clear,console:{log:x=>logs.push(x)},VUEO_DISCOVERY_CONTEXT:{title:'Fixture',mediaType:mediaType,tmdbId:requestId,originalLanguage:'en'},fetch:async(url,opts)=>{
  calls.push(url);assert.equal(opts.headers.Origin,'https://vidrock.net');let ms,body,status=200;
  if(url==='https://vidrock.net/'){ms=1000;body='<script src="/assets/index-fixture.js"></script>';}
  else if(url.includes('/assets/')){ms=1600;body='const publicKey="'+key+'"; /* AES-GCM importKey decrypt */';}
  else if(url.includes('/api/')){ms=1000;let first='https://first.test/token',second=duplicate?first:(rotation==='a'?'https://second.test/master.m3u8':'https://rotated.test/new-token/master.m3u8')+(query?'?signature=temporary':'');body=JSON.stringify({First:{url:seal(first),language:'Unknown'},Second:{url:seal(second),language:'Unknown'}});}
  else if(url.startsWith('https://sub.vdrk.site/')){
   if(subtitles==='hang')return new Promise(()=>{});
   ms=500;status=subtitles==='fallback'&&url.includes('/v1/')?404:200;
   body=JSON.stringify(subtitles==='none'?[]:[{label:'English 2',file:'https://caption.test/English%202.vtt'},{label:'English',file:'https://caption.test/English.vtt'},{label:'Malay',file:'https://caption.test/Malay.vtt'}]);
  }else{
   let first=url.includes('first.test');
   if(url.includes('/master.m3u8')||url.endsWith('/token')){ms=first?500:2894;body='#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x800,CODECS="avc1.640028"\n'+(stale===true&&!first?'new-video.m3u8':'video.m3u8');}
   else if(url.endsWith('/video.m3u8')||url.endsWith('/new-video.m3u8')){ms=first?774:5047;body='#EXTM3U\n#EXTINF:6,\nsegment.ts';if(stale&&!first&&url.endsWith('/video.m3u8')&&!staleUsed){staleUsed=true;ms=100;if(stale==='segment')body='#EXTM3U\n#EXTINF:6,\nbad-segment.ts';else status=404;}}
   else if(url.endsWith('/bad-segment.ts')){ms=1;body='<html>expired media</html>';}
   else if(url.endsWith('/segment.ts')){assert.equal(opts.headers.Range,'bytes=0-8191');ms=first?2758:2536;body=(first?badFirst:badSecond)?'<html>error</html>':prefix.toString('utf8');}
   else throw Error('Unexpected synthetic request');
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
 let w=world(),cold=await replay(source,{w});assert.equal(cold.count,2);assert.equal(cold.elapsed,11477);assert(cold.logs.some(x=>x.includes('keyCache=website-bootstrap')));assert(cold.calls.includes('https://second.test/master.m3u8'));assert(cold.sources.every(x=>x.subtitles.some(s=>s.language==='en')&&x.subtitles.some(s=>s.language==='ms')));
 w.advance(10);let warm=await replay(source,{w});assert.equal(warm.count,2);assert.equal(warm.elapsed,8583);assert(warm.logs.some(x=>x.includes('keyCache=hit')));assert(warm.logs.some(x=>x.includes('variantHits=1')));assert(!warm.calls.includes('https://vidrock.net/'));assert(!warm.calls.includes('https://second.test/master.m3u8'));assert(warm.calls.includes('https://second.test/video.m3u8'));assert(warm.calls.includes('https://second.test/segment.ts'));assert(!warm.calls.some(x=>x.startsWith('https://sub.vdrk.site/')));assert(warm.sources.every(x=>x.subtitles.length===3));
 let expiredWorld=cold.w;expiredWorld.advance(61000);let expired=await replay(source,{w:expiredWorld});assert.equal(expired.count,2);assert.equal(expired.elapsed,11477);assert(expired.calls.includes('https://second.test/master.m3u8'));
 let staleWorld=world();await replay(source,{w:staleWorld});let repaired=await replay(source,{w:staleWorld,stale:true});assert.equal(repaired.count,2);assert(repaired.logs.some(x=>x.includes('VARIANT_CACHE: stale')));assert(repaired.calls.includes('https://second.test/new-video.m3u8'));
 let sameWorld=world();await replay(source,{w:sameWorld});let sameRepair=await replay(source,{w:sameWorld,stale:'segment'});assert.equal(sameRepair.count,2);assert.equal(sameRepair.calls.filter(x=>x==='https://second.test/video.m3u8').length,2);assert(sameRepair.logs.some(x=>x.includes('VARIANT_CACHE: stale')));
 let tokenWorld=world();await replay(source,{w:tokenWorld,query:true});let signed=await replay(source,{w:tokenWorld,query:true});assert(signed.calls.some(x=>x.includes('master.m3u8?signature=')));assert(signed.logs.some(x=>x.includes('variantHits=0')));
 let fallback=await replay(source,{subtitles:'fallback'});assert.equal(fallback.count,2);assert.equal(fallback.sources[0].subtitles.length,3);assert(fallback.calls.some(x=>x.includes('/v2/movie/55')));
 let noDelay=await replay(source,{fast:true,subtitles:'hang'});assert.equal(noDelay.count,2);assert.equal(noDelay.elapsed,1225);assert.equal(noDelay.sources[0].subtitles.length,0);
 let invalid=await replay(source,{badFirst:true});assert.equal(invalid.count,1);assert.equal(invalid.elapsed,11477);
 let failed=await replay(source,{badFirst:true,badSecond:true});assert.equal(failed.count,0);
 let end=await replay(source,{allLate:true});assert.equal(end.count,0);assert.equal(end.elapsed,17500);
 let retained=await replay(source,{allLate:'retain'});assert.equal(retained.count,1);assert.equal(retained.elapsed,17500);
 let dup=await replay(source,{duplicate:true});assert.equal(dup.count,1);assert.equal(dup.calls.filter(x=>x==='https://first.test/token').length,1);
 let movingWorld=world();await replay(source,{w:movingWorld});let moved=await replay(source,{w:movingWorld,rotation:'b'});assert.equal(moved.count,2);assert.equal(moved.elapsed,8583);assert(moved.logs.some(x=>x.includes('variantHits=1')));assert(!moved.calls.includes('https://rotated.test/new-token/master.m3u8'));assert(moved.calls.includes('https://rotated.test/new-token/video.m3u8'));assert(moved.calls.includes('https://rotated.test/new-token/segment.ts'));assert(!moved.calls.some(x=>x.includes('second.test')));
 let another=await replay(source,{w:movingWorld,requestId:'56'});assert.equal(another.count,2);assert(another.calls.includes('https://second.test/master.m3u8'));assert(another.logs.some(x=>x.includes('variantHits=0')));
 let tvWorld=world();await replay(source,{w:tvWorld,mediaType:'tv',season:1,episode:1});let nextEpisode=await replay(source,{w:tvWorld,mediaType:'tv',season:1,episode:2});assert(nextEpisode.calls.includes('https://second.test/master.m3u8'));assert(nextEpisode.logs.some(x=>x.includes('variantHits=0')));
 if(process.env.VIDROCK_V3_BASELINE){let previous=fs.readFileSync(process.env.VIDROCK_V3_BASELINE,'utf8'),oldWorld=world();await replay(previous,{w:oldWorld});let oldMoved=await replay(previous,{w:oldWorld,rotation:'b'});assert.equal(oldMoved.count,2);assert.equal(oldMoved.elapsed,11477);console.log('ROTATING-URL replay: 3.0.0 '+oldMoved.elapsed+'ms/2 links; 3.1.0 '+moved.elapsed+'ms/2 links; '+Math.round((1-moved.elapsed/oldMoved.elapsed)*100)+'% faster.');}
 if(process.env.VIDROCK_BASELINE){let old=await replay(fs.readFileSync(process.env.VIDROCK_BASELINE,'utf8'));assert.equal(old.count,1);assert.equal(old.elapsed,8132);console.log('CONTROLLED replay: 2.1.0 cold '+old.elapsed+'ms/1 link; 3.0.0 cold '+cold.elapsed+'ms/2 links; 3.0.0 warm '+warm.elapsed+'ms/2 links.');}
 console.log('PASS: both sources retained; public-key cache across disposable runtimes; public-rendition cache skips master only; fresh child/segment probes; expiry/stale repair; signed query excluded; subtitle payload/fallback/non-blocking; deduplication; deadlines; timer cleanup; no late requests/logs.');
})().catch(e=>{console.error(e);process.exitCode=1});
