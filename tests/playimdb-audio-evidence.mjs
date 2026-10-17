import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const source = fs.readFileSync('providers/playimdb.js','utf8');
let fileName='', calls=[];
const urls=['https://cdn.example/server1/master.m3u8','https://cdn.example/server2/master.m3u8'];
const c={module:{exports:{}},Promise,setTimeout,clearTimeout,console:{log(){}},
 VUEO_DISCOVERY_CONTEXT:{tmdb:{id:220542,name:'The Apothecary Diaries',original_language:'ja',first_air_date:'2023-01-01'}},
 fetch:async(url,options)=>{calls.push({url,options});
  if(url.includes('/season/'))return {ok:true,json:async()=>({runtime:24})};
  assert.ok(url.startsWith('https://streamdata.vaplayer.ru/api.php?'));
  return {ok:true,json:async()=>({status_code:200,data:{file_name:fileName,stream_urls:urls},default_subs:[{code:'en',url:'https://subs.example/en.srt',lang:'English'}]})};
 }};
vm.runInNewContext(source,c); let assertions=0;
for(const [name,expected] of [
 ['The.Apothecary.Diaries.S01E01.1080p.WEB.H264-SKYANiME/the.apothecary.diaries.s01e01.1080p.web.h264-skyanime.mkv','Audio-Unverified'],
 ['Anime.S01E01.English.1080p.mkv','English-Audio (filename)'],
 ['Anime.S01E01.JPN.1080p.mkv','Japanese-Audio (filename)'],
 ['Anime.S01E01.Japanese.English.mkv','Multi-Audio (filename)'],
 ['Anime.S01E01.Dual.Audio.mkv','Dual-Audio (filename)'],
 ['Anime.S01E01.Multi-Audio.English.mkv','Multi-Audio (filename)'],
 ['Movie.Englishman.1080p.mkv','Audio-Unverified']]){
 calls=[];fileName=name;const result=await c.getStreams(220542,'tv',1,1);
 assert.equal(result.length,2);assertions++;
 assert.ok(result.every(s=>s.name.endsWith(expected)));assertions++;
 assert.deepEqual(Array.from(result,s=>s.url),urls);assertions++;
 assert.ok(result.every(s=>s.headers.Referer==='https://nextgencloudfabric.com/'));assertions++;
 assert.ok(result.every(s=>s.subtitles[0].url==='https://subs.example/en.srt'));assertions++;
 assert.equal(calls.length,2);assertions++;
 assert.ok(!result.some(s=>s.name.includes('Original-Audio')));assertions++;
}
console.log(`PASS: ${assertions} PlayIMDB audio evidence and unchanged extraction checks`);
