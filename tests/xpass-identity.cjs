const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),C=require('crypto-js');
const core=fs.readFileSync('providers/xpass.js','utf8').split('/* CLOUDBANK_UPSTREAM_SOURCE_START */')[1].split('/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0];const c={module:{exports:{}},require:()=>C,URL,setTimeout,clearTimeout,console};vm.createContext(c);vm.runInContext(core,c);
const e={id:'126437',type:'tv',season:2,episode:5};
for(const value of [{season:1,episode:5},{metadata:{season_number:1,episode_number:5}},{tmdb_id:999},{filename:'Show.S01E05.1080p.mkv'},{title:'Show Season 1 Episode 5'},{url:'/vrk/tv/126437/1/5/playlist.json'}])assert.equal(c.xpIdentity(value,e).ok,false);
for(const value of [{season:'2',episode:5},{filename:'Show.S02E05.1080p.mkv'},{url:'/vrk/tv/126437/2/5/playlist.json'}]){const r=c.xpIdentity(value,e);assert(r.ok&&r.evidence>0);}
assert.equal(c.xpIdentity({id:999,episode_id:100,season_id:30,url:'https://media.test/opaque.m3u8?sig=S01E05'},e).evidence,0);
assert(c.xpIdentity({tmdb_id:126437},{...e,id:'tt123'}).ok);
assert(c.xpIdentity({season:0,episode:2},{...e,season:0,episode:2}).ok);
const good={file:'https://cdn.test/master.m3u8?sig=A%2FB',type:'hls'},bad={...good,season:1};
let rows=c.xpMap({playlist:[{season:1,sources:[good]},{season:2,episode:5,sources:[bad,good]}]},'server','https://play.xpass.top/',e);
assert.equal(rows.length,1);assert.equal(rows[0].url,good.file);
assert.equal(c.xpMap({season:1,playlist:[{sources:[good]}]},'server','https://play.xpass.top/',e).length,0);
assert.equal(c.xpMap({playlist:[{sources:[good]}]},'server','https://play.xpass.top/',e).length,1);
console.log('PASS explicit identity conflicts rejected, mixed playlist entries filtered individually, unknown opaque URLs retained, season zero and IMDb identity supported');
