import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('providers/playimdb.js', 'utf8');
const url = 'https://cdn.example/video.mp4';
let response;
let requests = [];
const context = {
  module: { exports: {} }, Promise, setTimeout, clearTimeout,
  console: { log() {} },
  VUEO_DISCOVERY_CONTEXT: { tmdb: { id: 550, title: 'Fight Club', release_date: '1999-01-01' } },
  fetch: async (address, options) => {
    requests.push({ address, options });
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(response)) };
  },
};
vm.runInNewContext(source, context);
for (const type of ['movie', 'tv']) {
  for (const fields of [
    { stream_urls: [url] },
    { cast_urls: [url] },
    { stream_urls: [], cast_urls: [url] },
    { stream_urls: [url], cast_urls: ['https://cdn.example/other.mp4'] },
    { cast_urls: [null, 'javascript:bad', { url }, url, url] },
  ]) {
    response = { status_code: '200', data: { file_name: 'Title.1080p.mkv', ...fields },
      default_subs: [{ code: 'en', lang: 'English', url: 'https://subs.example/en.srt' }] };
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
console.log('PASS: legacy/cast response fields, movie/TV, duplicate and malformed URLs, failure replies, subtitles and headers');
