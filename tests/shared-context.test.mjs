import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);

const files = fs.readdirSync('providers').filter(name => name.endsWith('.js'));
for (const file of files) {
  test(`${file}: shared metadata bridge and local fallback`, async () => {
    const sandbox = { module: { exports: {} }, require: name => {
      if (!['crypto-js', 'cheerio-without-node-native'].includes(name)) throw new Error(`Unsupported runtime module: ${name}`);
      return nodeRequire(name);
    },
      console: { log() {}, error() {} }, Promise, URL, URLSearchParams,
      setTimeout, clearTimeout, Buffer, atob, btoa, fetch: () => { throw new Error("Network disabled in offline tests"); } };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(`providers/${file}`, 'utf8'), sandbox);
    assert.equal(typeof sandbox.module.exports.getStreams, 'function');
    const tmdb = { id: 123, title: 'Example', release_date: '2024-01-01' };
    let calls = 0;
    const fallback = () => { calls++; return Promise.resolve(tmdb); };
    const invoke = () => sandbox.vueoSharedTmdb('https://metadata.invalid', fallback);
    sandbox.VUEO_DISCOVERY_CONTEXT = { tmdb };
    assert.equal(await invoke(), tmdb);
    assert.equal(calls, 0);
    sandbox.VUEO_DISCOVERY_CONTEXT = JSON.stringify({ mediaType: 'tv', tmdbId: 123,
      title: 'Example', year: 2024, aliases: ['Alternate'], imdbId: 'tt123' });
    let result = await invoke();
    assert.equal(result.name, 'Example');
    assert.equal(result.alternative_titles.results[0].title, 'Alternate');
    assert.equal(result.external_ids.imdb_id, 'tt123');
    delete sandbox.VUEO_DISCOVERY_CONTEXT;
    for (const value of [{ tmdb }, JSON.stringify({ tmdb }), Promise.resolve({ tmdb })]) {
      sandbox.vueoDiscoveryContext = () => value;
      assert.equal((await invoke()).title, 'Example');
    }
    sandbox.vueoTrace = () => { throw new Error('Trace unavailable'); };
    sandbox.vueoDiscoveryContext = () => ({ tmdb });
    assert.equal(await invoke(), tmdb);
    for (const bridge of [() => { throw new Error('Bridge failure'); },
      () => Promise.reject(new Error('Async failure')), () => '{}', () => ({ error: 'no metadata' })]) {
      const previous = calls;
      sandbox.vueoDiscoveryContext = bridge;
      assert.equal(await invoke(), tmdb);
      assert.equal(calls, previous + 1);
    }
    delete sandbox.vueoDiscoveryContext;
    assert.equal(await invoke(), tmdb);
    await assert.rejects(sandbox.vueoSharedTmdb('unused', () => { throw new Error('Local failure'); }), /Local failure/);
  });
}
