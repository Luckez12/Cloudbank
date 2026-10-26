const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync('providers/hdhub4u.js','utf8');const c={URL,console:{log(){}}};vm.createContext(c);vm.runInContext("var UA='test';"+code.slice(code.indexOf('function log'),code.indexOf('async function run')),c);
const base='https://hdstream4u.com/v/example';
assert.equal(c.watchStreams('var links={"hls4":"/stream/a/master.m3u8","hls3":"https://cdn.example/master.txt","hls2":"https://old.example/master.m3u8"};',base)[0],'https://hdstream4u.com/stream/a/master.m3u8');
assert.equal(c.watchStreams('var links={"hls3":"https://cdn.example/master.txt","hls2":"https://old.example/master.m3u8"};',base)[0],'https://cdn.example/master.txt');
const packed=`eval(function(p,a,c,k,e,d){return p}('0 1={"2":"/stream/a/master.m3u8"};var tracks=[{file:"/en.vtt",label:"English"},{file:"/hi.vtt",label:"Hindi"}];',36,3,'var|links|hls4'.split('|'),0,{}))`;
const decoded=c.unpackPacker(packed);assert.equal(c.watchStreams(decoded,base)[0],'https://hdstream4u.com/stream/a/master.m3u8');
const $=require('cheerio-without-node-native').load('<script></script>');$('script').text(decoded);const subs=c.subtitleTracks($,base);assert.equal(subs.length,1);assert.equal(subs[0].url,'https://hdstream4u.com/en.vtt');assert.equal(subs[0].language,'en');
console.log('PASS WATCH: relative hls4 priority, txt hls3 fallback when hls4 absent, packed links and English captions');
