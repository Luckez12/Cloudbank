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
(async()=>{
 let rows=await ctx.module.exports.getStreams('1236045','movie');assert.equal(rows.length,2);assert.ok(rows.every(x=>x.quality==='Unknown'));assert.ok(rows.every(x=>x.url.endsWith('?signed=keep')));assert.ok(rows.every(x=>x.headers.Referer==='https://source.test/'));assert.ok(rows.every(x=>x.subtitles.length===2&&x.subtitles[1].label==='Malay'));
 assert.ok(!calls.some(x=>/playback-init|request-token|chunk.ts|wyzie/.test(x.url)));
 assert.ok(calls.find(x=>x.url.endsWith('/api/ui/session')).opts.headers.Cookie.includes('site_cookie=unit'));
 const n=calls.length;assert.equal((await ctx.module.exports.getStreams('1','tv',1,null)).length,0);assert.equal(calls.length,n);
 calls.length=0;await ctx.module.exports.getStreams('218539','tv',1,3);assert.ok(calls.some(x=>x.url.endsWith('/watch/tv/218539-1-3')));
 bad=true;assert.equal((await ctx.module.exports.getStreams('1236045','movie')).length,0);
 console.log('PASS: Mapple current-session workflow, isolated SHA, exact episodes, original HLS, no fake Auto, source labels and cookie isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
