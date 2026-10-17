const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../providers/vidlink-http-test.js'),'utf8');
const master='https://flood.sourcerrr.online/proxy/master.m3u8?token=secret';
const mp4='https://flood.sourcerrr.online/mp/resource/movie.mp4?token=secret';
function load(rows,mode='ok',bridge=true){
 const calls=[],sessions=[],logs=[];
 const s={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:x=>logs.push(x)},fetch:async(url,opts)=>{
   calls.push({url,opts});assert.equal(sessions.length,1,'no HTTP preflight');
   return {ok:mode!=='428',status:mode==='428'?428:mode==='partial'?206:200,url,
    headers:{get(k){return ({'content-type':mode==='html'||mode==='428'?'text/html':url.includes('.mp4')?'video/mp4':'application/vnd.apple.mpegurl','content-range':mode==='partial'?'bytes 0-1023/5000000':mode==='badRange'?'bytes 500-1523/5000000':'','content-length':'5000000',server:'cloudflare'})[k]||null;}},
    text:async()=>mode==='html'?'<html>error</html>':mode==='428'?'<title>428 Forbidden</title>':'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n720.m3u8'};
 }};
 if(bridge)s.webviewResolve=async(url,opts)=>{sessions.push({url,opts});return {streams:rows};};
 vm.runInNewContext(source,s);return {get:s.module.exports.getStreams,calls,sessions,logs};
}
const row=url=>({url,headers:{Cookie:'session=secret',Referer:'https://vidlink.pro/movie/1561726','User-Agent':'native-ua',Range:'bytes=20-30',Host:'discard'}});
(async()=>{
 let x=load([row(mp4),row(master),row(master)]),out=await x.get('1561726','movie');
 assert.equal(out.length,1);assert.equal(x.sessions[0].url,'https://vidlink.pro/movie/1561726');assert.equal(x.sessions[0].opts.directLoad,true);
 assert.equal(x.sessions.length,1);assert.equal(x.calls.length,1);assert.equal(out[0].url,master);assert.equal(out[0].quality,'Auto');assert.equal(out[0].subtitles.length,0);
 assert.equal(out[0].headers.Cookie,'session=secret');assert.equal(out[0].headers['User-Agent'],'native-ua');assert(!out[0].headers.Range&&!out[0].headers.Host);
 x=load([row(mp4)],'partial');out=await x.get(80539,'series',1,1);assert.equal(out.length,1);assert.equal(x.sessions[0].url,'https://vidlink.pro/tv/80539/1/1');assert.equal(x.calls[0].opts.headers.Range,'bytes=0-1023');assert(!out[0].headers.Range);
 x=load([row(mp4),row(master)],'428');assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.calls.length,1);assert(x.logs.some(l=>l.includes('HTTP_REASON: 428 Forbidden')));assert(!x.logs.join('').includes('token=secret'));
 x=load([row(master)],'html');assert.equal((await x.get(1561726,'movie')).length,0);
 x=load([row('https://adsterra.test/ad.mp4'),row('https://cdn.test/trailer.mp4'),row('https://cdn.test/init.mp4'),row('blob:abc'),row('https://[')]);assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.calls.length,0);
 x=load([row(master)]);assert.equal((await x.get(80539,'tv',1,0)).length,0);assert.equal((await x.get('../wrong','movie')).length,0);assert.equal(x.sessions.length,0);
 x=load([], 'ok', false);assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.calls.length,0);
 x=load([]);assert.equal((await x.get(1561726,'movie')).length,0);assert.equal(x.sessions.length,1);assert.equal(x.calls.length,0);
 const old=JSON.parse(fs.readFileSync('vidlink_http_reason/manifest.json')),next=JSON.parse(fs.readFileSync('vidlink_webview_test/manifest.json'));
 assert.deepStrictEqual(old.scrapers.filter(p=>p.id!=='vidlink-http-test'),next.scrapers.filter(p=>p.id!=='vidlink-http-test'));
 console.log('PASS: exact routes, one session/no preflight, headers/cookies, HLS priority, MP4 range, 428/HTML rejection, invalid candidates and unchanged providers');
})().catch(e=>{console.error(e);process.exit(1)});
