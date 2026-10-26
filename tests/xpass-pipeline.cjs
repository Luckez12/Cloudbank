const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto'),C=require('crypto-js');
const code=fs.readFileSync('providers/xpass.js','utf8');
const enc=s=>Buffer.from(s).toString('base64').replace(/[a-zA-Z]/g,c=>c===c.toLowerCase()?c.toUpperCase():c.toLowerCase());
async function run(type,id,season,episode,shim=false,mode="good"){
 const path='/data/'+type+'/'+id+(type==='tv'?'/'+season+'/'+episode:''),token='fixture.signature',build='spv3-build-fixture',key=crypto.createHash('sha256').update('spv3-data-response|'+build+'|'+path+'|'+token).digest(),iv=Buffer.alloc(12,7),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),servers=[{name:'first',url:'/playlist/first'},{name:'second',url:'/playlist/second'}];
 const encrypted=Buffer.concat([iv,cipher.update(JSON.stringify(servers)),cipher.final(),cipher.getAuthTag()]).toString('base64url'),calls=[];
 const page='https://play.xpass.top/e/'+type+'/'+id+(type==='tv'?'/'+season+'/'+episode:'');
 const ctx={module:{exports:{}},require:()=>C,URL,setTimeout,clearTimeout,console:{log(){}},fetch:async(url,o)=>{
  calls.push(url);if(!url.includes("media.test"))assert.equal(o.headers.Referer,url.startsWith("https://play.xpass.top")?page:"https://play.xpass.top/");let body;
  if(url===page)body=`<script>var dataUrl="${path}?token=${token}";${mode==='absent'?'':'var suburl="https://subs.test/list";'}</script><script src="/static/mainmini.js?v=12"></script>`;
  else if(url.includes('/data/'))body=encrypted;
  else if(url.includes('mainmini.js'))body="var strings=['"+enc('/static/current.js?t=12')+"'];";
  else if(url.includes('current.js'))body="var strings=['"+enc(build)+"'];";
  else if(url==='https://subs.test/list'){
   if(mode==='failed')return{ok:false,status:404};
   await new Promise(r=>setTimeout(r,30));
   body=JSON.stringify(mode==='empty'?[]:{subtitles:{English:'/en.vtt',Malay:[{url:'/ms.srt',headers:{'X-Key':'retained'}}],Hindi:'/hi.vtt',und:'/unknown.vtt'}});
  }
  else if(url.endsWith('/playlist/first'))body=JSON.stringify({playlist:[]});
  else if(url.endsWith('/playlist/second'))body=JSON.stringify({playlist:[{sources:[{file:'https://media.test/master.m3u8?sig=A%2FB',type:'hls',subtitles:[{file:'https://subs.test/embedded-en.vtt',language:'und',label:'English'},{file:'https://subs.test/ja.vtt',language:'ja'}]}]}]});
  else throw Error('Unexpected fetch: '+url);
  return {ok:true,status:200,url,headers:{get:k=>k==='content-type'?(url.endsWith('video.ts')?'video/mp2t':'application/vnd.apple.mpegurl'):''},text:async()=>body,json:async()=>JSON.parse(body)};
 }};
 vm.createContext(ctx);
 if(shim){ctx.__vueoUrlOp=raw=>{const q=JSON.parse(raw),u=new URL(q.input,q.base||undefined);return JSON.stringify({href:u.href,origin:u.origin,protocol:u.protocol,hostname:u.hostname,host:u.host,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash,queryPairs:Array.from(u.searchParams)});};vm.runInContext(fs.readFileSync('tests/fixtures/vidlove-vueo-url-shim.js','utf8'),ctx);}
 vm.runInContext(code,ctx);const rows=await ctx.module.exports.getStreams(id,type,season,episode);assert.equal(rows.length,1);assert.equal(rows[0].serverName,'second');assert.equal(rows[0].url,'https://media.test/master.m3u8?sig=A%2FB');assert.equal(rows[0].subtitles.length,['failed','empty','absent'].includes(mode)?1:3);assert(rows[0].subtitles.every(s=>['en','ms'].includes(s.language)));assert(calls.every(u=>!u.includes('media.test')));assert(calls.every(u=>!/[.]vtt|[.]srt/.test(u)));if(mode==='good'){assert.equal(rows[0].subtitles[2].language,'ms');assert.equal(rows[0].subtitles[2].headers['X-Key'],'retained');}assert(calls.length<=7);assert.equal(rows[0].server,'second');return ctx;
}
(async()=>{await run('movie','12345');console.log('PASS delayed subtitle list retained after winning server, source captions merged, only EN/MS, no media or caption probes');const c=await run('tv','24680',0,2,true);console.log('PASS exact TV season zero/episode pipeline with VUEO URL shim');for(const mode of ['empty','failed','absent']){await run('tv','126437',2,5,false,mode);console.log('PASS subtitle '+mode+' leaves streams available');}
const n=await c.module.exports.getStreams('bad/id','movie');assert.equal(n.length,0);console.log('PASS invalid identity returns no sources');})().catch(e=>{console.error(e);process.exitCode=1});
