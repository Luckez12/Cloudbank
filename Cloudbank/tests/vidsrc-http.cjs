const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const core=fs.readFileSync('providers/vidsrc.js','utf8');
const helperStart=core.indexOf('/* CLOUDBANK_UPSTREAM_SOURCE_START */')+'/* CLOUDBANK_UPSTREAM_SOURCE_START */'.length;
const helper=core.slice(helperStart,core.indexOf('async function getStreams',helperStart));
function leb(n){const b=[];do{let v=n&127;n>>>=7;b.push(v|(n?128:0));}while(n);return b;}
function fixtureWasm(a,b){const data=[2,0,65,0,11,32,...a,0,65,32,11,32,...b];return Buffer.from([0,97,115,109,1,0,0,0,11,...leb(data.length),...data]);}
const a=crypto.randomBytes(32),b=crypto.randomBytes(32),key=Buffer.from(a.map((v,i)=>v^b[i])),wasm=fixtureWasm(a,b);
const plain='https://media.example/master.m3u8?token=fixture\nhttps://media.example/alternate.m3u8?token=fixture';
const nonce=crypto.randomBytes(12),iv=Buffer.concat([Buffer.alloc(4),nonce]);
const cipher=Buffer.concat([nonce,crypto.createCipheriv('chacha20',key,iv).update(plain)]).toString('base64');
function env(type='movie',id='12345',season=1,episode=2,fail=''){
 const calls=[], logs=[];const playerPath='/embed/player/'+type+'/'+id+(type==='tv'?'/'+season+'/'+episode:'');
 const payload={status_code:200,data:{title:'Fixture',stream_urls:cipher},vs:{w:99,wasm_url:'https://data.vidsrc.sh/keys/99.wasm?_=fixture'}};
 const ctx={module:{exports:{}},URL,Uint8Array,Uint32Array,setTimeout,clearTimeout,AbortController,
  atob:s=>Buffer.from(s,'base64').toString('binary'),console:{log:s=>logs.push(s)},
  webviewResolve(){throw Error('WebView must never be used');},
  __vueoNativeFetch:async raw=>{const r=JSON.parse(raw);calls.push(r);assert.equal(r.responseEncoding,'base64');assert.equal(new URL(r.url).hostname,'data.vidsrc.sh');return JSON.stringify({status:200,body:wasm.toString('base64'),bodyEncoding:fail==='oldbridge'?undefined:'base64'});},
  fetch:async (url,opts)=>{
   const u=new URL(url);calls.push({url,opts});assert.equal(opts.redirect,'manual');
   let body;
   if(u.pathname==='/vs_src.php'){
    assert.equal(u.searchParams.get('id'),id);if(type==='tv'){assert.equal(u.searchParams.get('season'),''+season);assert.equal(u.searchParams.get('episode'),''+episode);}
    body={src:'https://player.example/embed/iframe?vs=fixture'};
   }else if(u.pathname==='/embed/iframe')body='<script>window.CFG = '+JSON.stringify({playerUrl:playerPath+'?vs=fixture'})+';</script>';
   else if(u.pathname===playerPath){
    const config={mediaType:type,mediaId:fail==='identity'?'999':id,idType:'tmdb',season,episode,apiToken:'one-use-fixture',turnstile:true};
    if(type==='movie')config.api='https://data.vidsrc.sh/api.php?type=movie&tmdb='+id+'&stream_urls';else config.streamBase='https://data.vidsrc.sh/api.php?type=tv&tmdb='+id;
    body='<script>window.CONFIG = '+JSON.stringify(config)+';</script>';
   }else if(u.pathname==='/api.php'){
    assert.equal(u.searchParams.get('api_token'),'one-use-fixture');assert.ok(u.searchParams.has('stream_urls'));
    if(type==='tv'){assert.equal(u.searchParams.get('season'),''+season);assert.equal(u.searchParams.get('episode'),''+episode);}
    if(fail==='auth')return {ok:false,status:403};body=payload;
   }else throw Error('Unexpected HTTP request: '+u.origin+u.pathname);
   return {ok:true,status:200,json:async()=>body,text:async()=>typeof body==='string'?body:JSON.stringify(body)};
  }};
 vm.runInNewContext(core,ctx,{timeout:1000});return {provider:ctx.module.exports,calls,logs,ctx};
}
(async()=>{
 const e=env();let rows=await e.provider.getStreams('12345','movie');
 assert.equal(rows.length,2);assert.equal(rows[0].url,plain.split('\n')[0]);assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].headers.Referer,'https://player.example/');assert.equal(rows[0].mimeType,'application/x-mpegURL');assert.equal(e.calls.length,5);
 assert.ok(e.calls.every(x=>!new URL(x.url).hostname.includes('media.example')),'Never read master, variants or segments');
 rows=await e.provider.getStreams('12345','movie');assert.equal(rows.length,2);assert.equal(e.calls.length,9,'Decoder key reused by window, session token still freshly requested');
 const tv=env('tv','67890',2,7);assert.equal((await tv.provider.getStreams('67890','tv',2,7)).length,2);
 assert.equal((await tv.provider.getStreams('67890','tv',null,7)).length,0);
 const mismatch=env('movie','12345',1,2,'identity');assert.equal((await mismatch.provider.getStreams('12345','movie')).length,0);assert.equal(mismatch.calls.length,3);
 const old=env('movie','12345',1,2,'oldbridge');assert.equal((await old.provider.getStreams('12345','movie')).length,0);assert.ok(old.logs.some(x=>x.includes('binary bridge update required')));
 const denied=env('movie','12345',1,2,'auth');assert.equal((await denied.provider.getStreams('12345','movie')).length,0);assert.ok(denied.logs.some(x=>x.includes('HTTP 403')));
 // Compare the public website's actual WASM algorithm when the local audit
 // download exists; private response URLs and tokens are never fixtures.
 const c={module:{exports:{}},Uint8Array,Uint32Array};vm.runInNewContext(helper+'\nmodule.exports={wasmKeys:wasmKeys,chacha:chacha};',c);
 assert.equal(c.module.exports.chacha(Buffer.from(cipher,'base64'),c.module.exports.wasmKeys(wasm)),plain);
 for(let n of [1,63,64,65,257]){
  const p=crypto.randomBytes(n),nonce=crypto.randomBytes(12),iv=Buffer.concat([Buffer.alloc(4),nonce]);
  const enc=Buffer.concat([nonce,crypto.createCipheriv('chacha20',key,iv).update(p)]);
  assert.deepEqual(Buffer.from(c.module.exports.chacha(enc,key),'binary'),p);
 }
 if(process.argv[2]){
  const bytes=fs.readFileSync(process.argv[2]),reference=(await WebAssembly.instantiate(bytes,{})).instance.exports;
  const liveKey=c.module.exports.wasmKeys(bytes),p=crypto.randomBytes(129),nonce=crypto.randomBytes(12);
  const encrypted=Buffer.concat([nonce,crypto.createCipheriv('chacha20',Buffer.from(liveKey),Buffer.concat([Buffer.alloc(4),nonce])).update(p)]);
  const ptr=reference.alloc(encrypted.length);new Uint8Array(reference.memory.buffer,ptr,encrypted.length).set(encrypted);
  const length=reference.decrypt(ptr,encrypted.length);assert.deepEqual(Buffer.from(reference.memory.buffer,ptr+12,length),p);
  assert.deepEqual(Buffer.from(c.module.exports.chacha(encrypted,liveKey),'binary'),p);
  console.log('Actual downloaded website WASM agrees with provider decoder.');
 }
 console.log('VidSrc HTTP: movie/TV identity, fresh tokens, rotating decoder data, ChaCha20 block boundaries, no WebView/media probes, cache and failure contracts passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
