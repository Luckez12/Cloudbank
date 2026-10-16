import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let mode='good',calls=[],active=0,aborted=0;
const search='<div class="movie-card"><span class="movie-card-title">Vikings</span><span class="movie-card-format">Series</span><span>2013</span><a href="/vikings-series-1133/">Open</a></div>';
const item=(season,ep)=>`<div class="season-item"><div class="episode-number">Season ${season}</div><div class="episode-download-item"><div class="episode-file-info"><span class="badge-psa">Episode-${ep}</span></div>Vikings S0${season}E0${ep} 1080p English x264.mkv<a href="https://greenmotors.club/?id=s${season}e${ep}">HubCloud</a><a href="https://hubdrive.pics/file/dead">HubDrive</a></div></div>`;
const page='<div class="episodes-list">'+item(1,1)+item(1,2)+item(2,1)+'</div>';
const b64=s=>Buffer.from(s).toString('base64'),rot=s=>s.replace(/[A-Za-z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13)));
const payload=b64(b64(rot(b64(JSON.stringify({o:b64('https://hubcloud.ist/drive/good')})))));
const ctx={module:{exports:{}},require,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console:{log:x=>{if(process.env.FOURK_TRACE)console.log(x);}},VUEO_DISCOVERY_CONTEXT:{tmdb:{id:44217,name:'Vikings',first_air_date:'2013-03-03',original_language:'en'}},fetch:async(url,opts={})=>{
 calls.push({url,opts});const u=new URL(url);let text='',status=200,type='text/html',extra={};
 if(mode==='hang')return new Promise((_,reject)=>{active++;opts.signal.addEventListener('abort',()=>{active--;aborted++;reject(Error('aborted'));},{once:true});});
 if(u.hostname==='4khdhub.one'&&u.searchParams.has('s'))text=search;
 else if(u.pathname==='/vikings-series-1133/')text=page;
 else if(u.hostname==='greenmotors.club'){assert.equal(u.searchParams.get('id'),'s1e1');text=`<script>s('o','${payload}')</script>`;}
 else if(u.pathname==='/drive/good')text=`<h4>Vikings S01E01.mkv</h4><script>var url = 'https://gamerxyt.com/hubcloud.php?id=good'</script>`;
 else if(u.hostname==='gamerxyt.com')text='<a href="https://ads.example/download">Download Ad</a><a href="https://gpdl.hubcloud.ist/file/good">Download File</a>';
 else if(u.hostname==='gpdl.hubcloud.ist')text="<script>const params = new URLSearchParams(window.location.search);const link = params.get('link');document.getElementById('downloadBtn').href = link;</script>";
 else if(u.hostname==='hubdrive.pics')text='<h4>File not found !</h4>';
 else if(u.hostname==='unresolved.hubcloud.ist')text='<a href="https://ads.example/download">Download Ad</a>';
 else if(u.hostname==='media.workers.dev'){
  if(mode==='dead'){status=404;type='text/plain';}
  else if(mode==='html'){type='text/html';text='<html>no video</html>';}
  else if(opts.method==='HEAD'){status=403;type='text/plain';}
  else{assert.equal(opts.headers.Range,'bytes=0-1');status=206;type='video/x-matroska';extra['content-disposition']='attachment; filename="'+(mode==='mismatch'?'Vikings.S02E01.mkv':'Vikings.S01E01.mkv')+'"';}
 }else if(u.hostname==='hls.example'){type='application/vnd.apple.mpegurl';text='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080\nv.m3u8';}
 else throw Error('Unexpected host/path '+u.hostname+u.pathname);
 return {ok:status>=200&&status<300,status,url:u.hostname==='gpdl.hubcloud.ist'?'https://cryptonewz.online/?link='+encodeURIComponent('https://media.workers.dev/Vikings.S01E01.mkv'):url,headers:{get:k=>k.toLowerCase()==='content-type'?type:extra[k.toLowerCase()]||''},text:async()=>text};
}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('providers/4khdhub.js','utf8'),ctx);
const engine=()=>{let s=ctx.fourKState();s.results=[];return ctx.fourKEngine(s);};let e=engine();
for(const c of [{title:'Vikings',type:'series',year:2022},{title:'Vikings: Valhalla',type:'series',year:2013}])assert.ok(e.scoreSearchCandidate(c,{aliases:['Vikings'],year:2013},'tv')<0);
assert.equal(e.parseTvBlocks(page,'https://4khdhub.one/',1,1).length,1);assert.equal(e.parseTvBlocks(page,'https://4khdhub.one/',2,1).length,1);
assert.equal(e.releaseInfo({text:'1080p Hindi dubbed',quality:'1080p'},{language:'en'},'tv',1,1),null);assert.ok(e.releaseInfo({text:'1080p Hindi English',quality:'1080p'},{language:'en'},'tv',1,1));
assert.equal((await ctx.module.exports.getStreams('bad','tv',1,1)).length,0);assert.equal(calls.length,0);
let rows=await ctx.module.exports.getStreams(44217,'tv',1,1);assert.equal(rows.length,1);assert.equal(rows[0].url,'https://media.workers.dev/Vikings.S01E01.mkv');assert.equal(rows[0].quality,'1080p');assert.equal(rows[0].playbackVerified,false);
assert.ok(calls.some(c=>c.url.includes('gpdl.hubcloud.ist')&&c.opts.method!=='HEAD'));assert.ok(!calls.some(c=>c.url.includes('ads.example')||c.url.includes('s1e2')||c.url.includes('s2e1')));
for(const value of ['dead','html','mismatch']){mode=value;assert.equal((await ctx.module.exports.getStreams(44217,'tv',1,1)).length,0,value);}
mode='good';e=engine();let release={season:1,episode:1,quality:'1080p',audioLanguages:['en']};assert.equal(await e.resolveServer('https://hubdrive.pics/file/dead','',release),null);assert.equal(await e.resolveServer('https://unresolved.hubcloud.ist/page','',release),null);
e=engine();let hls=await e.resolveServer('https://hls.example/master.m3u8','',release);assert.equal(hls.isMaster,true);
mode='hang';calls=[];const realState=ctx.fourKState;ctx.fourKState=()=>{let s=realState();s.deadline=Date.now()+40;return s;};assert.equal((await ctx.module.exports.getStreams(44217,'tv',1,1)).length,0);const count=calls.length;await new Promise(r=>setTimeout(r,70));assert.equal(calls.length,count);assert.equal(active,0);assert.equal(aborted,1);
const root='../../audit-4khdhub/';if(fs.existsSync(root+'detail-tv.html')){e=engine();assert.equal(e.parseTvBlocks(fs.readFileSync(root+'detail-tv.html','utf8'),'https://4khdhub.one/',1,1).length,3);assert.equal(e.parseMovieBlocks(fs.readFileSync(root+'detail-movie.html','utf8'),'https://4khdhub.one/').length,5);}
if(fs.existsSync(root+'gpdl.html')){
 const headers=fs.readFileSync(root+'gpdl.headers','utf8');const lines=headers.split(/\r?\n/).filter(l=>/^location:/i.test(l));const final=lines.at(-1).slice(9).trim();
 e=engine();const options=e.pageCandidates(fs.readFileSync(root+'gpdl.html','utf8'),final);assert.ok(options.some(x=>new URL(x.url).hostname==='video-downloads.googleusercontent.com'));
}
console.log('PASS 4KHDHub: exact title/year, season isolation, original audio, gate decoding, HubCloud/gpdl continuation, signed GET vs HEAD, missing/dead/HTML rejection, filename mismatch, master HLS, no ads, deadline abort and no late requests.');
