const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const source=fs.readFileSync('providers/1shows.js','utf8');
const core=source.split('/* CLOUDBANK_UPSTREAM_SOURCE_START */')[1].split('/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0];
const key=Buffer.from(/DOWNLOAD_KEY_HEX='([a-f0-9]{64})'/.exec(core)[1],'hex');
const token='102030405060708090a0b0c0d0e0f000';
function envelope(value){const iv=Buffer.alloc(12,7),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(token,'hex'));return {v:1,iv:iv.toString('hex'),ct:Buffer.concat([c.update(JSON.stringify(value)),c.final()]).toString('hex'),tag:c.getAuthTag().toString('hex')};}
const calls=[];
function response(status,mime,body,size){return {ok:status>=200&&status<300,status,headers:{get:n=>({'content-type':mime,'content-length':size||''})[n]||null},text:async()=>body,json:async()=>JSON.parse(body)};}
const ctx={module:{exports:{}},require,console:{log(){}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,WebAssembly:undefined,crypto:undefined,fetch:async(url,opts={})=>{
 calls.push({url,opts});if(url.endsWith('/download-token'))return response(200,'application/json',JSON.stringify({token}));
 if(url.includes('/download/movie/')){assert.equal(opts.headers['x-download-token'],token);return response(200,'application/json',JSON.stringify(envelope({sources:[{label:'English',url:'https://media.example/api.mp4'}]})));}
 if(url.includes('throw'))throw Error('transport');
 if(url.includes('404'))return response(404,'video/mp4','',2000000);
 if(url.includes('fake'))return response(200,'text/html','<html>error</html>');
 if(url.includes('invalid.m3u8'))return response(200,'application/vnd.apple.mpegurl','<html>error</html>');
 if(url.includes('valid.m3u8'))return response(200,'application/vnd.apple.mpegurl','#EXTM3U\n#EXTINF:10,\na.ts');
 return response(200,'video/mp4','',2000000);
}};
vm.createContext(ctx);vm.runInContext(core,ctx,{timeout:2000});
(async()=>{
 const value={sources:[{url:'https://media.example/ok.mp4'}]};
 assert.equal(JSON.stringify(ctx.decryptDownloadPureJs(envelope(value),token)),JSON.stringify(value));
 const altered=envelope(value);altered.tag=(altered.tag[0]==='0'?'1':'0')+altered.tag.slice(1);
 assert.throws(()=>ctx.decryptDownloadPureJs(altered,token),/authentication/);
 assert.throws(()=>ctx.decryptDownloadPureJs(envelope(value),'00'.repeat(16)),/authentication/);
 assert.equal((await ctx.fetchDownloadSources('1236045','movie')).length,1);
 assert.equal(calls.filter(c=>/makimaDL/.test(c.url)).length,0);
 for(const url of ['throw.mp4','404.mp4','fake.mp4','invalid.m3u8'])assert.equal(await ctx.isStreamAlive({url:'https://media.example/'+url}),false,url);
 const headers={'Referer':'https://download.example/','User-Agent':'test'};
 assert.equal(await ctx.isStreamAlive({url:'https://media.example/ok.mp4',behaviorHints:{proxyHeaders:{request:headers}}}),true);
 const head=calls.at(-1);assert.equal(head.opts.method,'HEAD');assert.equal(head.opts.headers.Referer,headers.Referer);assert.ok(!head.opts.skipSizeCheck);assert.ok(!head.opts.headers.Range);
 assert.equal(await ctx.isStreamAlive({url:'https://media.example/valid.m3u8'}),true);
 const resolved=[];
 ctx.fetchDownloadSources=async()=>[{url:'https://origin.example/ok',label:'ok'},{url:'https://origin.example/failure',label:'bad'},{url:'https://origin.example/Animal.2023.mkv',label:'wrong'},{url:'https://origin.example/hidden-year',label:'wrong-after'}];
 ctx.fetchMediaDetails=async()=>({title:'Animals',year:2026});
 ctx.resolveSource=async(row)=>{resolved.push(row.url);if(row.label==='bad')throw Error('one broken host');return [{url:row.label==='wrong-after'?'https://media.example/Animal.2023.mkv':'https://media.example/ok.mp4',qualityRank:1080}];};
 const result=await ctx.getStreams('1236045','movie');assert.equal(result.length,1);assert.ok(!resolved.some(x=>x.includes('Animal.2023')));
 assert.equal((await ctx.getStreams('not-an-id','movie')).length,0);assert.equal((await ctx.getStreams('123','tv',0,1)).length,0);
 ctx.fetchDownloadSources=async()=>[{url:'https://origin.example/show.2026',label:'current episode'}];ctx.fetchMediaDetails=async()=>({title:'Series',year:2005});ctx.resolveSource=async()=>[{url:'https://media.example/show.2026.mp4'}];assert.equal((await ctx.getStreams('123','tv',21,1)).length,1);
 console.log('PASS: portable authenticated decode, API token handoff, tampering rejected, media/error-page checks, playback headers, host isolation, movie identity and TV air-year handling');
})().catch(e=>{console.error(e);process.exitCode=1});
