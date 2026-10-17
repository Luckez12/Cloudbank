const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(require('path').join(__dirname,'../providers/vidlink-http-test.js'),'utf8');
const logs=[],calls=[];
const s={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:x=>logs.push(x)},fetch:async(url,opts)=>{
 calls.push(url);
 if(calls.length===1)return{ok:true,json:async()=>({sourceId:'test',stream:{qualities:{1080:{url:'https://cdn.test/video.mp4?token=SECRET_MEDIA_TOKEN_1234567890123456789',type:'mp4',requiresProxy:true}}}})};
 return{ok:false,status:428,headers:{get:k=>k==='content-type'?'application/json':k==='server'?'cloudflare':null},text:async()=>JSON.stringify({error:'Required precondition missing',detail:'https://signed.test/private?token=SECRET_BODY_TOKEN_1234567890123456789 cookie=COOKIE_SECRET_1234567890123456789 ip 10.20.30.40'})};
}};
vm.runInNewContext(code,s);
(async()=>{const result=await s.module.exports.getStreams('1561726','movie');assert.equal(result.length,0);assert.equal(calls.length,2);const output=logs.join('\n');assert(output.includes('HTTP_FAILURE:'));assert(output.includes('HTTP_REASON:'));assert(output.includes('Required precondition missing'));assert(!output.includes('SECRET_'));assert(!output.includes('10.20.30.40'));assert(!output.includes('https://signed.test'));console.log('PASS: existing failed response produces redacted evidence with exactly two total requests.');})().catch(e=>{console.error(e);process.exit(1)});
