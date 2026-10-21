const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const C=require('crypto-js');
const code=fs.readFileSync(path.join(__dirname,'../providers/moviebox.js'),'utf8');
let checks=0;function check(v,label){assert.ok(v,label);checks++;}
function response(data,status=200,headers={}){
 const h={};Object.keys(headers).forEach(k=>h[k.toLowerCase()]=String(headers[k]));
 return {ok:status>=200&&status<300,status,headers:{get:k=>h[k.toLowerCase()]||null},text:async()=>typeof data==='string'?data:JSON.stringify(data),json:async()=>data};
}
const subject={subjectId:'subject1',subjectType:2,title:'My Demon',releaseDate:'2023-11-24',language:'Korean'};
const resource={resourceId:'r3',resourceLink:'https://cdn.example/ep3.mp4?signature=fresh',resolution:1080,size:524288000,duration:3600,se:1,ep:3,requireMemberType:0,linkType:1,language:'Korean',headers:{Referer:'https://player.example/'}};
const context={tmdbId:'218539',mediaType:'tv',title:'My Demon',originalTitle:'마이 데몬',originalLanguage:'ko',year:'2023'};
function ordinary(url,opts){
 if(url.includes('/tab-operating'))return response({code:0,data:{}},200,{'x-user':JSON.stringify({token:'fixture-token'})});
 if(url.includes('/subject-api/search'))return response({code:0,data:{items:[subject]}});
 if(url.includes('/subject-api/resource'))return response({code:0,data:{list:[resource],pager:{hasMore:true}}});
 if(url.includes('/get-stream-captions'))return response({code:0,data:{extCaptions:[{url:'https://subs.example/en.srt',lan:'en',lanName:'English'},{url:'https://subs.example/ko.vtt',lan:'ko',lanName:'Korean'}]}});
 if(url.includes('/get-ext-captions'))return response({code:0,data:{extCaptions:[{url:'https://subs.example/en.srt',lan:'en',lanName:'English'},{url:'https://subs.example/ko.vtt',lan:'ko',lanName:'Korean'}]}});
 if(url.startsWith('https://cdn.example/'))return response('',206,{'content-type':'video/mp4','content-range':'bytes 0-0/524288000'});
 throw Error('Unexpected request '+url);
}
function make(handler=ordinary,ctx=context){
 const calls=[],logs=[];const box={module:{exports:{}},URL,URLSearchParams,Promise,setTimeout,clearTimeout,AbortController,Buffer,
 require:name=>{assert.equal(name,'crypto-js');return C;},console:{log:(...x)=>logs.push(x.join(' ')),error:(...x)=>logs.push(x.join(' '))},VUEO_DISCOVERY_CONTEXT:ctx,
 fetch:async(url,opts)=>{calls.push({url:String(url),opts});return handler(String(url),opts||{},calls);}};
 box.global=box;vm.createContext(box);vm.runInContext(code,box);return {box,calls,logs,run:(...args)=>box.module.exports.getStreams(...(args.length?args:['218539','tv',1,3]))};
}
async function main(){
 const a=make();let out=await a.run();
 check(out.length===1&&out[0].quality==='1080p','mobile signed route returns observed resolution');
 check(a.calls.length===5,'cold path auth/search/resource/probe/captions');
 check(a.logs.some(x=>x.includes('RESOURCE_ITEM:')&&x.includes('"requested":1080')&&x.includes('"actual":1080')&&x.includes('eligible_before_dedupe')),'observed resolution is logged against requested quality');
 check(!a.logs.join('\n').includes('signature=fresh')&&!a.logs.join('\n').includes('fixture-token'),'new diagnostics do not expose signed URLs or auth tokens');
 check(out[0].subtitles.length===2&&out[0].subtitles[0].lang==='en','mobile captions attached to verified resource');
 check(out[0].headers.Referer==='https://player.example/','resource playback headers preserved');
 check(!('_resourceId' in out[0]),'internal resource marker removed from output');
 check(a.calls.some(c=>c.url.includes('/get-ext-captions')&&new URL(c.url).searchParams.get('resourceId')==='r3'),'caption resource ID matches selected file');
 check(!a.calls.some(c=>c.url.includes('/get-stream-captions')),'resource ID is not guessed to be a stream ID');
 check(a.calls.filter(c=>c.url.includes('/subject-api/resource')).length===1,'resource pagination stops when matching playable episode found');
 check(a.calls.some(c=>c.opts.headers&&c.opts.headers['x-tr-signature']&&c.opts.headers.Authorization==='Bearer fixture-token'),'existing signed authenticated headers retained');
 check(!a.calls.some(c=>c.url.includes('wefeed-h5-bff')),'fast primary starts no secondary engine');
 const freshBefore=a.calls.length;await a.run();check(a.calls.slice(freshBefore).some(c=>c.url.includes('/subject-api/resource')),'signed media responses are reacquired on next request');
 const wrongPage=make((url,opts)=>{
  if(url.includes('/subject-api/resource')){
   const page=Number(new URL(url).searchParams.get('page'));
   return response({code:0,data:{list:[{...resource,ep:page===1?2:3}],pager:{hasMore:true}}});
  }return ordinary(url,opts);
 });
 check((await wrongPage.run()).length===1&&wrongPage.calls.filter(c=>c.url.includes('/subject-api/resource')).length===2,'pagination continues past wrong episode then stops on exact episode');
 const wrongEpisode=make((url,opts)=>url.includes('/subject-api/resource')?response({code:0,data:{list:[{...resource,ep:2}],pager:{hasMore:false}}}):ordinary(url,opts));
 check((await wrongEpisode.run()).length===0&&!wrongEpisode.calls.some(c=>c.url.startsWith('https://cdn.example')),'wrong episode resource is never probed/returned');
 const wrongYear=make((url,opts)=>url.includes('/subject-api/search')?response({code:0,data:{items:[{...subject,releaseDate:'2024-01-01'}]}}):ordinary(url,opts));
 check((await wrongYear.run()).length===0&&!wrongYear.calls.some(c=>c.url.includes('/subject-api/resource')),'known wrong year rejected before resources');
 const dup=make((url,opts)=>url.includes('/subject-api/search')?response({code:0,data:{items:[subject,{...subject,subjectId:'other'}]}}):ordinary(url,opts));
 check((await dup.run()).length===0&&!dup.calls.some(c=>c.url.includes('/subject-api/resource')),'duplicate exact title/year is ambiguous');
 const explicitDub=make((url,opts)=>url.includes('/subject-api/resource')?response({code:0,data:{list:[{...resource,language:'Hindi'}],pager:{hasMore:false}}}):ordinary(url,opts));
 check((await explicitDub.run()).length===0,'known foreign dubbed audio is not returned');
 check(explicitDub.logs.some(x=>x.includes('RESOURCE_PAGE:')&&x.includes('"audioRejected":1')),'audio rejections are visible before candidate selection');
 const chinese=make((url,opts)=>{
  if(url.includes('/subject-api/search'))return response({code:0,data:{items:[{...subject,title:'你好',language:'Chinese'}]}});
  if(url.includes('/subject-api/resource'))return response({code:0,data:{list:[{...resource,language:'Chinese'}]}});
  return ordinary(url,opts);
 },{...context,title:'你好',originalTitle:'你好',originalLanguage:'zh'});
 check((await chinese.run()).length===1,'non-ASCII titles retain exact-match identity');
 const html=make((url,opts)=>url.startsWith('https://cdn.example/')?response('<html>error</html>',200,{'content-type':'text/html','content-length':'524288000'}):ordinary(url,opts));
 check((await html.run()).length===0,'HTML with success status and huge length is not media');
 check(html.logs.some(x=>x.includes('MEDIA_CHECK:')&&x.includes('http_or_non_media_response')),'media-content rejection reason is logged');
 const tiny=make((url,opts)=>url.startsWith('https://cdn.example/')?response('',206,{'content-type':'video/mp4','content-range':'bytes 0-0/2048'}):ordinary(url,opts));
 check((await tiny.run()).length===0,'tiny notice file rejected despite huge API filesize');
 check(tiny.logs.some(x=>x.includes('MEDIA_CHECK:')&&x.includes('tiny_size_mismatch')),'file-size mismatch is diagnosed');
 const notice=make((url,opts)=>url.includes('/subject-api/resource')?response({code:0,data:{list:[{...resource,title:'Official Notice - Update the App'}]}}):ordinary(url,opts));
 check((await notice.run()).length===0&&!notice.calls.some(c=>c.url.startsWith('https://cdn.example/')),'known notice resource is not probed');
 check(notice.logs.some(x=>x.includes('RESOURCE_ITEM:')&&x.includes('notice_resource')),'notice rejection is diagnosed');
 const fallbackQuality=make((url,opts)=>{
  if(url.includes('/subject-api/resource')){
   const res=Number(new URL(url).searchParams.get('resolution'));
   return response({code:0,data:{list:res===1080?[]:[{...resource,resolution:720}],pager:{hasMore:false}}});
  }return ordinary(url,opts);
 });
 out=await fallbackQuality.run();check(out.length===1&&out[0].quality==='720p','720 fallback only when 1080 resource fails');
 const rejected1080=make((url,opts)=>{
  if(url.includes('/subject-api/resource')){
   const q=Number(new URL(url).searchParams.get('resolution'));
   return response({code:0,data:{list:q===1080?[{...resource,resourceLink:''},{...resource,resourceId:'low',resolution:480}]:[{...resource,resolution:720}],pager:{hasMore:false}}});
  }return ordinary(url,opts);
 });
 out=await rejected1080.run();
 check(out.length===1&&out[0].quality==='720p','diagnostics retain the existing 720 fallback for rejected 1080 request items');
 check(rejected1080.logs.some(x=>x.includes('RESOURCE_ITEM:')&&x.includes('"requested":1080')&&x.includes('missing_resource_link')),'missing resourceLink diagnosed before deduplication hides the row');
 check(rejected1080.logs.some(x=>x.includes('RESOURCE_ITEM:')&&x.includes('"actual":480')&&x.includes('below_min_resolution')),'lower actual resolution distinguished from requested 1080');
 const many=make((url,opts)=>url.includes('/subject-api/resource')?response({code:0,data:{list:Array.from({length:12},(_,i)=>({...resource,resourceId:'resource'+i,resourceLink:'https://cdn.example/'+i+'.mp4'}))}}):ordinary(url,opts));
 await many.run();
 check(many.logs.filter(x=>x.includes('RESOURCE_ITEM:')).length===8&&many.logs.some(x=>x.includes('RESOURCE_DIAGNOSTICS_TRUNCATED:')),'per-quality diagnostic rows are bounded at eight');
 const capsFallback=make((url,opts)=>url.includes('/subject-api/resource')?response({code:0,data:{list:[{...resource,streamId:'stream3'}]}}):url.includes('/get-ext-captions')?response({code:0,data:{extCaptions:[]}}):url.includes('/get-stream-captions')?response({code:0,data:{extCaptions:[{url:'https://subs.example/ms.srt',lanName:'Malay',lan:'ms'}]}}):ordinary(url,opts));
 out=await capsFallback.run();check(out[0].subtitles[0].lang==='ms','alternate caption endpoint used after empty stream captions');
 check(capsFallback.calls.some(c=>c.url.includes('/get-ext-captions')&&new URL(c.url).searchParams.get('episode')==='3'),'TV captions use requested episode');
 check(capsFallback.calls.some(c=>c.url.includes('/get-stream-captions')&&new URL(c.url).searchParams.get('streamId')==='stream3'),'stream caption fallback uses observed stream ID');
 const capsFail=make((url,opts)=>url.includes('captions')?response({},503):ordinary(url,opts));
 out=await capsFail.run();check(out.length===1&&out[0].subtitles.length===0,'caption failure leaves playable source');
 const unknown=make((url,opts)=>url.includes('/subject-api/resource')?response({code:0,data:{list:[{...resource,language:'',resolution:0}]}}):ordinary(url,opts));
 out=await unknown.run();check(out.length===1&&!out[0].name.includes('Original')&&!out[0].name.includes('1080'),'unknown audio/quality not invented');
 const originalNormalize=make((url,opts)=>url.includes('/subject-api/search')?response({code:0,data:{items:[{...subject,title:'My Demon (Hindi Dub)'}]}}):ordinary(url,opts));
 check((await originalNormalize.run()).length===0,'normalization does not erase dubbed title suffix');
 // Compare equal size/duration files: first fails but the second must still be probed.
 const fileIdentity=make((url,opts)=>{
  if(url.includes('/subject-api/resource'))return response({code:0,data:{list:[resource,{...resource,resourceId:'r4',resourceLink:'https://cdn.example/other.mp4'}]}});
  if(url.startsWith(resource.resourceLink))return response('',403);
  return ordinary(url,opts);
 });
 out=await fileIdentity.run();check(out.length===1&&out[0].url.includes('/other.mp4'),'same filesize/duration does not alias verification of different URLs');
 const concurrent=make((url,opts)=>{
  if(url.includes('/subject-api/resource'))return response({code:0,data:{list:[resource,{...resource,resourceId:'r4',resourceLink:'https://cdn.example/ep4.mp4',ep:4}]}});
  return ordinary(url,opts);
 });
 const together=await Promise.all([concurrent.run('218539','tv',1,3),concurrent.run('218539','tv',1,4)]);
 check(together[0][0].url.includes('ep3')&&together[1][0].url.includes('ep4'),'simultaneous episodes have isolated sessions/caches');
 const h5=make((url,opts)=>{
  if(url.includes('/wefeed-mobile-bff/'))return response({},403);
  if(url.includes('/web/subject/search'))return response({data:{items:[{...subject,detailPath:'/detail/my-demon'}]}});
  if(url.includes('/web/subject/play'))return response({data:{streams:[{id:'hs3',format:'MP4',url:'https://cdn.example/h5.mp4',resolutions:1080}]}});
  if(url.includes('/web/subject/caption'))return response({data:{captions:[{url:'https://subs.example/en.srt',lan:'en',lanName:'English'}]}});
  throw Error('Unexpected H5 request '+url);
 });
 out=await h5.run();check(out.length===1&&out[0].url.includes('/h5.mp4'),'existing H5 fallback remains available after mobile failure');
 check(h5.calls.filter(c=>c.url.includes('/web/subject/caption')).length<=1,'H5 caption no longer fans out every stream on every mirror');
 const firstWeb=h5.calls.findIndex(c=>c.url.includes('/wefeed-h5-bff/'));
 check(firstWeb>0&&!h5.calls.slice(firstWeb).some(c=>c.url.includes('/wefeed-mobile-bff/')),'fallback starts after primary has stopped');
 const wrongH5=make((url,opts)=>url.includes('/wefeed-mobile-bff/')?response({},403):url.includes('/web/subject/search')?response({data:{items:[{...subject,title:'My Demon Hunters'}]}}):ordinary(url,opts));
 check((await wrongH5.run()).length===0&&!wrongH5.calls.some(c=>c.url.includes('/web/subject/play')),'H5 fallback cannot bypass exact title validation');
 const budget=make(()=>new Promise(()=>{}));budget.box.setTimeout=(f,ms)=>setTimeout(f,Math.min(ms,15));
 check((await budget.run()).length===0&&budget.calls.length<=5,'hung hosts do not start unrestricted request fanout');
 check((await a.run('218539','tv',0,3)).length===0&&(await a.run('bad','movie')).length===0,'invalid request rejected');
 console.log('MovieBox regression checks passed:',checks);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
