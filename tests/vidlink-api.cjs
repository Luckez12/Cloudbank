const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../providers/vidlink-http-test.js'),'utf8');
const qualities={1080:{type:'mp4',url:'https://cdn.test/high.mp4?sign=secret&t=1',requiresProxy:true,headers:{origin:'https://filmboom.top',referer:'https://filmboom.top/'}},360:{type:'mp4',url:'https://cdn.test/low.mp4?sign=secret&t=1',requiresProxy:true,headers:{origin:'https://filmboom.top',referer:'https://filmboom.top/'}}};
const data={sourceId:'Primary',stream:{qualities,captions:[{url:'https://subs.test/en.srt',language:'English',type:'srt'}]}};
function load(input=data,statuses=[206],html=false){
 const calls=[],logs=[];let index=0;
 const s={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:x=>logs.push(x)},webviewResolve(){throw Error('Unexpected WebView');},fetch:async(url,opts)=>{
  calls.push({url,opts});if(url.includes('/api/b/'))return {ok:true,status:200,json:async()=>input};
  assert.equal(new URL(url).hostname,'flood.sourcerrr.online');const status=statuses[Math.min(index++,statuses.length-1)];
  return {ok:status>=200&&status<300,status,url,headers:{get(k){return {'content-type':status>=400||html?'text/html':url.includes('m3u8')?'application/vnd.apple.mpegurl':'video/mp4','content-range':'bytes 0-1023/5000000','content-length':'5000000',server:'cloudflare'}[k]||null;}},text:async()=>status>=400?'<title>428 Forbidden</title>':html?'<html>error</html>':'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n720.m3u8'};
 }};vm.runInNewContext(source,s);return {get:s.module.exports.getStreams,calls,logs};
}
(async()=>{
 let x=load(),out=await x.get('1561726','movie');assert.equal(out.length,1);assert.equal(out[0].quality,'360p');assert.equal(x.calls.length,2);assert.match(x.calls[1].url,/\/low.mp4\?/);assert.equal(x.calls[1].opts.headers.Range,'bytes=0-1023');assert(!out[0].headers.Range);assert.equal(out[0].subtitles.length,1);
 let u=new URL(out[0].url);assert.equal(u.searchParams.get('host'),'https://cdn.test');assert.equal(u.searchParams.get('sign'),'secret');assert.equal(JSON.parse(u.searchParams.get('headers')).referer,'https://filmboom.top/');assert.equal(out[0].headers.Referer,'https://vidlink.pro/');
 x=load(data,[428,206]);out=await x.get(1561726,'movie');assert.equal(out.length,1);assert.equal(out[0].quality,'1080p');assert.equal(x.calls.length,3);assert.match(x.calls[2].url,/high.mp4/);
 x=load(data,[428]);assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.calls.length,3);assert(x.logs.some(l=>l.includes('HTTP_REASON: 428 Forbidden')));assert(!x.logs.join('').includes('sign=secret'));
 x=load(data,[429]);assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.calls.length,2);
 x=load(data,[200],true);assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.calls.length,3);
 x=load({...data,tmdbId:999});assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.calls.length,1);
 x=load({...data,metadata:{season:2,episode:1}});assert.equal((await x.get(80539,'tv',1,1)).length,0);assert.equal(x.calls.length,1);
 x=load(data);await x.get(80539,'series',1,2);assert.match(x.calls[0].url,/\/tv\/[^/]+\/1\/2\?multiLang=0$/);
 x=load(data);await x.get(80539,'tv',null,1);await x.get(80539,'tv',1,0);await x.get('bad','movie');assert.equal(x.calls.length,0);
 x=load({sourceId:'HLS',stream:{playlist:'https://cdn.test/master.m3u8',requiresProxy:true,qualities}});out=await x.get(1561726,'movie');assert.equal(out.length,1);assert.equal(out[0].type,'hls');assert.equal(out[0].quality,'Auto');assert.equal(x.calls.length,2);
 const prev=JSON.parse(fs.readFileSync('vidlink_webview_test/manifest.json')),next=JSON.parse(fs.readFileSync('vidlink_api_restore/manifest.json'));
 assert.deepStrictEqual(prev.scrapers.filter(p=>p.id!=='vidlink-http-test'),next.scrapers.filter(p=>p.id!=='vidlink-http-test'));
 console.log('PASS: restored exact API route; site-first MP4; one alternative; max 2 checks; 428/HTML rejection; 429 stop; HLS preference; metadata conflicts; proxy/header separation; no WebView/subtitle HTTP; other providers unchanged');
})().catch(e=>{console.error(e);process.exit(1)});
