const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('providers/vidsrc.js', 'utf8');
function load(streams, finishReason = 'response-media') {
  const calls = [];
  const context = {
    module: { exports: {} }, URL, console: { log() {} }, setTimeout, clearTimeout,
    fetch() { throw Error('Separate HTTP requests are forbidden in this flow'); },
    VUEO_DISCOVERY_CONTEXT: { tmdbId: '12345', mediaType: 'movie', tmdb: { id: 12345, title: 'Fixture', original_language: 'en' } },
    webviewResolve: async (url, options) => {
      calls.push({url, options});
      return {streams, finishReason, diagnostics: {pageFinished: true}};
    }
  };
  vm.runInNewContext(source, context, {timeout: 1000});
  return {provider: context.module.exports, calls};
}
(async () => {
  const master = 'https://media.example/master.m3u8?token=fixture';
  const {provider, calls} = load([
    {url: 'https://player.example/watch/12345', networkObserved: true},
    {url: 'blob:https://player.example/fixture', networkObserved: true},
    {url: master, networkObserved: true, headers: {Referer: 'https://player.example/', Range: 'bytes=0-100', Origin: 'https://player.example'}},
    {url: master, responseObserved: true},
    {url: 'https://media.example/unobserved.mp4'}
  ]);
  let rows = await provider.getStreams('12345', 'movie');
  assert.equal(calls[0].url, 'https://vidsrc.sh/embed/movie/12345');
  assert.equal(calls[0].options.waitForMediaReady, false);
  assert.equal(calls[0].options.blockMatchedRequests, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, master);
  assert.equal(rows[0].quality, 'Auto');
  assert.equal(rows[0].mimeType, 'application/x-mpegURL');
  assert.equal(rows[0].headers.Referer, 'https://player.example/');
  assert.equal(rows[0].headers.Range, undefined);
  assert.equal(rows[0].isAdaptive, true);
  await provider.getStreams('56789', 'series', 2, 7);
  assert.equal(calls[1].url, 'https://vidsrc.sh/embed/tv/56789/2/7');
  assert.equal((await provider.getStreams('56789', 'tv', null, 7)).length, 0);
  assert.equal((await provider.getStreams('bad/id', 'movie')).length, 0);
  assert.equal(calls.length, 2);
  const audio = load([
    {url: 'https://media.example/unknown.mp4', networkObserved: true},
    {url: 'https://media.example/dub.mp4', networkObserved: true, isDubbed: true, audioLanguage: 'hi'},
    {url: 'https://media.example/dual.mp4', networkObserved: true, isDubbed: true, isDualAudio: true}
  ]);
  rows = await audio.provider.getStreams('12345', 'movie');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => !row.url.includes('/dub.mp4')));
  const blocked = load([], 'timeout');
  assert.equal((await blocked.provider.getStreams('12345', 'movie')).length, 0);
  console.log('VidSrc: exact movie/episode route, original master handoff, observed-only media, audio handling and empty session checks passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
