const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('providers/vixsrc.js','utf8');
const expiry=String(Math.floor(Date.now()/1000)+3600);
const html=`<script>window.masterPlaylist = {params: {'token':'fixture%+token', 'expires':'${expiry}', 'asn':'fixture-asn', 'empty':''}, url:'https://vixsrc.to/playlist/987654'};</script>`;
function load({page=html,src='/embed/987654?lang=ja&cdn=fixture',apiStatus=200,embedStatus=200}={}) {
 const calls=[],logs=[];
 const context={module:{exports:{}},URL,setTimeout,clearTimeout,console:{log:s=>logs.push(s)},
  fetch:async(url,options)=>{
   calls.push({url,options});
   assert.ok(calls.length<=2,'Only API and embed are allowed');
   if(calls.length===1) return {ok:apiStatus===200,status:apiStatus,url,json:async()=>({src})};
   return {ok:embedStatus===200,status:embedStatus,url,text:async()=>page};
  }};
 vm.runInNewContext(source,context,{timeout:1000});return {provider:context.module.exports,calls,logs};
}
(async()=>{
 const basic=load();const rows=await basic.provider.getStreams('12345','movie');assert.equal(rows.length,1);
 assert.equal(basic.calls[0].url,'https://vixsrc.to/api/movie/12345');
 assert.equal(basic.calls[0].options.headers.Referer,'https://vixsrc.to/movie/12345/');
 assert.equal(basic.calls[1].options.headers.Referer,'https://vixsrc.to/');
 assert.equal(basic.calls.length,2,'Never fetch master, variants, subtitles or metadata');
 const master=new URL(rows[0].url);assert.equal(master.pathname,'/playlist/987654');
 assert.equal(master.searchParams.get('token'),'fixture%+token');assert.equal(master.searchParams.get('expires'),expiry);
 assert.equal(master.searchParams.get('asn'),'fixture-asn');assert.equal(master.searchParams.has('empty'),false);
 assert.equal(master.searchParams.get('h'),'1');assert.equal(master.searchParams.get('lang'),'ja');assert.equal(master.searchParams.get('cdn'),'fixture');
 assert.equal(rows[0].quality,'Auto');assert.equal(rows[0].isAdaptive,true);assert.equal(rows[0].mimeType,'application/x-mpegURL');
 assert.equal(rows[0].headers.Origin,'https://vixsrc.to');assert.equal(rows[0].headers.Referer,basic.calls[1].url);
 assert.equal(rows[0].headers['X-VUEO-HTTP-Transport'],'shared');
 assert.ok(basic.calls.every(x=>!x.options.headers['X-VUEO-HTTP-Transport']),'Transport instruction belongs only to playback configuration');
 assert.equal(rows[0].subtitles,undefined);
 const tv=load();await tv.provider.getStreams('24680','series',2,7);assert.equal(tv.calls[0].url,'https://vixsrc.to/api/tv/24680/2/7');
 const invalid=load();await invalid.provider.getStreams('bad/id','movie');await invalid.provider.getStreams('1','tv',null,1);assert.equal(invalid.calls.length,0);
 const blocked=load({apiStatus:403});assert.equal((await blocked.provider.getStreams('1','movie')).length,0);assert.equal(blocked.calls.length,1);assert.ok(blocked.logs.some(x=>x.includes('HTTP 403 at API')));
 const blockedEmbed=load({embedStatus:403});assert.equal((await blockedEmbed.provider.getStreams('1','movie')).length,0);assert.equal(blockedEmbed.calls.length,2);
 for(const src of ['https://evil.example/embed/987654','/movie/1','/embed/not-a-video']) {
  const test=load({src});assert.equal((await test.provider.getStreams('1','movie')).length,0);assert.equal(test.calls.length,1);
 }
 for(const page of [html.replace('/playlist/987654','/playlist/111'),html.replace('fixture%+token',''),html.replace(expiry,'1'),'<html>Loading player</html>',html.replace('window.masterPlaylist','window.other')]) {
  const test=load({page});assert.equal((await test.provider.getStreams('1','movie')).length,0);
 }
 const defaults=load({src:'/embed/987654'});const result=await defaults.provider.getStreams('1','movie');assert.equal(new URL(result[0].url).searchParams.get('lang'),'en');
 console.log('VixSrc current flow: two reads, exact movie/episode route, API mapping, master params/headers, adaptive output, fail-fast HTTP errors, rejected incomplete/expired/wrong-host payloads passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
