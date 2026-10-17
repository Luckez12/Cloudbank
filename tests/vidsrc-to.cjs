const fs=require('fs'), vm=require('vm'), assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../providers/vidsrc-to.js'),'utf8');
function load(bridge,fetch){let s={module:{exports:{}},console:{log(){}},setTimeout,clearTimeout,fetch};if(bridge)s.webviewResolve=bridge;vm.runInNewContext(source,s);return s.module.exports.getStreams;}
(async()=>{
let calls=[], requests=[];
let f=load(async(u,o)=>{calls.push(u);assert.deepEqual(Array.from(o.match),['.m3u8']);return{streams:[{url:'https://cdn.test/720.m3u8'},{url:'https://cdn.test/master.m3u8',headers:{Cookie:'session=fixture','User-Agent':'fixture-agent',Referer:'https://vsembed.ru/',Range:'bytes=0-1023'}},{url:'https://cdn.test/master.m3u8'}]};},async(u,opts)=>{requests.push(u);if(u.includes('master')){assert.equal(opts.headers.Cookie,'session=fixture');assert.equal(opts.headers['User-Agent'],'fixture-agent');assert.equal(opts.headers.Referer,'https://vsembed.ru/');assert.equal(opts.headers.Range,undefined);}return{ok:true,url:u,text:async()=>'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720.m3u8'};});
let out=await f('1399','tv',1,2);assert.equal(calls[0],'https://vidsrc.to/embed/tv/1399/1/2');assert.equal(out.length,1);assert.equal(requests.length,1);assert.equal(out[0].headers.Cookie,'session=fixture');assert.match(out[0].url,/master/);
await f('157336','movie');assert.equal(calls[1],'https://vidsrc.to/embed/movie/157336');
await f('1399','tv',0,1);assert.match(calls[2],/\/tv\/1399\/0\/1$/);
for(let args of [['1399','tv',null,1],['1399','tv',1,0],['1399','tv',1.1,2],['1399oops','movie'],['0','movie'],['1399','anime']]) assert.equal((await f(...args)).length,0);
assert.equal(calls.length,3);
let noBridge=load(null,()=>{throw Error('unexpected fetch');});assert.equal((await noBridge('1399','tv',1,1)).length,0);
let bad=load(async()=>({streams:[{url:'https://cdn.test/master.m3u8'},{url:'https://cdn.test/fallback.m3u8'}]}),async(u)=>({ok:true,url:u,text:async()=>u.includes('master')?'<html>challenge</html>':'#EXTM3U\n#EXTINF:6,\nsegment.ts'}));
out=await bad('157336','movie');assert.match(out[0].url,/fallback/);
let html=load(async()=>({streams:[{url:'https://cdn.test/index.m3u8'}]}),async()=>({ok:true,text:async()=>'<html>#EXTM3U</html>'}));assert.equal((await html('157336','movie')).length,0);
const failure=load(async()=>{throw Error('resolver failed');},()=>{throw Error('unexpected fetch');});assert.equal((await failure('157336','movie')).length,0);
console.log('PASS: exact movie/TV/specials routes, invalid input, missing bridge, master preference, deduplication, early stop, HTML rejection, observed playlist fallback, cookie/UA/referer preservation and resolver failure.');
})().catch(e=>{console.error(e);process.exit(1)});
