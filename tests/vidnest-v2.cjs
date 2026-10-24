const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const code=fs.readFileSync('providers/vidnest.js','utf8'),core=code.split('/* CLOUDBANK_UPSTREAM_SOURCE_START */')[1].split('/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0];
const ctx={module:{exports:{}},require:()=>{throw Error("VUEO runtime crypto must not be used");},console,setTimeout,clearTimeout,AbortController,URL,fetch:async()=>{throw Error('Unexpected HTTP');}};vm.createContext(ctx);vm.runInContext(core,ctx);
const secret=vm.runInContext('VN_CLIENT',ctx);
function envelope(data,n='test-response-nonce'){
 const key=crypto.createHash('sha256').update(n+'|'+secret).digest(),iv=crypto.randomBytes(12),enc=crypto.createCipheriv('aes-256-gcm',key,iv),cipher=Buffer.concat([enc.update(JSON.stringify(data),'utf8'),enc.final()]);
 return {v:2,n,d:Buffer.concat([iv,cipher,enc.getAuthTag()]).toString('base64url')};
}
(async()=>{
 let checks=0;
 for(const len of [0,1,15,16,17,31,32,33,127,1024]){const x={value:'é中文 '+ 'x'.repeat(len)};assert.equal(JSON.stringify(ctx.vnDecrypt(envelope(x))),JSON.stringify(x));checks++;}
 const e=envelope({url:'https://media.test/a.m3u8'});let raw=Buffer.from(e.d,'base64url');raw[15]^=1;assert.throws(()=>ctx.vnDecrypt({...e,d:raw.toString('base64url')}),/tag mismatch/);checks++;
 assert.throws(()=>ctx.vnDecrypt({...e,n:'wrong'}),/tag mismatch/);checks++;
 assert.throws(()=>ctx.vnDecrypt({v:1,d:'abcd',n:'a'}));checks++;
 if(process.env.VIDNEST_LIVE_FIXTURES)for(let i=0;i<3;i++){
  const x=ctx.vnDecrypt(JSON.parse(fs.readFileSync('/tmp/vn-api-'+i+'.json')));assert.deepEqual(JSON.parse(JSON.stringify(x)),JSON.parse(fs.readFileSync('/tmp/vn-dec-'+i+'.json')));checks++;
 }
 const calls=[];
 const response=(status,body,mime)=>({ok:status>=200&&status<300,status,headers:{get:k=>k==='content-type'?mime:null},json:async()=>body,text:async()=>body});
 ctx.fetch=async(url,opts={})=>{calls.push({url,opts});
  if(url.startsWith('https://new.vidnest.fun/')){ assert.match(new URL(url).searchParams.get('_n'),/^[A-Za-z0-9_-]{22}$/);
   if(url.includes('/yflix/'))return response(200,envelope({url:'https://media.test/master.m3u8?token=signed',headers:{Referer:'https://origin.test/'},subtitles:[{url:'https://media.test/en.vtt',lang:'en'}]}),'application/json');
   if(url.includes('/flixhq/'))return response(200,envelope({url:'https://media.test/fail.m3u8',status:'success',type:'hls'}),'application/json');
   return response(200,envelope({streams:[{url:'https://media.test/movie.mp4',type:'mp4',quality:'auto',headers:{Referer:'https://cdn.test/'}}]}),'application/json');
  }
  if(url.includes('fail.'))return response(403,'Forbidden','text/html');
  if(url.includes('master.'))return response(200,'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=123\nchild.m3u8','application/vnd.apple.mpegurl');
  return response(200,'','video/mp4');
 };
 let rows=await ctx.module.exports.getStreams('580489','movie');assert.equal(rows.length,2);checks++;
 assert.equal(rows[0].url,'https://media.test/master.m3u8?token=signed');checks++;
 assert.equal(rows[0].headers.Referer,'https://origin.test/');checks++;
 assert.equal(rows[0].quality,'Auto');checks++;
 assert.equal(rows[0].subtitles[0].lang,'en');checks++;
 assert.equal(rows[1].quality,'Unknown');checks++;
 assert.ok(!calls.some(x=>/child|segment|aesdec|first\.vidnest/.test(x.url)));checks++;
 const before=calls.length;assert.equal((await ctx.module.exports.getStreams('a','movie')).length,0);assert.equal((await ctx.module.exports.getStreams('1','tv',1,null)).length,0);assert.equal(calls.length,before);checks++;
 calls.length=0;await ctx.module.exports.getStreams('218539','tv',1,3);assert.ok(calls.filter(x=>x.url.startsWith('https://new.vidnest.fun')).every(x=>/\/tv\/218539\/1\/3\?_n=/.test(x.url)));checks++;
 const full={...ctx,module:{exports:{}}};vm.createContext(full);vm.runInContext(code,full);assert.equal((await full.module.exports.getStreams('580489','movie')).length,2);checks++;
 console.log('PASS: '+checks+' Vidnest protocol/workflow checks');
})().catch(e=>{console.error(e);process.exitCode=1;});
