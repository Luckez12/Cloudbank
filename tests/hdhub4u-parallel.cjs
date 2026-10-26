const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),C=require('crypto-js');
const code=fs.readFileSync('providers/hdhub4u.js','utf8');
async function test(fail='',only='',delivery=false){
 let calls=[],started=[],release;
 const gate=new Promise(r=>release=r);
 const payload={source:'https://p2.example/master.m3u8',subtitle:{English:'/en.vtt',Malay:'/ms.vtt',Hindi:'/hi.vtt'}};
 if(delivery){payload.hlsVideoTiktok='https://p2.example/hls/master.m3u8';payload.streamingConfig=JSON.stringify({order:['Google','Tiktok','In-House'],adjust:{Google:{disabled:true},Tiktok:{domain:'delivery.example',params:{v:'123'}}}});payload.hlsVideoGoogle='https://disabled.example/master.m3u8';}
 const encrypted=C.AES.encrypt(JSON.stringify(payload),C.enc.Utf8.parse('kiemtienmua911ca'),{iv:C.enc.Utf8.parse('1234567890oiuytr'),mode:C.mode.CBC,padding:C.pad.Pkcs7}).ciphertext.toString(C.enc.Hex);
 const c={module:{exports:{}},require,URL,AbortController,setTimeout,clearTimeout,console:{log(){}},VUEO_DISCOVERY_CONTEXT:{tmdb:{id:1,title:'Test',release_date:'2026-01-01'}},fetch:async(u,o)=>{
 calls.push(u);let body;
 if(u.includes('?s='))body='<article><a href="/test"><h2>Test (2026)</h2></a></article>';
 else if(u==='https://new9.hdhub4u.cl/test')body=(only==='p2'?'':'<a href="https://hdstream4u.com/file/abc">WATCH</a>')+(only==='watch'?'':'<a href="https://hubstream.art/#xyz">PLAYER-2</a>');
 else{
 const kind=u.includes('hdstream4u')?'watch':'p2';started.push(kind);if(started.length===(only?1:2))release();await gate;
 if(kind===fail)throw Error('server unavailable');
 if(kind==='p2'){assert(u.includes('/api/v1/video?id=xyz&w=412&h=915&r='));assert.equal(o.headers.Referer,'https://hubstream.art/#xyz');body=encrypted;}
 else body='<script>var file="https://watch.example/master.m3u8";</script>';
 }return{ok:true,url:u,text:async()=>body};}};
 vm.createContext(c);vm.runInContext(code,c);
 const rows=await c.module.exports.getStreams(1,'movie');
 assert.equal(started.length,only?1:2);assert.equal(rows.length,only||fail?1:2);assert.equal(calls.length,only?3:4);
 for(const row of rows)assert.equal(row.server,row.serverName);
 const p2=rows.find(r=>r.serverName==='PLAYER-2');if(p2){assert.equal(p2.subtitles.length,2);assert.equal(p2.headers.Origin,'https://hubstream.art');assert.equal(p2.server,'PLAYER-2');assert.equal(p2.url,delivery?'https://p2.example/hlsmod/delivery.example/master.m3u8?v=123':payload.source);}
 assert(calls.every(u=>!u.includes('.example')));
}
(async()=>{await test();await test('','',true);await test('watch');await test('p2');await test('','p2');await test('','watch');console.log('PASS: both requests start before either finishes; both results retained; isolated failures; either missing player; encrypted PLAYER-2 API and EN/MS captions; no media probes');})().catch(e=>{console.error(e);process.exitCode=1});
