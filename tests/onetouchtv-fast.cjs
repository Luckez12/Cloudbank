const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const C=require('crypto-js');
const source=fs.readFileSync(path.join(__dirname,'../providers/onetouchtv.js'),'utf8');
let checks=0;function check(value,label){assert.ok(value,label);checks++;}
function response(data,status=200){const text=typeof data==='string'?data:JSON.stringify(data);return {ok:status>=200&&status<300,status,text:async()=>text,json:async()=>JSON.parse(text)};}
function encrypt(data){return C.AES.encrypt(JSON.stringify({result:JSON.stringify(data)}),C.enc.Utf8.parse('im72charPasswordofdInitVectorStm'),{iv:C.enc.Utf8.parse('im72charPassword'),mode:C.mode.CBC,padding:C.pad.Pkcs7}).ciphertext.toString(C.enc.Base64).replace(/\//g,'-_.').replace(/\+/g,'@');}
const search=[{id:'my-demon',title:'My Demon (2023)',year:'2023',type:'drama'},{id:'MY-DEMON',title:'My Demon (2023)',year:'2023',type:'drama'}];
const episode={identifier:'my-demon',playId:'ep1',episode:'1'};
const detail={id:'my-demon',title:'My Demon (2023)',year:'2023',type:'drama',episodes:[episode]};
const payload={sources:[{name:'Main',quality:'1080p',url:'https://cdn.example/ep1.m3u8',headers:{Referer:'https://player.example/',Origin:'https://player.example',Authorization:'Bearer source-token',Host:'bad'} }],track:[{label:'English',file:'https://subs.example/en.vtt'},{label:'French',file:'https://subs.example/fr.srt'},{kind:'thumbnails',file:'https://subs.example/preview.vtt'}]};
function ordinary(url){if(url.includes('/search?'))return response(encrypt(search));if(url.includes('/detail'))return response(encrypt(detail));if(url.includes('/episode/'))return response(encrypt(payload));throw Error('Unexpected network '+url);}
function make(handler=ordinary,context={tmdbId:'218539',mediaType:'tv',title:'My Demon',year:'2023'}){
 const calls=[],logs=[];const box={module:{exports:{}},URL,URLSearchParams,setTimeout,clearTimeout,AbortController,Promise,console:{log:(...x)=>logs.push(x.join(' ')),error:(...x)=>logs.push(x.join(' '))},VUEO_DISCOVERY_CONTEXT:context,
 fetch:async(url,options)=>{calls.push({url,options});return handler(String(url),options,calls);}};
 box.global=box;vm.createContext(box);vm.runInContext(source,box);return {box,calls,logs,run:(...args)=>box.module.exports.getStreams(...(args.length?args:['218539','tv',1,1]))};
}
async function main(){
 const a=make();let out=await a.run();
 check(out.length===1,'encrypted cold path returns source');
 check(a.calls.length===3,'cold path is search/detail/episode only, no remote decrypt');
 check(a.calls.filter(c=>c.url.includes('/detail')).length===1,'uppercase/lowercase slug duplicates avoid repeated detail');
 check(out[0].subtitles.length===2&&out[0].subtitles[1].lang==='fr','subtitle tracks returned and French not classified as English');
 check(out[0].headers.Referer==='https://player.example/'&&out[0].headers.Authorization==='Bearer source-token'&&!out[0].headers.Host,'source headers preserved, hop header removed');
 let before=a.calls.length;await a.run();check(a.calls.length-before===2,'mapping cache skips search and refreshes signed episode payload');
 const live=fs.readFileSync(path.join(__dirname,'fixtures/onetouchtv-live-search.txt'),'utf8');
 a.box.live=live;
 const decoded=vm.runInContext('JSON.parse(decryptString(live))',a.box);
 check(decoded.length===2&&decoded[0].id==='my-demon','actual captured encrypted API search decrypts locally');
 const plain=make(url=>url.includes('/search?')?response({data:search}):url.includes('/detail')?response({result:detail}):response({result:payload}));
 check((await plain.run()).length===1,'plain and wrapped JSON accepted without decryption service');
 const controls='{"result":"hello\nworld"}';a.box.controls=controls;
 check(vm.runInContext('parseJsonLenient(controls,"fixture").result',a.box)==='hello\nworld','unescaped controls repaired inside JSON strings');
 const wrongYear=make(url=>url.includes('/detail')?response(encrypt({...detail,year:'2024'})):ordinary(url));
 check((await wrongYear.run()).length===0&&!wrongYear.calls.some(c=>c.url.includes('/episode/')),'wrong remake year is rejected');
 const wrongType=make(url=>url.includes('/search?')?response(encrypt(search.map(x=>({...x,type:'movie'})))):ordinary(url));
 check((await wrongType.run()).length===0&&wrongType.calls.length===1,'movie cannot satisfy TV title');
 const unrelated=make(url=>url.includes('/search?')?response(encrypt([{id:'x',title:'My Demon Hunters',year:'2023',type:'drama'}])):ordinary(url));
 check((await unrelated.run()).length===0&&unrelated.calls.length===1,'substring title never selected');
 const ambiguous=make(url=>{
  if(url.includes('/search?'))return response(encrypt([search[0],{...search[0],id:'remake'}]));
  if(url.includes('/vod/remake/detail'))return response(encrypt({...detail,id:'remake'}));return ordinary(url);
 });
 check((await ambiguous.run()).length===0,'two identical title/year entries do not silently select first');
 const oneWrongEpisode=make(url=>url.includes('/detail')?response(encrypt({...detail,episodes:[{...episode,episode:'2'}]})):ordinary(url));
 check((await oneWrongEpisode.run()).length===0&&!oneWrongEpisode.calls.some(c=>c.url.includes('/episode/')),'single available episode cannot substitute E1');
 const unnumbered=make(url=>url.includes('/detail')?response(encrypt({...detail,episodes:[{identifier:'my-demon',playId:'ep1'}]})):ordinary(url));
 check((await unnumbered.run()).length===0,'unnumbered entries are not selected by array position');
 const fractional=make(url=>url.includes('/detail')?response(encrypt({...detail,episodes:[{...episode,episode:'1.5'}]})):ordinary(url));
 check((await fractional.run()).length===0,'special fractional episode is not rounded');
 const noSeason=make();check((await noSeason.run('218539','tv',2,1)).length===0,'bare season one entry cannot satisfy season two');
 const season2=make(url=>{
  if(url.includes('/search?'))return response(encrypt([{id:'my-demon-s2',title:'My Demon Season 2',year:'2025',type:'drama'}]));
  if(url.includes('/detail'))return response(encrypt({...detail,id:'my-demon-s2',title:'My Demon Season 2',year:'2025'}));return ordinary(url);
 });
 check((await season2.run('218539','tv',2,1)).length===1,'explicit later season accepts its later release year');
 const rowSeasons=make(url=>url.includes('/detail')?response(encrypt({...detail,episodes:[{...episode,season:1},{...episode,season:2,playId:'s2ep1'}]})):ordinary(url));
 check((await rowSeasons.run('218539','tv',2,1)).length===1&&rowSeasons.calls.some(c=>c.url.endsWith('/episode/s2ep1')),'explicit episode-season metadata disambiguates combined season detail');
 const alias=make(url=>url.includes('/search?')&&new URL(url).searchParams.get('keyword')==='Different Main Title'?response(encrypt([])):ordinary(url),{tmdbId:'218539',mediaType:'tv',title:'Different Main Title',originalTitle:'My Demon',year:'2023'});
 check((await alias.run()).length===1&&alias.calls.filter(c=>c.url.includes('/search?')).length===2,'alias search starts only after main title fails');
 const stale=make(url=>url.includes('themoviedb.org')?response({id:218539,name:'My Demon',first_air_date:'2023-01-01'}):ordinary(url),{tmdbId:'1',mediaType:'tv',title:'Wrong',year:'2000'});
 check((await stale.run()).length===1&&stale.calls.some(c=>c.url.includes('themoviedb.org')),'stale shared metadata is not used');
 const idMismatch=make(url=>url.includes('/detail')?response(encrypt({...detail,id:'other'})):ordinary(url));check((await idMismatch.run()).length===0,'detail ID mismatch is rejected');
 const subtitlesAbsent=make(url=>url.includes('/episode/')?response(encrypt({sources:payload.sources})):ordinary(url));check((await subtitlesAbsent.run())[0].subtitles.length===0,'video returned even without subtitles');
 const sourceSubs=make(url=>url.includes('/episode/')?response(encrypt({sources:[{...payload.sources[0],subtitles:[{label:'Malay',url:'https://subs.example/ms.srt'}]}],track:payload.track})):ordinary(url));
 check((await sourceSubs.run())[0].subtitles.some(s=>s.lang==='ms'),'source-level caption tracks merged with shared tracks');
 const dedupe=make(url=>url.includes('/episode/')?response(encrypt({sources:[payload.sources[0],payload.sources[0],{...payload.sources[0],headers:{Referer:'https://different.example/'}},{url:'javascript:alert(1)'},{url:'https://cdn.example/watch.html'}],track:[payload.track[0],payload.track[0]]})):ordinary(url));
 out=await dedupe.run();check(out.length===2&&out[0].subtitles.length===1,'dedupe preserves distinct playback headers, rejects bad schemes/embed HTML');
 const remote=make(url=>url.includes('enc-dec.app')?response({status:200,result:search}):url.includes('/search?')?response('changed-encryption'):ordinary(url));
 check((await remote.run()).length===1&&remote.calls.filter(c=>c.url.includes('enc-dec.app')).length===1,'remote decrypt only after local failure');
 check(JSON.parse(remote.calls.find(c=>c.url.includes('enc-dec.app')).options.body).text==='changed-encryption','compatibility request preserves original encrypted text');
 const remoteError=make(url=>url.includes('enc-dec.app')?response({status:500,error:'failure'}):response('bad-encryption'));check((await remoteError.run()).length===0,'remote decrypt failure is not treated as a valid result');
 let aborted=false;const timeout=make((url,opts)=>{opts.signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});});timeout.box.setTimeout=(f,ms)=>setTimeout(f,Math.min(ms,15));
 check((await timeout.run()).length===0&&aborted,'hung API request is aborted');
 vm.runInContext(`for(var i=0;i<510;i++) remember('entry'+i,{id:'id'+i,title:'Title'}, {year:'2023'});`,a.box);
 check(vm.runInContext('Object.keys(cacheStore().matches).length',a.box)===500,'cache has 500 mapping maximum');
 const expired=make();await expired.run();before=expired.calls.length;vm.runInContext(`cacheStore().matches['tv/218539/1'].at=0;`,expired.box);await expired.run();
 check(expired.calls.slice(before).some(c=>c.url.includes('/search?')),'expired mapping triggers discovery');
 check((await a.run('218539','tv',0,1)).length===0&&(await a.run('invalid','movie')).length===0,'invalid request rejected');
 const movieContext={tmdbId:'550',mediaType:'movie',title:'Fight Club',year:'1999'};
 const movie=make(url=>url.includes('/search?')?response(encrypt([{id:'fight-club',title:'Fight Club',year:'1999',type:'movie'}])):url.includes('/detail')?response(encrypt({id:'fight-club',title:'Fight Club',year:'1999',type:'movie',episodes:[{identifier:'fight-club',playId:'movie'}]})):response(encrypt(payload)),movieContext);
 check((await movie.run('550','movie')).length===1,'single verified movie entry works');
 console.log('OneTouchTV regression checks passed:',checks);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
