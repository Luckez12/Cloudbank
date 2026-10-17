const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'../providers/vidsrc-to.js'),'utf8');
function load(options={}) {
 let urls=[],http=[];
 let s={module:{exports:{}},URL,console:{log(){}},setTimeout,clearTimeout,
 webviewResolve:async(url,opts)=>{urls.push(url);assert.equal(opts.captureSubtitles,true);return {streams:[{url:'https://cdn.test/master.m3u8',headers:{Cookie:'video=one'}}],subtitles:options.old?undefined:[
 {url:'https://subs.test/en.vtt',label:'English',headers:{Cookie:'sub=two',Referer:url,'User-Agent':'fixture'}},
 {url:'https://subs.test/id.srt',label:'Indonesian'},
 {url:'https://subs.test/bad.vtt',label:'Malay'},
 {url:'https://subs.test/empty.vtt',label:'French'},
 {url:'https://subs.test/sprite.vtt',label:'Unknown'},
 {url:'https://subs.test/en.vtt',label:'duplicate'}]};},
 fetch:async(url,opts)=>{http.push(url);if(url.startsWith('https://vidsrc.to/'))return{ok:true,text:async()=>options.badRoute?'<iframe src="https://vsembed.ru/embed/movie/999/">':'<iframe src="https://vsembed.ru'+new URL(url).pathname.replace(/(\/tv\/\d+\/\d+)\/(\d+)$/, '$1-$2')+'/">'};
 if(url.includes('master'))return{ok:true,url,text:async()=>'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\n720.m3u8'};
 if(url.includes('en.vtt')){assert.equal(opts.headers.Cookie,'sub=two');assert.equal(opts.headers['User-Agent'],'fixture');return{ok:true,url,text:async()=>'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello'};}
 if(url.includes('id.srt'))return{ok:true,url,text:async()=>'1\n00:00:01,000 --> 00:00:03,000\nHalo'};
 if(url.includes('sprite'))return{ok:true,url,text:async()=>'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nthumb.jpg#xywh=0,0,160,90'};
 return{ok:true,url,text:async()=>url.includes('empty')?'WEBVTT\n':'<html>Challenge</html>'};
 }};
 vm.runInNewContext(src,s);return{get:s.module.exports.getStreams,urls,http};
}
(async()=>{
 let x=load(),out=await x.get('1288069','movie');assert.equal(x.urls[0],'https://vsembed.ru/embed/movie/1288069/');assert.equal(out[0].subtitles.length,2);assert.equal(out[0].subtitles[0].language,'en');assert.equal(out[0].subtitles[1].language,'id');assert.equal(out[0].subtitles[0].mimeType,'text/vtt');assert.equal(out[0].subtitles[1].mimeType,'application/x-subrip');assert.equal(out[0].headers.Cookie,'video=one');
 x=load({badRoute:true});await x.get('1288069','movie');assert.equal(x.urls[0],'https://vidsrc.to/embed/movie/1288069');
 x=load({old:true});out=await x.get('1288069','movie');assert.equal(out.length,1);assert.equal(out[0].subtitles.length,0);
 assert.equal((await x.get('1399','tv',null,1)).length,0);
 x=load();await x.get('1399','tv',1,2);assert.equal(x.urls[0],'https://vsembed.ru/embed/tv/1399/1-2/');
 x=load();await x.get('1399','tv',0,1);assert.equal(x.urls[0],'https://vsembed.ru/embed/tv/1399/0-1/');
 console.log('PASS: VTT/SRT cue validation, language, headers, thumbnail/HTML/empty rejection, exact-ID iframe guard, TV/special routes and old-bridge video fallback.');
})().catch(e=>{console.error(e);process.exit(1)});
