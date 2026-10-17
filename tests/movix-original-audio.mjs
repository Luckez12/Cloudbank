import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const code = fs.readFileSync('providers/movix.js','utf8');
let primary=[], fallback={vf:[],vostfr:[]}, calls=[], original='en', apiError=false, masterLanguages=['fr'];
const c={module:{exports:{}},Promise,setTimeout,clearTimeout,console:{log(){}},
 VUEO_DISCOVERY_CONTEXT:{tmdb:{id:550,title:'Test film',original_language:'en',release_date:'1999-01-01'}},
 fetch:async(url,options)=>{calls.push({url,options});
  if(url.endsWith('/domains.json'))return {ok:true,json:async()=>({movix:'example'})};
  if(url.includes('/api/purstream/')){if(apiError)throw Error('offline');return {ok:true,json:async()=>({sources:primary})};}
  if(url.includes('/api/cpasmal/'))return {ok:true,json:async()=>({links:fallback})};
  if(url.includes('/season/'))return {ok:true,json:async()=>({name:'Episode',runtime:24})};
  if(url.startsWith('https://redirect.example/'))return {ok:true,url:url.replace('redirect.example','cdn.example'),text:async()=> '#EXTM3U\n'+masterLanguages.map(l=>'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="'+l+'",URI="'+l+'.m3u8"').join('\n')};
  if(url.startsWith('https://embed.example/bad'))throw Error('bad host');
  if(url.startsWith('https://embed.example/'))return {ok:true,text:async()=>`file: "https://cdn.example/${url.split('/').pop()}.m3u8"`};
  throw Error('Unexpected request '+url);
 }};
vm.runInNewContext(code,c);
const src=(name,n,extra={})=>({name,url:`https://redirect.example/${n}.m3u8`,format:'m3u8',...extra});
const embed=n=>({url:`https://embed.example/${n}`,server:n});
async function get(type='movie'){
 calls=[];c.VUEO_DISCOVERY_CONTEXT.tmdb.original_language=original;
 return c.getStreams(550,type,...(type==='tv'?[1,2]:[]));
}
// Filter before any redirect resolution, preserve original source headers/URLs.
primary=[src('1080p VF','dub'),src('720p VOSTFR','original'),src('Dual-Audio','unknown')];
let result=await get();assert.equal(result.length,1);assert.equal(result[0].url,'https://cdn.example/original.m3u8');assert.equal(result[0].audioLanguage,'en');assert.equal(result[0].headers['User-Agent'],'Mozilla/5.0');assert.ok(!calls.some(x=>x.url.includes('/dub.')));assert.ok(!calls.some(x=>x.url.includes('/api/cpasmal/')));
// Empty/or dub-only primary must use Cpasmal; six VF entries cannot consume the limit.
primary=[src('VF','dub')];fallback={vf:Array.from({length:6},(_,i)=>embed('vf'+i)),vostfr:[embed('sub')]};
result=await get();assert.equal(result.length,1);assert.equal(result[0].url,'https://cdn.example/sub.m3u8');assert.ok(!calls.some(x=>x.url.includes('embed.example/vf')));assert.equal(result[0].headers.Referer,'https://movix.example/');
// French originals retain VF, which is their original audio rather than a foreign dub.
original='fr';primary=[src('1080p VF','french')];result=await get();assert.equal(result.length,1);assert.equal(result[0].audioLanguage,'fr');
// Anime: keep VOSTFR and explicitly Japanese tracks; reject English dub and unknown dual.
original='ja';primary=[src('English Dub','english',{lang:'en'}),src('Japanese','japanese',{lang:'jpn'}),src('VF','vf',{lang:'vf'}),src('VOSTFR','sub'),src('MULTI','unknown')];
result=await get('tv');assert.equal(result.length,2);assert.ok(result.every(x=>x.audioLanguage==='ja'));assert.ok(!calls.some(x=>x.url.includes('/english.')||x.url.includes('/vf.')));
// Empty primary / primary failure / host failure: usable fallback survives.
primary=[];fallback={vf:[],vostfr:[embed('bad'),embed('good')]};result=await get();assert.equal(result.length,1);assert.ok(result[0].url.includes('good'));
apiError=true;result=await get();assert.equal(result.length,1);apiError=false;
// No original sources: do not fall back to a dub or relabel it as original.
primary=[src('VF','dub')];fallback={vf:[embed('vf')],vostfr:[]};result=await get();assert.equal(result.length,0);
// Unknown language can retain explicit VO, but never generic dual or unknown streams.
original='';primary=[src('VO','vo'),src('Dual','dual'),src('Unknown','unknown')];result=await get();assert.equal(result.length,1);assert.equal(result[0].audioLanguage,'original');
// True language-less metadata payloads remain conservative; case-insensitive original tags.
original='ja';primary=[src('vostfr','lower')];result=await get();assert.equal(result.length,1);
// MULTI is retained only when the actual HLS audio list contains the original.
original='ja';masterLanguages=['fr','ja'];primary=[src('1080p MULTI','multi')];
result=await get();assert.equal(result.length,1);assert.deepEqual(Array.from(result[0].audioLanguages),['fr','ja']);assert.equal(result[0].audioLanguage,'ja');assert.equal(calls.filter(x=>x.url.startsWith('https://redirect.example/')).length,1);assert.ok(!calls.some(x=>/\/(?:fr|ja)\.m3u8$/.test(x.url)));
masterLanguages=['fr'];fallback={vf:[],vostfr:[]};result=await get();assert.equal(result.length,0);
console.log('PASS: Movix originals-only extraction, French originals, anime filtering, pre-resolution exclusion, fallback ordering, empty/error fallback and isolated host failures.');
