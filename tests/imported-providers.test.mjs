import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
const firstReport = JSON.parse(fs.readFileSync('docs/upstream-import.json'));
const secondReport = JSON.parse(fs.readFileSync('docs/yoruix-import.json'));
const report = { providers: [...firstReport.providers, ...secondReport.providers] };
const manifest = JSON.parse(fs.readFileSync('manifest.json'));
function load(filename, overrides = {}) {
  const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    require: name => {
      if (!['crypto-js','cheerio-without-node-native'].includes(name)) throw Error('Unsupported runtime module');
      return nodeRequire(name);
    }, Promise, URL, URLSearchParams, setTimeout, clearTimeout, Buffer, atob, btoa,
    fetch: () => Promise.reject(Error('Offline')), ...overrides };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  // Deliberately omit browser globals and Node process/TextEncoder/AbortController.
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { timeout: 2000 });
  return sandbox;
}
test('registered source IDs and independent variants are represented once', () => {
  assert.equal(new Set(manifest.scrapers.map(p => p.id)).size, manifest.scrapers.length);
  for (const p of manifest.scrapers.filter(p => p.sourceRepository)) assert.equal(report.providers.filter(s => s.id === p.id).length, 1);
});
for (const entry of report.providers.filter(p => p.action === 'imported' && manifest.scrapers.some(s => s.id === p.id))) {
  test(`${entry.id}: source integrity, portable module load, host input guards`, async () => {
    const source = fs.readFileSync(entry.filename);
    const begin = Buffer.from('/* CLOUDBANK_UPSTREAM_SOURCE_START */\n');
    const end = Buffer.from('\n/* CLOUDBANK_UPSTREAM_SOURCE_END */');
    const start = source.indexOf(begin) + begin.length;
    const finish = source.lastIndexOf(end);
    assert.ok(start >= begin.length && finish > start);
    assert.equal(crypto.createHash('sha256').update(source.subarray(start, finish)).digest('hex'), entry.patchedSourceSha256 || entry.sourceSha256);
    const box = load(entry.filename);
    assert.equal(typeof box.module.exports.getStreams, 'function');
    assert.equal(box.getStreams, box.module.exports.getStreams);
    assert.equal((await box.module.exports.getStreams('', 'movie')).length, 0);
    assert.equal((await box.module.exports.getStreams('123', 'unsupported')).length, 0);
    assert.equal((await box.module.exports.getStreams('123', 'tv', 1, 0)).length, 0);
  });
}
test('adapter preserves settings, forwards request, filters informational results and keeps different headers', async () => {
  const box = load('providers/vidlink.js');
  let received;
  const settings = () => 'settings';
  const stream = { url: 'https://cdn.invalid/movie.m3u8', name: 'Server', headers: { Referer: 'https://site.invalid' }, subtitles: [{ url: 'https://cdn.invalid/en.vtt', language: 'en' }] };
  const other = { ...stream, headers: { Referer: 'https://mirror.invalid' } };
  const provider = box.cloudbankWrapProvider({ onSettings: settings, getStreams(...args) {
    received = args;
    return Promise.resolve([stream, stream, other, { title: 'Configure token' }, { url: 'javascript:alert(1)' }]);
  } }, 'test', ['movie', 'tv']);
  const result = await provider.getStreams(123, 'series', '2', '3', { choice: 1 });
  assert.equal(provider.onSettings, settings);
  assert.deepEqual(received, ['123', 'tv', 2, 3, { choice: 1 }]);
  assert.equal(result.length, 2);
  assert.equal(result[0], stream);
  assert.equal(result[1], other);
  assert.equal((await box.cloudbankWrapProvider({ getStreams() { throw Error('Site down'); } }, 'test', ['movie']).getStreams('123','movie')).length, 0);
});
test('async timeout returns safely and ignores a late completion', async () => {
  let expire, cleared = false, finish;
  const box = load('providers/vidlink.js', {
    setTimeout(fn, delay) { assert.equal(delay, 19000); expire = fn; return 1; },
    clearTimeout() { cleared = true; }
  });
  const provider = box.cloudbankWrapProvider({ getStreams: () => new Promise(resolve => { finish = resolve; }) }, 'test', ['movie']);
  const pending = provider.getStreams('123', 'movie');
  await Promise.resolve();
  expire();
  assert.equal((await pending).length, 0);
  assert.equal(cleared, true);
  finish([{ url: 'https://cdn.invalid/late.mp4' }]);
  await Promise.resolve();
  assert.equal((await pending).length, 0);
});
test('metadata adapter uses shared details, clones response and forwards episode/search/header requests', async () => {
  const box = load('providers/vidlink.js');
  const details = { id: 123, title: 'Title', original_title: 'Original', alternative_titles: { titles: [{ title: 'Alias' }] } };
  box.VUEO_DISCOVERY_CONTEXT = { tmdb: details };
  let calls = [];
  const originalResponse = { ok: true, headers: { get: () => 'native' }, json: () => Promise.resolve(details) };
  const fetch = box.cloudbankMetadataFetch((...args) => { calls.push(args); return Promise.resolve(originalResponse); });
  const response = await fetch('https://api.themoviedb.org/3/movie/123?api_key=test');
  const first = await response.json(); first.title = 'changed';
  assert.equal((await response.json()).title, 'Title');
  assert.equal(JSON.parse(await response.text()).id, 123);
  assert.equal(calls.length, 0);
  assert.equal(response.headers.get('content-type'), 'application/json');
  for (const url of ['https://api.themoviedb.org/3/tv/123/season/1/episode/2?api_key=test', 'https://api.themoviedb.org/3/search/movie?query=Title', 'https://site.invalid/api/movie/123']) {
    const options = { headers: { Referer: 'https://source.invalid' } };
    assert.equal(await fetch(url, options), originalResponse);
    assert.equal(calls.at(-1)[1], options);
  }
  delete box.VUEO_DISCOVERY_CONTEXT;
  const before = calls.length;
  assert.equal((await (await fetch('https://api.themoviedb.org/3/movie/123?api_key=test')).json()).title, 'Title');
  assert.equal(calls.length, before + 1);
});

test('Yoruix flags and variant numbering remain independent', () => {
  const get = id => manifest.scrapers.find(p => p.id === id);
  assert.equal(get('videasy-v2').enabled, false);
  assert.equal(get('videasy').enabled, true);
  assert.deepEqual(get('netmirror-v2').disabledPlatforms, ['ios']);
  assert.equal(get('netmirror-v2').supportsExternalPlayer, false);
  for (const base of ['4khdhub','hdhub4u','moviebox']) {
    for (const id of [base, `${base}-v2`, `${base}-v3`]) assert.ok(get(id));
    assert.equal(get(`${base}-v3`).sourceRepository, secondReport.repository);
  }
  for (const record of secondReport.providers.filter(p => get(p.id))) assert.equal(get(record.id).enabled, record.enabled);
});

test('StreamFlix real resolver preserves movie output and TV fallback without Node ws', async () => {
  const box = load('providers/streamflix.js', { fetch: async url => {
    let data;
    if (url.endsWith('/data.json')) data = { data: [{ moviename: 'Example Series', moviekey: 'example', movielink: 'film.mkv', movieduration: '2 Seasons' }] };
    else if (url.includes('config-streamflixapp.json')) data = { premium: ['https://cdn.invalid/'], movies: ['https://standard.invalid/'] };
    else throw new Error(`Unexpected request: ${url}`);
    return { ok: true, status: 200, json: async () => data };
  }});
  box.VUEO_DISCOVERY_CONTEXT = { tmdb: { id: 123, name: 'Example Series', first_air_date: '2024-01-01' } };
  const tv = await box.module.exports.getStreams('123', 'tv', 2, 3);
  assert.equal(tv.length, 1);
  assert.equal(tv[0].url, 'https://cdn.invalid/tv/example/s2/episode3.mkv');
  assert.equal(tv[0].headers.Referer, 'https://api.streamflix.app');
  box.VUEO_DISCOVERY_CONTEXT = { tmdb: { id: 123, title: 'Example Series', release_date: '2024-01-01' } };
  const movie = await box.module.exports.getStreams('123', 'movie');
  assert.equal(movie.length, 2);
  assert.equal(movie[0].url, 'https://cdn.invalid/film.mkv');
  assert.equal(movie[1].url, 'https://standard.invalid/film.mkv');
});
