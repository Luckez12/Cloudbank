const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto'),C=require('crypto-js');
const code=fs.readFileSync('providers/xpass.js','utf8');
const enc=s=>Buffer.from(s).toString('base64').replace(/[a-zA-Z]/g,c=>c===c.toLowerCase()?c.toUpperCase():c.toLowerCase());
async function run(type,id,season,episode,shim=false){
 const path='/data/'+type+'/'+id+(type==='tv'?'/'+season+'/'+episode:''),token='fixture.signature',build='spv3-build-fixture',key=crypto.createHash('sha256').update('spv3-data-response|'+build+'|'+path+'|'+token).digest(),iv=Buffer.alloc(12,7),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),servers=[{name:'first',url:'/playlist/first'},{name:'second',url:'/playlist/second'}];
 const encrypted=Buffer.concat([iv,cipher.update(JSON.stringify(servers)),cipher.final(),cipher.getAuthTag()]).toString('base64url'),calls=[];
 const page='https://play.xpass.top/e/'+type+'/'+id+(type==='tv'?'/'+season+'/'+episode:'');
 const ctx={module:{exports:{}},require:()=>C,URL,setTimeout,clearTimeout,console:{log(){}},fetch:async(url,o)=>{
  calls.push(url);assert.equal(o.headers.Referer,url.startsWith("https://play.xpass.top")?page:"https://play.xpass.top/");let body;
  if(url===page)body=`<script>var dataUrl="${path}?token=${token}";var suburl="https://subs.test/list";</script><script src="/static/mainmini.js?v=12"></script>`;
  else if(url.includes('/data/'))body=encrypted;
  else if(url.includes('mainmini.js'))body="var strings=['"+enc('/static/current.js?t=12')+"'];";
  else if(url.includes('current.js'))body="var strings=['"+enc(build)+"'];";
  else if(url==='https://subs.test/list')body=JSON.stringify([{url:'https://subs.test/en.vtt',language:'en'}]);
  else if(url.endsWith('/playlist/first'))body=JSON.stringify({playlist:[]});
  else if(url.endsWith('/playlist/second'))body=JSON.stringify({playlist:[{sources:[{file:'https://media.test/master.m3u8?sig=A%2FB',type:'hls'}]}]});
  else throw Error('Unexpected fetch');
  return {ok:true,status:200,text:async()=>body,json:async()=>JSON.parse(body)};
 }};
 vm.createContext(ctx);
 if(shim){ctx.__vueoUrlOp=raw=>{const q=JSON.parse(raw),u=new URL(q.input,q.base||undefined);return JSON.stringify({href:u.href,origin:u.origin,protocol:u.protocol,hostname:u.hostname,host:u.host,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash,queryPairs:Array.from(u.searchParams)});};vm.runInContext(fs.readFileSync('tests/fixtures/vidlove-vueo-url-shim.js','utf8'),ctx);}
 vm.runInContext(code,ctx);const rows=await ctx.module.exports.getStreams(id,type,season,episode);assert.equal(rows.length,1);assert.equal(rows[0].serverName,'second');assert.equal(rows[0].url,'https://media.test/master.m3u8?sig=A%2FB');assert.equal(rows[0].subtitles.length,1);assert(calls.length<=7);assert(calls.every(u=>!u.includes('media.test')));return ctx;
}
(async()=>{await run('movie','12345');console.log('PASS full movie pipeline, empty first server fallback, subtitles, no media probes');const c=await run('tv','24680',0,2,true);console.log('PASS exact TV season zero/episode pipeline with VUEO URL shim');const n=await c.module.exports.getStreams('bad/id','movie');assert.equal(n.length,0);console.log('PASS invalid identity returns no sources');})().catch(e=>{console.error(e);process.exitCode=1});
