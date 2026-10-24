const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const code=fs.readFileSync('providers/mapple.js','utf8');const calls=[];let bad=false;
const res=(status,data,mime='application/json',cookie='')=>({ok:status>=200&&status<300,status,headers:{get:k=>k==='content-type'?mime:k==='set-cookie'?cookie:null},json:async()=>data,text:async()=>typeof data==='string'?data:JSON.stringify(data)});
const fetch=async(url,opts={})=>{
 calls.push({url,opts});const body=opts.body?JSON.parse(opts.body):{};
 if(url.includes('/watch/'))return res(200,'<html>page</html>','text/html','site_cookie=unit; Path=/');
 if(url.endsWith('/api/ui/session'))return res(200,{token:'unit-ui'});
 if(url.endsWith('/api/media-session')){
  if(!body.pow)return res(200,{success:true,requiresPow:true,pow:{challengeId:'unit-id',challenge:'unit-challenge',difficulty:8}});
  assert.ok(crypto.createHash('sha256').update('unit-challenge'+body.pow.nonce).digest()[0]===0);
  return res(200,{success:true,token:'unit-playback'});
 }
 if(url.endsWith('/api/encrypt'))return res(200,{url:'/api/stream-encrypted?source='+body.data.source});
 if(url.includes('/api/stream-encrypted?'))return res(200,{success:true,data:{stream_url:'https://cdn.test/'+new URL(url).searchParams.get('source')+'.m3u8?signed=keep',headers:{Referer:'https://source.test/'}}});
 if(url.includes('sub.vdrk.site'))return res(200,[{file:'https://sub.test/en.vtt',label:'English 2'},{file:'https://sub.test/ms.vtt',label:'Malay'},{file:'https://sub.test/id.vtt',label:'Indonesian'}]);
 if(url.includes('cdn.test')){assert.ok(!opts.headers.Cookie);return res(200,bad?'<html>error</html>':'#EXTM3U\n#EXTINF:10,\nchunk.ts','application/vnd.apple.mpegurl');}
 throw Error('Unexpected URL');
};
const ctx={module:{exports:{}},console,URL,setTimeout,clearTimeout,AbortController,fetch,require:()=>{throw Error('No host modules');}};vm.createContext(ctx);vm.runInContext(code,ctx);
const hashCtx={...ctx,module:{exports:{}}};vm.createContext(hashCtx);vm.runInContext(code.split('/* CLOUDBANK_UPSTREAM_SOURCE_START */')[1].split('/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0],hashCtx);
(async()=>{
 for(const length of [0,1,45,54,55,56,63,64,65,110,119,120,127,128,200,8192]){
  const challenge='é🙂'+ 'x'.repeat(length);const hasher=hashCtx.mpPowHasher(challenge);
  for(const nonce of [0,9,10,99,100,99999,49999999]){
   const actual=Array.from(hasher(nonce),x=>(x>>>0).toString(16).padStart(8,'0')).join('');
   assert.equal(actual,crypto.createHash('sha256').update(challenge+nonce).digest('hex'));
  }
 }
 let rows=await ctx.module.exports.getStreams('1236045','movie');assert.equal(rows.length,2);assert.ok(rows.every(x=>x.quality==='Unknown'));assert.ok(rows.every(x=>x.url.endsWith('?signed=keep')));assert.ok(rows.every(x=>x.headers.Referer==='https://source.test/'));assert.ok(rows.every(x=>x.subtitles.length===2&&x.subtitles[1].label==='Malay'));
 assert.ok(!calls.some(x=>/playback-init|request-token|chunk.ts|wyzie/.test(x.url)));
 assert.ok(calls.find(x=>x.url.endsWith('/api/ui/session')).opts.headers.Cookie.includes('site_cookie=unit'));
 const n=calls.length;assert.equal((await ctx.module.exports.getStreams('1','tv',1,null)).length,0);assert.equal(calls.length,n);
 calls.length=0;await ctx.module.exports.getStreams('218539','tv',1,3);assert.ok(calls.some(x=>x.url.endsWith('/watch/tv/218539-1-3')));
 bad=true;assert.equal((await ctx.module.exports.getStreams('1236045','movie')).length,0);
 vm.runInContext("var benchCount=10000,benchChallenge='benchmark-prefix-'.repeat(8),benchHash=mpPowHasher(benchChallenge);var benchStart=Date.now();for(var bi=0;bi<benchCount;bi++)benchHash(bi);var fastMs=Date.now()-benchStart;benchStart=Date.now();for(var bi=0;bi<benchCount;bi++)MP_CRYPTO.SHA256(benchChallenge+bi);var oldMs=Date.now()-benchStart;",hashCtx);
 if(process.env.MAPPLE_POW_FIXTURE){const p=JSON.parse(fs.readFileSync(process.env.MAPPLE_POW_FIXTURE)).pow;const nonce=await hashCtx.mpPow(p.challenge,p.difficulty,{closed:false,deadline:Date.now()+9000});const d=crypto.createHash('sha256').update(p.challenge+nonce).digest();let bits=0;for(const b of d){if(!b)bits+=8;else{bits+=Math.clz32(b)-24;break;}}assert.ok(bits>=p.difficulty);}
 console.log('Node VM benchmark (not Android): '+hashCtx.fastMs+'ms fast / '+hashCtx.oldMs+'ms previous, 10000 hashes');
 console.log('PASS: Mapple current-session workflow, isolated SHA, exact episodes, original HLS, no fake Auto, source labels and cookie isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
