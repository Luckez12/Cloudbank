import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('providers/playimdb.js', 'utf8');
const url = 'https://cdn.example/video.mp4';
let response;
let requests = [];
let metadataTimeout;
let metadataStalls = false;
const context = {
  module: { exports: {} }, Promise, clearTimeout,
  setTimeout(callback, ms) {
    if (ms === 2500 && metadataStalls) {
      metadataTimeout = callback;
      return undefined;
    }
    return setTimeout(callback, ms);
  },
  console: { log() {} },
  VUEO_DISCOVERY_CONTEXT: { tmdb: { id: 550, title: 'Fight Club', release_date: '1999-01-01' } },
  fetch: async (address, options) => {
    requests.push({ address, options });
    if (metadataStalls && address.includes('api.themoviedb.org')) return new Promise(() => {});
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(response)) };
  },
};
vm.runInNewContext(source, context);
for (const type of ['movie', 'tv']) {
  for (const fields of [
    { stream_urls: [url] },
    { cast_urls: [url] },
    { stream_urls: [], cast_urls: [url] },
    { stream_urls: [null, 'https://', 'javascript:bad'], cast_urls: [{ url }] },
    { stream_urls: [url], cast_urls: ['https://cdn.example/other.mp4'] },
    { cast_urls: [null, 'javascript:bad', { url }, url, url] },
  ]) {
    response = { status_code: '200', data: { file_name: 'Title.1080p.mkv', ...fields },
      default_subs: [null, { code: 'en', lang: 'English', url: 'https://subs.example/en.srt' }] };
    requests = [];
    const streams = await context.getStreams(550, type, 1, 1);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, url);
    assert.equal(streams[0].subtitles[0].url, 'https://subs.example/en.srt');
    assert.equal(streams[0].headers.Referer, 'https://nextgencloudfabric.com/');
    assert.ok(requests.some(r => r.address.includes('?tmdb=550&type=' + type)));
  }
}
for (const bad of [{ status_code: 404, data: { cast_urls: [url] } },
  { status_code: 200, data: {} }, { status_code: 200, data: { cast_urls: 'bad' } }]) {
  response = bad;
  assert.equal((await context.getStreams(550, 'movie')).length, 0);
}
response = { status_code: 200, data: { cast_urls: [url] } };
requests = [];
const special = await context.module.exports.getStreams(550, 'series', 0, 2);
assert.equal(special[0].url, url);
assert.ok(requests.some(r => r.address.includes('&type=tv&season=0&episode=2')));
requests = [];
assert.equal((await context.getStreams(550, 'tv', null, 2)).length, 0);
assert.equal(requests.length, 0);

delete context.VUEO_DISCOVERY_CONTEXT;
metadataStalls = true;
const movie = context.getStreams(550, 'movie');
await new Promise(resolve => setImmediate(resolve));
assert.ok(requests.some(r => r.address.includes('?tmdb=550&type=movie')));
assert.ok(requests.some(r => r.address.includes('api.themoviedb.org')));
assert.equal(typeof metadataTimeout, 'function');
metadataTimeout();
assert.equal((await movie)[0].url, url);

metadataStalls = false;
context.VUEO_DISCOVERY_CONTEXT = { tmdb: { id: 1263337, title: 'Heart of the Beast' } };
const webUrl = 'https://cdn.example/website.m3u8';
let webCalls = 0;
let webSignal = 'none';
let webCandidate = { url: webUrl, mediaReady: true, responseObserved: true };
context.webviewResolve = async (embed, options) => {
  webCalls++;
  assert.equal(embed, 'https://player.imdb.su/embed/movie/tt7526136');
  assert.equal(options.directLoad, true);
  assert.ok(options.clickDelaysMs.every(delay => delay >= options.timeoutMs));
  return { mediaReady: true, streams: [webCandidate], diagnostics: { video: { pageSignal: webSignal } } };
};
assert.equal((await context.getStreams(550, 'movie')).length, 1);
assert.equal(webCalls, 0);
let trial = await context.getStreams(1263337, 'movie');
assert.deepEqual(Array.from(trial, stream => stream.url), [webUrl, url]);
assert.equal(trial[0].headers, undefined);
webSignal = 'human_verification';
assert.deepEqual(Array.from(await context.getStreams(1263337, 'movie'), stream => stream.url), [url]);
webSignal = 'none';
for (const candidate of [
  { headers: { Cookie: 'session=example' } },
  { url: webUrl + '?token=example' },
  { responseObserved: false },
  { url },
]) {
  webCandidate = { url: webUrl, mediaReady: true, responseObserved: true, ...candidate };
  assert.deepEqual(Array.from(await context.getStreams(1263337, 'movie'), stream => stream.url), [url]);
}
context.webviewResolve = async () => { throw new Error('resolver unavailable'); };
assert.deepEqual(Array.from(await context.getStreams(1263337, 'movie'), stream => stream.url), [url]);

console.log('PASS: PlayIMDb API responses, episode zero, slow metadata, audio-independent playback handoff, and passive WebView trial');
