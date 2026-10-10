import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
const report = JSON.parse(fs.readFileSync('docs/upstream-import.json'));
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
test('all 66 upstream IDs are represented once; 70 combined providers', () => {
  assert.equal(manifest.scrapers.length, 70);
  assert.equal(new Set(manifest.scrapers.map(p => p.id)).size, 70);
  for (const p of report.providers) assert.equal(manifest.scrapers.filter(s => s.id === p.id).length, 1);
});
for (const entry of report.providers.filter(p => p.action === 'imported')) {
  test(`${entry.id}: source integrity, portable module load, host input guards`, async () => {
    const source = fs.readFileSync(entry.filename);
    const begin = Buffer.from('/* CLOUDBANK_UPSTREAM_SOURCE_START */\n');
    const end = Buffer.from('\n/* CLOUDBANK_UPSTREAM_SOURCE_END */');
    const start = source.indexOf(begin) + begin.length;
    const finish = source.lastIndexOf(end);
    assert.ok(start >= begin.length && finish > start);
    assert.equal(crypto.createHash('sha256').update(source.subarray(start, finish)).digest('hex'), entry.sourceSha256);
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
