import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);

const formatter = fs.readFileSync('scripts/stream-display.js', 'utf8').trim();
const manifest = JSON.parse(fs.readFileSync('manifest.json'));
function create(streams, extra = {}) {
  const box = { console, Promise, ...extra };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(formatter, box);
  const original = { getStreams: async () => streams, onSettings: () => 'settings' };
  return { box, original, provider: box.cloudbankDisplayInstall(original, 'PlayIMDb', 'playimdb') };
}
const context = { tmdb: { id: 123, title: 'Project Hail Mary', release_date: '2026-03-01', runtime: 90 } };
test('English display has no provider row, preserves playback and does not mutate original', async () => {
  const source = { name: 'PlayIMDb Server 1', title: 'Project Hail Mary 2026 WEB-DL HEVC', quality: '1080p', audioLanguage: 'en', audioCodec: 'AAC', audioChannels: '5.1', size: '2.4 GB', url: 'https://cdn.invalid/a.m3u8?token=secret', headers: { Referer: 'https://site.invalid/' }, subtitles: [{ lang: 'eng', url: 'https://cdn.invalid/en.vtt' }, { language: 'ms', url: 'https://cdn.invalid/ms.vtt' }], type: 'direct', behaviorHints: { notWebReady: true } };
  const { provider, original } = create([source], { VUEO_DISCOVERY_CONTEXT: context });
  const result = (await provider.getStreams('123', 'movie'))[0];
  assert.equal(result.name, '');
  assert.equal(result.title, 'Project Hail Mary (2026)\n1080p · WEB-DL · HEVC\nEnglish Audio · AAC 5.1\nSubtitles: English, Malay\nHLS · Server 1 · 2.4 GB · 90 min');
  assert.equal(provider.onSettings, original.onSettings);
  for (const key of Object.keys(source).filter(k => !['name', 'title'].includes(k))) assert.equal(result[key], source[key]);
  assert.equal(source.name, 'PlayIMDb Server 1');
});
test('TV includes padded episode and omits series-average runtime', async () => {
  const { provider } = create([{ name: 'PlayIMDb VidNest', quality: '720p', audioLanguage: 'en', title: 'Dual-Audio', url: 'https://cdn.invalid/a.mp4' }], { VUEO_DISCOVERY_CONTEXT: { tmdb: { id: 123, name: 'Series Title', first_air_date: '2026-01-01', episode_run_time: [45], runtime: 999 } } });
  assert.equal((await provider.getStreams('123', 'series', 0, 5))[0].title, 'Series Title (2026) · S00E05\n720p\nDual Audio (English)\nMP4 · VidNest');
});
test('unknown quality/audio/size/format stay hidden; no metadata fetch added', async () => {
  const { provider } = create([{ name: 'PlayIMDb', title: 'Unknown Title', quality: 'Unknown', size: 'N/A', url: 'https://cdn.invalid/opaque?filename=a.m3u8' }], { fetch() { throw Error('Must not fetch'); } });
  assert.equal((await provider.getStreams('123', 'movie'))[0].title, 'Server 1');
});
test('observed TMDB metadata is keyed by media type and ID, safe for concurrent calls', async () => {
  const { provider, box } = create([{ url: 'https://cdn.invalid/a.mp4' }], { vueoSharedTmdb: (url, fallback) => fallback() });
  await Promise.all([
    box.vueoSharedTmdb('https://api.themoviedb.org/3/movie/123?x=1', async () => ({ title: 'First', runtime: 80 })),
    box.vueoSharedTmdb('https://api.themoviedb.org/3/movie/456?x=1', async () => ({ title: 'Second', runtime: 95 })),
    box.vueoSharedTmdb('https://api.themoviedb.org/3/tv/123?x=1', async () => ({ name: 'TV' }))
  ]);
  assert.equal((await provider.getStreams(123, 'movie'))[0].title, 'First\nMP4 · Server 1 · 80 min');
  assert.equal((await provider.getStreams(456, 'movie'))[0].title, 'Second\nMP4 · Server 1 · 95 min');
  assert.equal((await provider.getStreams(123, 'tv', 1, 2))[0].title, 'TV · S01E02\nMP4 · Server 1');
  assert.equal((await provider.getStreams(999, 'movie'))[0].title, 'MP4 · Server 1');
});
test('wrong context ID cannot supply a title or runtime', async () => {
  const { provider } = create([{ url: 'https://cdn.invalid/a.mp4' }], { VUEO_DISCOVERY_CONTEXT: context });
  assert.equal((await provider.getStreams(456, 'movie'))[0].title, 'MP4 · Server 1');
});
test('source title survives missing TMDB; explicit HDR, codec, size and audio normalise', async () => {
  const { provider } = create([{ title: 'Example Movie (2025)\n2160p BluRay HDR10+ x265 Dolby Atmos 7.1 10 GB', name: 'PlayIMDb Server 2', url: 'https://cdn.invalid/a.mkv' }]);
  assert.equal((await provider.getStreams(123, 'movie'))[0].title, 'Example Movie (2025)\n4K · BluRay · HEVC · HDR10+\nDolby Atmos 7.1\nMKV · Server 2 · 10 GB');
});
test('film title is not interpreted as release or language information', async () => {
  const { provider } = create([{ title: 'English Audio BluRay (2026)', url: 'https://cdn.invalid/a.mp4' }], { VUEO_DISCOVERY_CONTEXT: { tmdb: { id: 123, title: 'English Audio BluRay', release_date: '2026-01-01' } } });
  assert.equal((await provider.getStreams(123, 'movie'))[0].title, 'English Audio BluRay (2026)\nMP4 · Server 1');
});
test('plain source content title is retained when no TMDB context exists', async () => {
  const { provider } = create([{ title: 'A Movie Title', url: 'https://cdn.invalid/a.mp4' }]);
  assert.equal((await provider.getStreams(123, 'movie'))[0].title, 'A Movie Title\nMP4 · Server 1');
});
test('MovieBlast source server and language survive technical label cleanup', async () => {
  const { provider } = create([{ name: 'PlayIMDb', title: 'PlayIMDb - VidNest 1080p (EN)', quality: '1080p', url: 'https://cdn.invalid/a.mp4' }], { VUEO_DISCOVERY_CONTEXT: context });
  assert.equal((await provider.getStreams(123, 'movie'))[0].title, 'Project Hail Mary (2026)\n1080p\nEnglish Audio\nMP4 · VidNest · 90 min');
});
test('real PlayIMDb API output formats through exported provider with playback metadata intact', async () => {
  const calls = [];
  const box = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, URL, URLSearchParams, require: nodeRequire, fetch: async url => {
    calls.push(url);
    const data = url.includes('themoviedb.org') ? context.tmdb : { status_code: 200, data: { file_name: 'Project.Hail.Mary.2026.720p.English', stream_urls: ['https://cdn.invalid/a.m3u8', 'https://cdn.invalid/b.mp4'] }, default_subs: [{ code: 'en', lang: 'English', url: 'https://cdn.invalid/en.vtt' }] };
    return { ok: true, status: 200, headers: {}, json: async () => data };
  } };
  box.globalThis = box; box.global = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync('providers/playimdb.js', 'utf8'), box);
  const streams = await box.module.exports.getStreams('123', 'movie');
  assert.equal(streams.length, 2);
  assert.equal(streams[0].title, 'Project Hail Mary (2026)\n720p\nEnglish Audio\nSubtitles: English\nHLS · Server 1 · 90 min');
  assert.equal(streams[0].url, 'https://cdn.invalid/a.m3u8');
  assert.equal(streams[1].url, 'https://cdn.invalid/b.mp4');
  assert.ok(streams[1].title.endsWith('MP4 · Server 2 · 90 min'));
  assert.equal(calls.length, 2);
  assert.ok(streams[0].headers);
  assert.equal(streams[0].subtitles[0].url, 'https://cdn.invalid/en.vtt');
});
test('subtitle languages are deduplicated without altering track list; malformed labels omitted', async () => {
  const subtitles = [{ language: 'unknown', lang: 'id', url: 'a' }, { lang: 'ind', url: 'b' }, { lang: 'zz', url: 'c' }];
  const { provider } = create([{ subtitles, url: 'https://cdn.invalid/a.mp4' }]);
  const stream = (await provider.getStreams(123, 'movie'))[0];
  assert.equal(stream.title, 'Subtitles: Indonesian\nMP4 · Server 1');
  assert.equal(stream.subtitles, subtitles);
});
test('arguments and errors pass through; settings and non-stream responses preserved', async () => {
  const { box } = create([]);
  const extra = { option: true };
  let received;
  const provider = box.cloudbankDisplayInstall({ getStreams(...args) { received = args; return []; } }, 'Test', 'test');
  await provider.getStreams(123, 'tv', 1, 2, extra);
  assert.deepEqual(received, [123, 'tv', 1, 2, extra]);
  const error = Error('upstream');
  await assert.rejects(box.cloudbankDisplayInstall({ getStreams() { throw error; } }, 'Test', 'test').getStreams(123, 'movie'), e => e === error);
});
for (const scraper of manifest.scrapers) {
  test(`${scraper.id}: ships identical formatter and binds both app entry points`, async () => {
    const source = fs.readFileSync(scraper.filename, 'utf8');
    const footer = source.slice(source.indexOf('/* CLOUDBANK_STREAM_DISPLAY_START */'));
    assert.ok(footer.includes(formatter));
    assert.ok(footer.includes(JSON.stringify(scraper.name) + ', ' + JSON.stringify(scraper.id)));
    const upstream = { getStreams: async () => [{ name: scraper.name, url: 'https://cdn.invalid/test.mp4' }] };
    const box = { module: { exports: upstream }, Promise };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(footer, box);
    assert.equal(box.getStreams, box.module.exports.getStreams);
    assert.equal((await box.getStreams('123', 'movie'))[0].title, 'MP4 · Server 1');
  });
}
