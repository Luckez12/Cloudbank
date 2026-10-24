const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync('providers/vidlove.js','utf8').split('/* CLOUDBANK_UPSTREAM_SOURCE_START */')[1].split('/* CLOUDBANK_UPSTREAM_SOURCE_END */')[0];
const c={URL,module:{exports:{}},console:{log(){}},setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(code,c);
let n=0;function test(s,fn){fn();console.log('PASS '+s);n++;}
const mp4={url:'https://media.test/1080.mp4',type:'mp4',quality:'1080p',codec:'h264'};
const source=(extra={})=>({url:'https://media.test/master.m3u8?sig=A%2FB+Z',headers:{Cookie:'parent',Referer:'https://origin.test/'},qualities:[mp4],...extra});
const map=s=>c.vlMapPayload({meta:{id:12345},source:s},'12345','movie').stream;
test('HLS signed master and headers preserved with MP4 alternatives',()=>{const s=source(),r=map(s);assert.equal(r.url,s.url);assert.equal(r.format,'hls');assert.equal(r.quality,'Auto');assert.equal(r.headers.Cookie,'parent');});
test('Extensionless declared HLS master preserved',()=>{const s=source({url:'https://media.test/api?sig=A%2FB',mimeType:'application/x-mpegURL'});assert.equal(map(s).url,s.url);});
test('Inline HLS master preserved',()=>{const s=source({url:'https://media.test/api',manifest:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild'});assert.equal(map(s).url,s.url);});
test('DASH master preserved',()=>{assert.equal(map(source({url:'https://media.test/master.mpd'})).format,'dash');});
test('Low MP4 alternatives do not discard adaptive master',()=>{assert.equal(map(source({qualities:[{...mp4,quality:'480p'}]})).format,'hls');});
test('Untyped parent still uses eligible direct rendition',()=>{assert.equal(map(source({url:'https://media.test/api'})).url,mp4.url);});
test('Same-origin child headers merge with case-insensitive overrides',()=>{const r=map(source({url:'https://media.test/api',qualities:[{...mp4,headers:{referer:'https://child.test/','X-Child':'yes'}}]}));assert.equal(r.headers.Cookie,'parent');assert.equal(r.headers.referer,'https://child.test/');assert.equal(r.headers.Referer,undefined);assert.equal(r.headers['X-Child'],'yes');});
test('Cross-origin child does not inherit parent credentials',()=>{const r=map(source({url:'https://media.test/api',qualities:[{...mp4,url:'https://other.test/1080.mp4',headers:{'X-Child':'yes'}}]}));assert.equal(r.headers.Cookie,undefined);assert.equal(r.headers['X-Child'],'yes');});
test('Direct-only low quality remains rejected',()=>{assert.throws(()=>map(source({url:'https://media.test/api',qualities:[{...mp4,quality:'480p'}]})),/eligible quality/);});
test('Dub-only adaptive parent remains rejected',()=>{assert.throws(()=>c.vlMapPayload({meta:{id:12345,original_language:'ja'},source:source({audioLanguage:'en',isDubbed:true})},'12345','movie'),/dub-only/);});
console.log(n+' selection/header checks passed');
