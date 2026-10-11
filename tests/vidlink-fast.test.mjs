import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function load(file, payload, options = {}) {
 const calls=[];
 const sandbox={module:{exports:{}}, console:{log(){},error(){}}, URL, Promise,setTimeout,clearTimeout,
 VUEO_DISCOVERY_CONTEXT:{tmdb:{title:'Example',release_date:'2026-01-01'}},
 fetch:async(url)=>{calls.push(url);
 if(url.includes('api.themoviedb.org')) throw Error('Metadata unavailable');
 if(url.includes('enc-vidlink')) return {ok:true,json:async()=>({result:'encoded'})};
 if(url.includes('/api/b/')) return {ok:true,json:async()=>payload};
 throw Error('Unexpected extra request '+url);
 }};
 if(options.noMetadata) delete sandbox.VUEO_DISCOVERY_CONTEXT;
 sandbox.global=sandbox; sandbox.globalThis=sandbox;
 vm.runInNewContext(fs.readFileSync('providers/'+file+'.js','utf8'),sandbox);
 return {get:sandbox.module.exports.getStreams,calls};
}
for(const file of ['vidlink']) {
 test(file+': API playlist wins over variants and keeps subtitles',async()=>{
 const {get,calls}=load(file,{stream:{playlist:'https://cdn.test/master.m3u8',qualities:{'1080p':{url:'https://cdn.test/1080.m3u8'}}},subtitles:[{url:'https://cdn.test/en.vtt',lang:'en'}]});
 const out=await get('123','movie'); assert.equal(out.length,1); assert.equal(out[0].url,'https://cdn.test/master.m3u8'); assert.equal(out[0].quality,'Auto'); assert.equal(out[0].subtitles[0].url,'https://cdn.test/en.vtt'); assert.equal(calls.length,2);
 });
 test(file+': qualities fallback without playlist',async()=>{
 const {get}=load(file,{stream:{qualities:{'720p':{url:'https://cdn.test/720.m3u8'}}}});
 const out=await get('123','movie'); assert.equal(out.length,1); assert.equal(out[0].quality,'720p');
 });
 test(file+': direct TV route and metadata failure do not lose streams',async()=>{
 const {get,calls}=load(file,{url:'https://cdn.test/video.mp4',quality:'1080p'},{noMetadata:true});
 const out=await get('123','tv',0,2); assert.equal(out.length,1); assert.ok(calls.some(u=>u.endsWith('/tv/encoded/0/2')));
 });
 test(file+': multiple server fallback preserves all links',async()=>{
 const {get}=load(file,{streams:[{url:'https://one.test/a.mp4'},{url:'https://two.test/b.mp4'}]}); assert.equal((await get('123','movie')).length,2);
 });
 test(file+': invalid response and arbitrary URLs rejected',async()=>{
 for(const data of [null,{poster:'https://img.test/poster.jpg'},{url:'javascript:bad'}]) {
 const {get}=load(file,data); assert.equal((await get('123','movie')).length,0);
 }
 });
}
