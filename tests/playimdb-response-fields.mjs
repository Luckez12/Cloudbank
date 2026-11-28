import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('providers/playimdb.js', 'utf8');
const direct = 'https://cdn.example/video.mp4';
const cast = 'https://cdn.example/cast.mp4';
const movie = { id: 1263337, title: 'Heart of the Beast', external_ids: { imdb_id: 'tt7526136' } };
const series = { id: 247718, name: 'MobLand', external_ids: { imdb_id: 'tt31510819' } };
const movieEmbed = 'https://player.imdb.su/embed/movie/tt7526136';
let apiData;
let metadataStalls = false;
let metadataTimeout;
let requests = [];
let webViewCalls = 0;
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
  VUEO_DISCOVERY_CONTEXT: { tmdb: movie },
  webviewResolve: async () => { webViewCalls++; },
  fetch: async address => {
    requests.push(address);
    const tmdb = address.includes('api.themoviedb.org');
    if (tmdb && metadataStalls) return new Promise(() => {});
    const data = tmdb ? (address.includes('/episode/') ? { runtime: 45 } : movie) : apiData;
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
  },
};
vm.runInNewContext(source, context);
const getStreams = context.module.exports.getStreams;
const urls = streams => Array.from(streams, stream => stream.url);

for (const [fields, expected] of [
  [{ stream_urls: [direct, direct, null, 'https://', 'javascript:bad'], cast_urls: [cast] }, [direct, movieEmbed]],
  [{ cast_urls: [{ url: cast }] }, [movieEmbed]],
  [{ stream_urls: [cast, direct], cast_urls: [cast] }, [direct, movieEmbed]],
  [{ stream_urls: [cast], cast_urls: [cast] }, [movieEmbed]],
  [{}, [movieEmbed]],
]) {
  apiData = {
    status_code: '200',
    data: { file_name: 'Title.1080p.mkv', ...fields },
    default_subs: [null, { code: 'en', lang: 'English', url: 'https://subs.example/en.srt' }],
  };
  const streams = await getStreams(movie.id, 'movie');
  assert.deepEqual(urls(streams), expected);
  const embed = streams.at(-1);
  assert.equal(embed.type, 'web_embed');
  assert.equal(embed.name, 'PlayIMDb · Web Player');
  assert.equal(embed.headers, undefined);
  if (expected[0] === direct) {
    assert.equal(streams[0].type, 'direct');
    assert.equal(streams[0].subtitles[0].url, 'https://subs.example/en.srt');
    assert.equal(streams[0].headers.Referer, 'https://nextgencloudfabric.com/');
  }
}
assert.equal(webViewCalls, 0);

apiData = { status_code: 404, data: { cast_urls: [cast] } };
assert.deepEqual(urls(await getStreams(movie.id, 'movie')), [movieEmbed]);
context.VUEO_DISCOVERY_CONTEXT = { tmdb: { ...movie, id: 1 } };
assert.deepEqual(urls(await getStreams(movie.id, 'movie')), []);

context.VUEO_DISCOVERY_CONTEXT = { tmdb: series };
requests = [];
const episode = await getStreams(series.id, 'series', 2, 3);
assert.deepEqual(urls(episode), ['https://imdb.su/embed/tv/tt31510819/2/3']);
assert.ok(requests.some(address => address.includes('&type=tv&season=2&episode=3')));
assert.deepEqual(urls(await getStreams(series.id, 'tv', 0, 2)), ['https://imdb.su/embed/tv/tt31510819/0/2']);
requests = [];
assert.deepEqual(urls(await getStreams(series.id, 'tv', null, 2)), []);
assert.equal(requests.length, 0);

delete context.VUEO_DISCOVERY_CONTEXT;
assert.deepEqual(urls(await getStreams(movie.id, 'movie')), [movieEmbed]);
assert.ok(requests.some(address => address.includes('append_to_response=external_ids')));

apiData = { status_code: 200, data: { stream_urls: [direct] } };
metadataStalls = true;
const pending = getStreams(movie.id, 'movie');
await new Promise(resolve => setImmediate(resolve));
assert.equal(typeof metadataTimeout, 'function');
metadataTimeout();
assert.deepEqual(urls(await pending), [direct]);

console.log('PASS: PlayIMDb movie and TV embeds, IMDb validation, direct links, cast removal, subtitles, and metadata fallback');
