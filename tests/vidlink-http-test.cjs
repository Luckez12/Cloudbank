const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../providers/vidlink-http-test.js'),'utf8');
function load(data,options={}) {
 let requests=[],clock=1800000000000;
 class FixedDate extends Date{static now(){return clock;}}
 let s={module:{exports:{}},console:{log(){}},setTimeout,clearTimeout,URL,Date:FixedDate,webviewResolve(){throw Error('Unexpected WebView');},require(){throw Error('No runtime modules needed');},fetch:async(url,opts)=>{
 requests.push({url,opts});
 if(url.startsWith('https://vidlink.pro/api/b/'))return{ok:true,status:200,json:async()=>data};
 if(!url.startsWith('https://cdn.test/')&&!url.startsWith('https://flood.sourcerrr.online/'))throw Error('Unexpected external destination');
 if(options.blocked)return{ok:false,status:426};
 const isMp4=url.includes('.mp4');return{ok:true,status:isMp4?(options.status||206):200,url,headers:{get(k){if(k==='content-type')return options.html?'text/html':isMp4?'video/mp4':'application/vnd.apple.mpegurl';if(k==='content-range'&&isMp4)return options.badRange?'bytes 500-1523/5000000':'bytes 0-1023/5000000';if(k==='content-length')return isMp4&&options.status!==200?'1024':'5000000';return null;}},text:async()=>options.html?'<html>challenge</html>':'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720.m3u8'};
 }};
 vm.runInNewContext(source,s,{timeout:2000});return{get:s.module.exports.getStreams,requests};
}
const hls={sourceId:'Primary',stream:{playlist:'https://cdn.test/master.m3u8',qualities:{720:{url:'https://cdn.test/720.mp4',type:'mp4'}},captions:[{url:'https://subs.test/en.srt',language:'English',type:'srt',headers:{Referer:'https://subs.test/'}}]}};
(async()=>{
 let x=load(hls),out=await x.get('1561726','movie');assert.equal(out.length,1);assert.match(out[0].url,/master/);assert.equal(out[0].quality,'Auto');assert.equal(out[0].subtitles.length,1);assert.equal(out[0].subtitles[0].headers.Referer,'https://subs.test/');assert.equal(x.requests.length,2);assert.equal(x.requests[0].opts.headers['X-Playback-Environment'],'hls');
 const token=x.requests[0].url.split('/movie/')[1].split('?')[0];assert(token.length>60&&!token.includes(':'));
 // Independent public-domain implementation validates local token cryptography in the audit runner.
 if(process.env.NACL_TEST_MODULE){const nacl=require(process.env.NACL_TEST_MODULE),b=Buffer.from(token,'base64url'),key=Buffer.from('c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd','hex');const plain=nacl.secretbox.open(b.subarray(24),b.subarray(0,24),key);assert(plain);const bytes=Buffer.from(plain);assert.equal(bytes.subarray(0,-8).toString(),'1561726');assert.equal(Number(bytes.readBigUInt64BE(bytes.length-8)),1800000480);}
 x=load(hls);await x.get('80539','tv',1,2);assert.match(x.requests[0].url,/\/tv\/[^/]+\/1\/2\?multiLang=0$/);
 x=load(hls);await x.get('80539','tv',0,1);assert.match(x.requests[0].url,/\/0\/1\?multiLang=0$/);
 for(const args of [['80539','tv',null,1],['80539','tv',1,0],['80539','tv',1.1,1],['bad','movie'],['0','movie']])assert.equal((await x.get(...args)).length,0);
 x=load({...hls,tmdbId:999});assert.equal((await x.get('1561726','movie')).length,0);assert.equal(x.requests.length,1);
 x=load({...hls,metadata:{season:1,episode:3}});assert.equal((await x.get('80539','tv',1,2)).length,0);
 const mp4={sourceId:'file',stream:{type:'file',qualities:{1080:{type:'mp4',url:'https://cdn.test/1080.mp4',headers:{Referer:'https://filmboom.top/'},requiresProxy:true,se:1,ep:2},720:{type:'mp4',url:'https://cdn.test/720.mp4'}}}};
 x=load(mp4);out=await x.get('80539','tv',1,2);assert.equal(out.length,1);assert.equal(x.requests[1].opts.method,'GET');assert.equal(x.requests[1].opts.headers.Range,'bytes=0-1023');assert.equal(out[0].headers.Range,undefined);assert.equal(out[0].headers.Referer,'https://vidlink.pro/');const proxy=new URL(out[0].url);assert.equal(proxy.hostname,'flood.sourcerrr.online');assert.equal(proxy.searchParams.get('host'),'https://cdn.test');assert.equal(JSON.parse(proxy.searchParams.get('headers')).Referer,'https://filmboom.top/');assert.equal(out[0].quality,'1080p');assert.equal(x.requests.length,2);
 x=load(mp4,{badRange:true});assert.equal((await x.get('80539','tv',1,2)).length,0);
 x=load(mp4,{status:200});assert.equal((await x.get('80539','tv',1,2)).length,1);
 x=load(mp4,{blocked:true});assert.equal((await x.get('80539','tv',1,2)).length,0);assert.equal(x.requests.length,2);assert(x.requests[1].url.startsWith('https://flood.sourcerrr.online/'));
 x=load(hls,{html:true});assert.equal((await x.get('1561726','movie')).length,0);
 x=load({stream:null});assert.equal((await x.get('1561726','movie')).length,0);assert.equal(x.requests.length,1);
 console.log('PASS: exact routes, local token, zero metadata/encryption/WebView/subtitle requests, HLS preference/stop, MP4 GET/206 range checks, upstream headers, explicit identity mismatch rejection, HTML/null/access-denied handling, authorized site-proxy construction and header separation.');
})().catch(e=>{console.error(e);process.exit(1)});
