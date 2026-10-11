import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const CryptoJS = require('crypto-js');
const source = fs.readFileSync('providers/castle.js','utf8').split('/* CLOUDBANK_UPSTREAM_SOURCE_START */\n')[1].split('\n/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0];
function load(extra={}) {
  const box={module:{exports:{}},require,console:{log(){},error(){}},URLSearchParams,setTimeout,clearTimeout,Date,Uint8Array,Int8Array,ArrayBuffer,TextDecoder,atob,...extra};
  vm.createContext(box); vm.runInContext(source,box); return box;
}
const security=Buffer.from('1234567890').toString('base64');
const key=CryptoJS.enc.Utf8.parse('1234567890T!BgJB');
function cipher(data){ return CryptoJS.AES.encrypt(JSON.stringify(data),key,{iv:key}).toString(); }
test('encrypted movie flow retains every audio, quality, subtitle and playback header',async()=>{
  let active=0,peak=0; const bodies=[];
  const box=load({fetch:async(url,options)=>{
    let data;
    if(url.includes('themoviedb')) return {ok:true,json:async()=>({title:'Example',release_date:'2024-01-01'})};
    if(url.includes('getSecurityKey')) return {ok:true,json:async()=>({code:200,data:security})};
    if(url.includes('searchByKeyword')) data={data:{rows:[{id:10,title:'Example'}]}};
    else if(url.includes('getVideo2')) {
      const body=JSON.parse(options.body); bodies.push(body);active++;peak=Math.max(peak,active);
      await new Promise(r=>setTimeout(r,8));active--;
      data={data:{videos:[{url:'https://cdn.invalid/'+body.languageId+'.m3u8',resolution:3}],subtitles:[{url:'https://cdn.invalid/en.vtt',abbreviate:'en'}]}};
    } else data={data:{episodes:[{id:20,tracks:[1,2,3,4].map(id=>({existIndividualVideo:true,languageId:id,languageName:'Audio '+id}))}]}};
    return {ok:true,text:async()=>JSON.stringify({data:cipher(data)})};
  }});
  const results=await box.module.exports.getStreams('123','movie');
  assert.equal(results.length,4);assert.equal(peak,3);
  assert.equal(bodies.length,4); assert.equal(results[0].quality,'1080p');
  assert.equal(results[0].subtitles[0].language,'en');assert.equal(results[0].headers['Accept-Encoding'],'identity');
});
test('string season/episode IDs select requested season, missing season returns no wrong episode',async()=>{
  const box=load();let ids=[];
  box.getTMDBDetails=async()=>({title:'Show'});box.getSecurityKey=async()=>security;box.findCastleMovieId=async()=> '10';
  box.getDetails=async(k,id)=>{ids.push(id);return id==='10'?{seasons:[{number:'0',movieId:11}]}:{episodes:[{id:21,number:'2',tracks:[]}]};};
  box.getVideo2=async()=>({videoUrl:'https://cdn.invalid/special.mp4'});
  const result=await box.module.exports.getStreams('123','tv',0,2);
  assert.equal(result.length,1);assert.deepEqual(ids,['10','11']);assert.match(result[0].title,/S00E02/);
  assert.equal((await box.module.exports.getStreams('123','tv',9,2)).length,0);
});
test('failed audio keeps successful tracks and shared fallback runs only when necessary',async()=>{
  const box=load();box.getTMDBDetails=async()=>({title:'Film'});box.getSecurityKey=async()=>security;box.findCastleMovieId=async()=> '10';
  box.getDetails=async()=>({episodes:[{id:20,tracks:[1,2].map(languageId=>({existIndividualVideo:true,languageId}))}]});
  let shared=0;box.getVideo2=async()=>{shared++;return {videoUrl:'https://cdn.invalid/shared.mp4'};};
  box.getVideoV1=async(k,m,e,l)=>{if(l===1)throw Error('failed');return {videoUrl:'https://cdn.invalid/audio.mp4'};};
  assert.equal((await box.module.exports.getStreams('123','movie')).length,1);assert.equal(shared,0);
  box.getVideoV1=async()=>{throw Error('failed');};
  assert.equal((await box.module.exports.getStreams('123','movie')).length,1);assert.equal(shared,1);
});
test('AES fixture decrypts through native bridge and fallback without modifying shared crypto',async()=>{
  const original=CryptoJS.AES.decrypt; let called=false;
  const payload={videoUrl:'https://cdn.invalid/video.mp4'};
  const box=load({__crypto_aes_decrypt_raw:(mode,k,iv,bytes)=>{called=true;assert.ok(k instanceof Int8Array);return Buffer.from(JSON.stringify(payload));}});
  assert.deepEqual(JSON.parse(await box.decryptCastle(cipher(payload),security)),payload);assert.ok(called);assert.equal(CryptoJS.AES.decrypt,original);
  box.__crypto_aes_decrypt_raw=()=>{throw Error('JNI unavailable');};
  assert.deepEqual(JSON.parse(await box.decryptCastle(cipher(payload),security)),payload);assert.equal(CryptoJS.AES.decrypt,original);
});
test('bounded audio wait rejects stalled requests and quality parser handles 4K',async()=>{
  const box=load();await assert.rejects(box.castleBounded(()=>new Promise(()=>{}),10),/timed out/);
  assert.equal(box.getQualityValue('4K'),2160);
});
