import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const manifest = JSON.parse(fs.readFileSync('manifest.json'));
test('all providers use their original display without an active formatter', () => {
  for (const scraper of manifest.scrapers) {
    const source = fs.readFileSync(scraper.filename, 'utf8');
    assert.ok(!source.includes('CLOUDBANK_STREAM_DISPLAY_START'), scraper.id);
    assert.ok(!source.includes('module.exports = cloudbankDisplayInstall('), scraper.id);
  }
});
test('retired helper leaves provider results, arguments and settings unchanged', async () => {
  const box = {};
  vm.createContext(box);
  vm.runInContext(fs.readFileSync('scripts/stream-display.js', 'utf8'), box);
  const streams = [{ name: 'Original Provider', title: 'Original title • original details', url: 'https://cdn.invalid/a.m3u8' }];
  let received;
  const original = { getStreams(...args) { received = args; return Promise.resolve(streams); }, onSettings() {} };
  const restored = box.cloudbankDisplayInstall(original);
  assert.equal(restored, original);
  assert.equal(await restored.getStreams('123', 'tv', 1, 2), streams);
  assert.deepEqual(received, ['123', 'tv', 1, 2]);
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
