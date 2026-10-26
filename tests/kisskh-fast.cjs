const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const C = require('crypto-js');
const source = fs.readFileSync(path.join(__dirname, '../providers/kisskh.js'), 'utf8');
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => String(data) };
}
function make(handler, context = { tmdbId: '218539', mediaType: 'tv', title: 'My Demon', year: '2023' }) {
  const calls = [], logs = [];
  const sandbox = { module: { exports: {} }, URL, URLSearchParams, Promise, setTimeout, clearTimeout, AbortController,
    console: { log: (...v) => logs.push(v.join(' ')), error: (...v) => logs.push(v.join(' ')) },
    require: name => { assert.equal(name, 'crypto-js'); return C; }, VUEO_DISCOVERY_CONTEXT: context,
    fetch: async (url, options) => { calls.push({ url, options }); return handler(String(url), options, calls); } };
  sandbox.global = sandbox;
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return { sandbox, calls, logs, run: (...args) => sandbox.module.exports.getStreams(...(args.length ? args : ['218539', 'tv', 1, 1])) };
}
const drama = (title = 'My Demon', id = 8268, year = '2023', episodes = [{ id: 139842, number: 1 }]) =>
  ({ id, title, type: 'TVSeries', releaseDate: year + '-10-24', status: 'Completed', episodes });
function ordinary(url) {
  if (url.includes('/Search?')) return response([{ id: 8268, title: 'My Demon' }]);
  if (url.includes('/Drama/')) return response(drama());
  if (url.includes('/Episode/')) return response({ Video: 'https://cdn.example/1080p/video.m3u8', ThirdParty: 'https://cdn.example/watch.html' });
  if (url.includes('/api/Sub/')) return response([{ src: 'https://sub.example/en.srt', label: 'English' }, { src: 'https://sub.example/fr.vtt', label: 'French' }]);
  throw Error('Unexpected request ' + url);
}
async function tests() {
  const a = make(ordinary);
  let result = await a.run();
  check(result.length === 1 && result[0].quality === 'Auto', 'URL path numbers are not treated as observed resolution');
  check(a.calls.length === 4 && !a.calls.some(c => c.url.includes('themoviedb')), 'cold path four requests using shared metadata');
  check(result[0].headers.Referer === 'https://kisskh.id/' && result[0].headers.Origin === 'https://kisskh.id', 'correct playback origin');
  check(result[0].subtitles.length === 1 && result[0].subtitles[0].language === 'en' && result[0].subtitles[0].mimeType === 'application/x-subrip', 'French filtered; English normalized with standard MIME');
  check(a.logs.some(l => /HTTP:/.test(l) && /"status":200/.test(l)), 'HTTP log distinguishes response status from elapsed milliseconds');
  const filtered = make(url => url.includes('/api/Sub/') ? response([
    {src:'https://sub.example/hi.txt',label:'Hindi'},
    {src:'https://sub.example/ms.vtt',lang:'ms-MY',label:'Malay'},
    {src:'https://sub.example/en.srt',lang:'und',label:'English'},
    {src:'https://sub.example/ar.txt',label:'Arabic'},
    {src:'https://sub.example/unknown.txt',label:'Unknown'},
    {src:'https://sub.example/ms.vtt',label:'Malay'},
    {src:'https://sub.example/id.txt',lang:'id',label:'Malay'},
    {src:'https://sub.example/mixed.txt',lang:'ms-ind',label:'Unknown'}
  ]) : ordinary(url));
  const filteredRows = await filtered.run();
  check(filteredRows[0].subtitles.length === 2, 'only distinct English and Malay sidecars forwarded');
  check(filteredRows[0].subtitles.every(s => ['en','ms'].includes(s.language)), 'canonical language fields only');
  check(filteredRows[0].subtitles.find(s => s.language === 'ms').mimeType === 'text/vtt', 'Malay VTT uses standard MIME');
  check(filtered.calls.length === 4, 'rejected TXT languages never downloaded or decrypted');
  const before = a.calls.length; await a.run();
  check(a.calls.length - before === 2, 'warm path skips search/detail, reacquires video and subtitles');
  check(!a.calls.some(c => /script.google|enc-dec|\.is\//.test(c.url)), 'no remote token service or obsolete first engine');
  // Tokens remain exactly equivalent to the bundled per-episode implementation.
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/kisskh-token-vectors.json')));
  for (const row of golden) {
    check(vm.runInContext(`episodeKey('${row.id}', false)`, a.sandbox) === row.video, 'video token vector ' + row.id);
    check(vm.runInContext(`episodeKey('${row.id}', true)`, a.sandbox) === row.sub, 'subtitle token vector ' + row.id);
  }
  check(vm.runInContext("episodeKey('1', false) !== episodeKey('2', false) && episodeKey('1', false) !== episodeKey('1', true)", a.sandbox), 'episode and purpose-specific tokens');

  const s2 = make(url => {
    if (url.includes('/Search?')) return response([{ id: 8268, title: 'My Demon' }, { id: 99, title: 'My Demon - Season 2' }]);
    if (url.includes('/Drama/99?')) return response(drama('My Demon - Season 2', 99, '2025', [{ id: 9001, number: 1 }]));
    if (url.includes('/Episode/9001.')) return response({ Video: 'https://cdn.example/s2e1.mp4' });
    if (url.includes('/api/Sub/9001')) return response([]);
    throw Error('Wrong season route ' + url);
  });
  result = await s2.run('218539', 'tv', 2, 1);
  check(result.length === 1 && result[0].url.includes('s2e1'), 'explicit season 2 uses its own year and episode ID');
  check(!s2.calls.some(c => c.url.includes('/Drama/8268?')), 'never substitutes season 1 for season 2');
  const noS2 = make(url => url.includes('/Search?') ? response([{ id: 8268, title: 'My Demon' }]) : ordinary(url));
  check((await noS2.run('218539', 'tv', 2, 1)).length === 0, 'missing explicit season returns no source');
  check(noS2.calls.length === 1, 'negative search does not fan out to other hosts');

  const remakes = make(url => url.includes('/Drama/') ? response(drama('My Demon', 8268, '2024')) : ordinary(url));
  check((await remakes.run()).length === 0 && !remakes.calls.some(c => c.url.includes('/Episode/')), 'unique wrong-year remake is rejected');
  const ambiguous = make(url => {
    if (url.includes('/Search?')) return response([{ id: 8268, title: 'My Demon' }, { id: 9, title: 'My Demon' }]);
    if (url.includes('/Drama/')) return response(drama('My Demon', url.includes('/Drama/9?') ? 9 : 8268));
    return ordinary(url);
  });
  check((await ambiguous.run()).length === 0, 'duplicate exact title/year must remain ambiguous');
  const fractional = make(url => url.includes('/Drama/') ? response(drama('My Demon', 8268, '2023', [{ id: 5, number: 1.5 }])) : ordinary(url));
  check((await fractional.run()).length === 0, 'special fractional episode is not rounded to E1');

  const alias = make(url => {
    if (url.includes('/Search?')) return response(new URL(url).searchParams.get('q') === 'My Demon' ? [] : [{ id: 8268, title: 'My Demon' }]);
    return ordinary(url);
  }, { tmdbId: '218539', mediaType: 'tv', title: 'My Demon', originalTitle: '마이 데몬', year: '2023' });
  check((await alias.run()).length === 1 && alias.calls.filter(c => c.url.includes('/Search?')).length === 2, 'alias queried only after primary title misses');
  const unrelated = make(url => url.includes('/Search?') ? response([{ id: 1, title: 'My Demon Hunters' }]) : ordinary(url));
  check((await unrelated.run()).length === 0 && unrelated.calls.length === 1, 'substring title cannot match');
  const host = make(url => url.startsWith('https://kisskh.id') ? response({}, 503) : ordinary(url));
  result = await host.run();
  check(result.length === 1 && result[0].headers.Origin === 'https://kisskh.do', 'fallback host and headers are consistent');
  const hostBefore = host.calls.length; await host.run();
  check(!host.calls.slice(hostBefore).some(c => c.url.startsWith('https://kisskh.id')), 'working host is reused');

  const stale = make(url => url.includes('api.themoviedb.org') ? response({ id: 218539, name: 'My Demon', first_air_date: '2023-01-01' }) : ordinary(url),
    { tmdbId: '1', mediaType: 'tv', title: 'Wrong title', year: '2000' });
  const staleResult = await stale.run(); check(staleResult.length === 1 && stale.calls.some(c => c.url.includes('api.themoviedb.org')), 'stale metadata ID triggers real metadata lookup');
  const mismatch = make(url => url.includes('/Drama/') ? response(drama('My Demon', 999)) : ordinary(url));
  check((await mismatch.run()).length === 0, 'detail ID mismatch rejected');

  const parallel = make(async (url) => {
    if (url.includes('/Episode/')) {
      await new Promise(r => setTimeout(r, 5));
      check(parallel.calls.some(c => c.url.includes('/api/Sub/')), 'subtitle request starts while video is in flight');
    }
    return ordinary(url);
  });
  await parallel.run();
  const brokenSub = make(url => url.includes('/api/Sub/') ? response({}, 503) : ordinary(url));
  result = await brokenSub.run();
  check(result.length === 1 && result[0].subtitles.length === 0, 'subtitle failure does not discard video');
  function encrypted(plain, key, iv) {
    return C.AES.encrypt(plain, C.enc.Utf8.parse(key), { iv: C.enc.Hex.parse(iv), mode: C.mode.CBC, padding: C.pad.Pkcs7 }).ciphertext.toString(C.enc.Base64);
  }
  const line = encrypted('Hello subtitle', 'AmSmZVcH93UQUezi', '5265424b5757386371646a50456e4636');
  const encryptedSubs = make(url => {
    if (url.includes('/api/Sub/')) return response([{ src: 'https://sub.example/eng.txt', label: 'English' }]);
    if (url.includes('sub.example/eng.txt')) return response('1\n00:00:01,000 --> 00:00:03,000\n' + line + '\n\n');
    return ordinary(url);
  });
  result = await encryptedSubs.run();
  check(result[0].subtitles[0].url === 'https://sub.example/eng.txt' && result[0].subtitles[0].textTransform.algorithm === 'aes-cbc', 'encrypted TXT remains HTTP URL with playback transform');
  check(!encryptedSubs.calls.some(c => c.url.includes('sub.example')), 'subtitle content not fetched during scan');
  check(result[0].subtitles[0].mimeType === 'application/x-subrip', 'TXT declares SRT MIME');
  const plainSubs = make(url => {
    if (url.includes('/api/Sub/')) return response([{ src: 'https://sub.example/plain.txt', label: 'Malay' }]);
    if (url.includes('sub.example/plain.txt')) return response('1\n00:00:01,000 --> 00:00:03,000\nHello world\n');
    return ordinary(url);
  });
  result = await plainSubs.run();
  check(result[0].subtitles[0].url === 'https://sub.example/plain.txt', 'plain TXT remains URL for playback transform');
  const corrupt = make(url => {
    if (url.includes('/api/Sub/')) return response([{ src: 'https://sub.example/broken.txt', label: 'English' }]);
    if (url.includes('sub.example/broken.txt')) return response('1\n00:00:01,000 --> 00:00:03,000\nAAAAAAAAAAAAAAAAAAAAAA==\n');
    return ordinary(url);
  });
  result = await corrupt.run();
  check(result.length === 1 && result[0].subtitles.length === 1 && result[0].subtitles[0].textTransform.algorithm === 'aes-cbc', 'cipher validation deferred to playback instead of scan');

  const keyRetry = make(url => {
    if (url.includes('/Episode/')) return new URL(url).searchParams.get('kkey') === 'captured-video-key' ? ordinary(url) : response({}, 403);
    return ordinary(url);
  });
  let browserCalls = 0;
  keyRetry.sandbox.webviewResolve = async () => { browserCalls++; return { streams: [{ url: 'https://kisskh.id/api/DramaList/Episode/139842.png?kkey=captured-video-key' }] }; };
  check((await keyRetry.run()).length === 1 && browserCalls === 1, 'rejected token retries once using matching episode capture');
  const wrongKey = make(url => url.includes('/Episode/') ? response({}, 403) : ordinary(url));
  wrongKey.sandbox.webviewResolve = async () => ({ streams: [{ url: 'https://kisskh.id/api/DramaList/Episode/999.png?kkey=wrong' }] });
  check((await wrongKey.run()).length === 0, 'captured token from another episode is rejected');

  const subAuth = make(url => url.includes('/api/Sub/') && new URL(url).searchParams.get('kkey') !== 'captured-sub-key' ? response({}, 403) : ordinary(url));
  subAuth.sandbox.webviewResolve = async () => ({ streams: [{ url: 'https://kisskh.id/api/Sub/139842?kkey=captured-sub-key' }] });
  check((await subAuth.run())[0].subtitles.length === 1, 'subtitle-only authentication failure can refresh its own token');
  let cancelled = false;
  const timeout = make((url, options) => {
    if (url.includes('/api/Sub/')) {
      options.signal.addEventListener('abort', () => { cancelled = true; });
      return new Promise(() => {});
    }
    return ordinary(url);
  });
  timeout.sandbox.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 15));
  check((await timeout.run()).length === 1 && cancelled, 'hung subtitle request is aborted and video still returns');
  const timeoutHost = make(url => url.startsWith('https://kisskh.id') ? new Promise(() => {}) : ordinary(url));
  timeoutHost.sandbox.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 15));
  check((await timeoutHost.run()).length === 1, 'hung primary search is bounded and falls back');
  let episodeSet = [{ id: 139842, number: 1 }];
  const ongoing = make(url => {
    if (url.includes('/Drama/')) return response(drama('My Demon', 8268, '2023', episodeSet));
    if (url.includes('/Episode/')) return response({ Video: 'https://cdn.example/episode.mp4' });
    return ordinary(url);
  });
  await ongoing.run(); episodeSet = [{ id: 139842, number: 1 }, { id: 139843, number: 2 }];
  const prior = ongoing.calls.length; result = await ongoing.run('218539', 'tv', 1, 2);
  check(result.length === 1 && ongoing.calls.slice(prior).some(c => c.url.includes('/Drama/')) && !ongoing.calls.slice(prior).some(c => c.url.includes('/Search?')), 'new episode refreshes detail without repeating search');

  const concurrent = make(async url => {
    if (url.includes('/Search?')) return response([{ id: 8268, title: 'My Demon' }]);
    if (url.includes('/Drama/')) return response(drama('My Demon', 8268, '2023', [{id:139842,number:1},{id:139843,number:2}]));
    if (url.includes('/Episode/')) { await new Promise(r => setTimeout(r, 1)); return response({Video: 'https://cdn.example/' + (url.includes('139842')?'ep1':'ep2')+'.mp4'}); }
    return ordinary(url);
  });
  const together = await Promise.all([concurrent.run('218539','tv',1,1),concurrent.run('218539','tv',1,2)]);
  check(together[0][0].url.includes('ep1') && together[1][0].url.includes('ep2'), 'concurrent episodes do not overwrite selected IDs');

  vm.runInContext(`var store = cacheStore(); for (var i=0;i<505;i++) cacheWrite(store.matches, 'x'+i, {id:String(i)}, 500);`, a.sandbox);
  check(vm.runInContext('Object.keys(cacheStore().matches).length', a.sandbox) === 500, 'mapping cache bounded at 500');
  vm.runInContext(`cacheStore().matches.x504.at = Date.now() - MATCH_TTL - 1;`, a.sandbox);
  check(vm.runInContext(`cacheRead(cacheStore().matches, 'x504', MATCH_TTL)`, a.sandbox) === null, 'expired mapping removed');
  vm.runInContext(`for (var i=0;i<40;i++) cacheWrite(cacheStore().details,'d'+i,{value:{}},32);`, a.sandbox);
  check(vm.runInContext('Object.keys(cacheStore().details).length', a.sandbox) === 32, 'episode cache bounded at 32');
  check((await a.run('218539', 'tv', 0, 1)).length === 0 && (await a.run('bad', 'movie')).length === 0, 'invalid request rejected');
  console.log('KissKH regression checks passed:', checks);
}
tests().catch(error => { console.error(error); process.exitCode = 1; });
