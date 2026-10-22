const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const source=fs.readFileSync(path.join(__dirname,'../providers/vidrock.js'),'utf8'),key=/BOOTSTRAP_KEY\s*=\s*'([0-9a-f]{64})'/.exec(source)[1],other='abcdef0123456789'.repeat(4);
function seal(url,k=key){let iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',Buffer.from(k,'hex'),iv);return Buffer.concat([iv,c.update(url),c.final(),c.getAuthTag()]).toString('base64url');}
function load(fetch){let logs=[],ctx={module:{exports:{}},console:{log:s=>logs.push(s)},URL,Uint8Array,atob,setTimeout,clearTimeout,fetch,VUEO_DISCOVERY_CONTEXT:{title:'Fixture',mediaType:'movie',tmdbId:55,originalLanguage:'en'}};vm.createContext(ctx);vm.runInContext(source.replace('module.exports={getStreams:run};','module.exports={getStreams:run,_test:{decrypt,playlist,audio}};'),ctx);return {...ctx.module.exports,logs};}
function scenario({mode='master',audio='English',count=1}={}){let calls=[],apiKey=key,bundleKey=key;const f=load(async(url,opts)=>{
 calls.push(url);assert.equal(opts.headers.Referer,'https://vidrock.net/');assert.equal(opts.headers.Origin,'https://vidrock.net');assert.equal(opts.headers.Range,undefined);let body='',final=url;
 if(url==='https://vidrock.net/')body='<script src="/assets/index-fixture.js"></script>';
 else if(url.includes('/assets/'))body='const publicKey="'+bundleKey+'"; /* AES-GCM importKey decrypt */';
 else if(url.includes('/api/')){let out={};for(let i=0;i<count;i++)out['Server'+i]={url:seal('https://media.test/token'+i,apiKey),language:audio};body=JSON.stringify(out);}
 else if(url.startsWith('https://sub.vdrk.site/'))body='[{"label":"English","file":"https://caption.test/en.vtt"}]';
 else if(/^https:\/\/media.test\/token\d+$/.test(url)||url==='https://media.test/selected'){
  if(mode==='html')body='<html>#EXTM3U challenge</html>';
  else if(mode==='empty')body='#EXTM3U';
  else if(mode==='missing')body='#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080';
  else if(mode==='media')body='#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts';
  else if(mode==='json'&&url!=='https://media.test/selected')body='[{"resolution":360,"url":"https://media.test/low"},{"resolution":2160,"url":"https://media.test/selected"}]';
  else if(mode==='no-resolution')body='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nchild.m3u8';
  else if(mode==='low')body='#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\nlow.m3u8';
  else {body='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Original",URI="audio.m3u8"\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160,CODECS="hvc1.1.6",AUDIO="audio"\n4k.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x800,CODECS="avc1.640028",AUDIO="audio"\n1080p.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720p.m3u8';if(mode==='redirect')final='https://edge.test/master-token';}
 }else throw Error('Unexpected child/segment fetch: '+url);
 return {ok:true,status:200,url:final,headers:{get:()=> 'text/html'},text:async()=>body};
 });return {f,calls,rotate(){apiKey=other;bundleKey=other;}};}
(async()=>{
 const t=load(()=>{throw Error('unexpected fetch')})._test;
 for(let i=0;i<25;i++){let k=crypto.randomBytes(32).toString('hex'),url='https://fixture.test/'+crypto.randomBytes(i*5+1).toString('hex'),cipher=seal(url,k);assert.equal(t.decrypt(cipher,k),url);let b=Buffer.from(cipher,'base64url');b[b.length-1]^=1;assert.throws(()=>t.decrypt(b.toString('base64url'),k),/authentication/);}
 let s=scenario({count:2}),out=await s.f.getStreams('55','movie');assert.equal(out.length,2);assert.equal(s.calls.filter(x=>x.startsWith('https://media.test/')).length,2);
 for(const item of out){assert.match(item.url,/\/token\d$/);assert.equal(item.mimeType,'application/x-mpegURL');assert.equal(item.quality,'Auto');assert.equal(item.isAdaptive,true);assert.equal(item.maxQuality,2160);assert.deepEqual(Array.from(item.availableQualities),['2160p','1080p','720p']);assert.equal(item.videoCodec,'unknown');assert(item.name.includes('Auto'));assert(item.subtitles.some(x=>x.language==='en'));}
 for(const mode of ['html','empty','missing']){s=scenario({mode});assert.equal((await s.f.getStreams('55','movie')).length,0);}
 for(const mode of ['media','no-resolution','low','redirect','json']){s=scenario({mode});out=await s.f.getStreams('55','movie');assert.equal(out.length,1);assert.equal(out[0].mimeType,'application/x-mpegURL');if(mode==='media'){assert.equal(out[0].isAdaptive,false);assert.equal(out[0].url,'https://media.test/token0');}else assert.equal(out[0].isAdaptive,true);if(mode==='redirect')assert.equal(out[0].url,'https://edge.test/master-token');if(mode==='json')assert.equal(out[0].url,'https://media.test/selected');}
 s=scenario({audio:'Hindi'});assert.equal((await s.f.getStreams('55','movie')).length,0);assert(!s.calls.some(x=>x.startsWith('https://media.test/')));
 s=scenario({audio:'Unknown'});assert.equal((await s.f.getStreams('55','movie')).length,1);s.rotate();assert.equal((await s.f.getStreams('55','movie')).length,1);assert.equal(s.calls.filter(x=>x==='https://vidrock.net/').length,1);
 s=scenario();s.rotate();assert.equal((await s.f.getStreams('55','movie')).length,1);assert(s.f.logs.some(x=>x.includes('keyCache=refreshed')));
 s=scenario();assert.equal((await s.f.getStreams('55','tv',0,1)).length,1);assert(s.calls.includes('https://vidrock.net/api/tv/55/0/1'));let count=s.calls.length;
 for(const args of [['55','tv',null,1],['55','tv',1,0],['55','tv',1.5,1],['0','movie'],['55x','movie'],['55','anime']])assert.equal((await s.f.getStreams(...args)).length,0);assert.equal(s.calls.length,count);
 assert(!source.includes('verifyVariant'));assert(!source.includes('segmentProbes=1'));assert(!source.includes('renditionRecipe'));
 console.log('PASS: original master/opaque-token URLs; one playlist fetch per server; no child/segment probes; Auto quality incl 4K, unknown resolution and sub-720; audio groups retained; direct media/JSON/redirect; HLS MIME/headers; GCM tamper/refresh; audio policy; exact TV/specials; invalid input.');
})().catch(e=>{console.error(e);process.exitCode=1});
