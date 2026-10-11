import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const manifest = JSON.parse(fs.readFileSync('manifest.json'));
function helper(context) {
  const box = { VUEO_DISCOVERY_CONTEXT: context }; box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync('scripts/stream-display.js','utf8'), box);
  return box;
}
test('every registered provider is standalone; PlayIMDb reference is untouched', () => {
  for (const scraper of manifest.scrapers) {
    const source = fs.readFileSync(scraper.filename,'utf8');
    assert.ok(!source.includes('CLOUDBANK_STREAM_DISPLAY_START'), scraper.id);
    assert.equal(source.includes('CLOUDBANK_PLAYIMDB_DISPLAY_START'), scraper.id !== 'playimdb', scraper.id);
  }
  for (const id of ['gramcinema','showbox','showbox-v2']) assert.ok(!manifest.scrapers.some(p => p.id === id));
});
test('movie matches original PlayIMDb layout; every playback field survives unchanged', async () => {
  const b = helper({tmdb:{id:123,title:'Example',release_date:'2026-03-01',runtime:90}});
  const source = {url:'https://cdn.invalid/a.m3u8?token=x',quality:'720p',audioLanguage:'en',serverName:'VidNest',headers:{Referer:'https://site.invalid'},subtitles:[{url:'https://cdn.invalid/en.vtt',lang:'en'}],behaviorHints:{x:1},type:'direct',custom:42};
  let received; const settings = () => 1;
  const p = b.cloudbankDisplayInstall({getStreams(...args){received=args;return [source];},onSettings:settings},'ExampleProvider V2','example-v2');
  const [s] = await p.getStreams('123','movie',undefined,undefined,{token:'test'});
  assert.equal(s.name,'🟡 ExampleProvider V2 | 720p HD | English-Audio');
  assert.equal(s.title,'🎬 Example - 2026\n💎 720P | 🌍 English\n🎞️ M3U8 | ⏱️ 90 min | 📌 VidNest');
  for (const key of Object.keys(source)) assert.equal(s[key],source[key]);
  assert.equal(source.name,undefined); assert.equal(p.onSettings,settings);
  assert.deepEqual(received,['123','movie',undefined,undefined,{token:'test'}]);
});
test('series title and explicit duration; average series runtime is not invented', async () => {
  const b = helper({tmdb:{id:123,name:'Series',first_air_date:'2024-01-01',runtime:90,episode_run_time:[45]}});
  const p = b.cloudbankDisplayInstall({getStreams(){return [{url:'https://cdn.invalid/a.mp4',quality:'1080p',audioLanguage:'original',duration:'37 min'}, {url:'https://cdn.invalid/b.mp4'}];}},'TVProvider','tv');
  const s = await p.getStreams('123','series',2,3);
  assert.equal(s[0].title,'🎬 Series - S2E3 (2024)\n💎 1080P | 🌍 Original\n🎞️ MP4 | ⏱️ 37 min | 📌 Server 1');
  assert.equal(s[1].title,'🎬 Series - S2E3 (2024)\n🎞️ MP4 | 📌 Server 2');
});
test('unknown fields stay hidden; subtitle language is not audio; wrong context is ignored', async () => {
  const b=helper({tmdb:{id:999,title:'Wrong Film',runtime:90}});
  const p=b.cloudbankDisplayInstall({getStreams(){return [{url:'https://cdn.invalid/video',quality:'auto',subtitles:[{lang:'en'}]}];}},'Source','source');
  const [s]=await p.getStreams('123','movie');
  assert.equal(s.name,'🟡 Source'); assert.equal(s.title,'📌 Server 1');
});
test('available shared metadata is captured without extra requests; isolated by ID', async () => {
  const b=helper();b.vueoSharedTmdb=async(url,fallback)=>fallback();
  // Install once more in a fresh context with the shared helper already available.
  const c={vueoSharedTmdb:b.vueoSharedTmdb};c.globalThis=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync('scripts/stream-display.js','utf8'),c);
  const p=c.cloudbankDisplayInstall({async getStreams(id){await c.vueoSharedTmdb('https://api.themoviedb.org/3/movie/'+id,()=>({id,title:'Film '+id}));return [{url:'https://cdn.invalid/a.mp4'}];}},'Source','source');
  const results=await Promise.all([p.getStreams('1','movie'),p.getStreams('2','movie')]);
  assert.ok(results[0][0].title.startsWith('🎬 Film 1\n'));assert.ok(results[1][0].title.startsWith('🎬 Film 2\n'));
});
test('reference provider, empty results and informational output survive', async()=>{
  const b=helper();const reference={getStreams(){return []}};
  assert.equal(b.cloudbankDisplayInstall(reference,'PlayIMDb','playimdb'),reference);
  const info={title:'Configure token'};
  const p=b.cloudbankDisplayInstall({getStreams(){return [info]}},'Source','source');
  assert.equal((await p.getStreams('123','movie'))[0],info);
  const empty=b.cloudbankDisplayInstall(reference,'Source','source');assert.equal((await empty.getStreams('123','movie')).length,0);
});
test('real PlayIMDb resolver retains its own name and source display', async () => {
  const box = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, URL, URLSearchParams, require,
    fetch: async url => {
      const data = url.includes('themoviedb.org') ? { id: 123, title: 'Project Hail Mary', release_date: '2026-03-01', runtime: 90 } :
        { status_code: 200, data: { file_name: 'Project.Hail.Mary.2026.720p.English', stream_urls: ['https://cdn.invalid/a.m3u8', 'https://cdn.invalid/b.mp4'] }, default_subs: [{ code: 'en', lang: 'English', url: 'https://cdn.invalid/en.vtt' }] };
      return { ok: true, status: 200, headers: {}, json: async () => data };
    } };
  box.globalThis = box; box.global = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync('providers/playimdb.js', 'utf8'), box);
  const streams = await box.module.exports.getStreams('123', 'movie');
  assert.equal(streams.length, 2);
  assert.ok(streams[0].name.includes('PlayIMDb'));
  assert.notEqual(streams[0].name, '');
  assert.ok(!streams[0].title.includes('Subtitles: English, Malay'));
  assert.equal(streams[0].url, 'https://cdn.invalid/a.m3u8');
  assert.equal(streams[1].url, 'https://cdn.invalid/b.mp4');
  assert.equal(streams[0].subtitles[0].url, 'https://cdn.invalid/en.vtt');
});
