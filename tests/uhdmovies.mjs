import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const source = fs.readFileSync('providers/uhdmovies.js', 'utf8');
const calls = [], logs = [];
let mode = 'good';
const search = `<article class="gridlove-post"><h1 class="sanket">Download Vikings: Valhalla (2022) Dual Audio</h1><div class="entry-image"><a href="https://uhdmovies.my/wrong">wrong</a></div></article>
<article class="gridlove-post"><h1 class="sanket">Download Vikings S01-S06 (2013-2020) Dual Audio</h1><div class="entry-image"><a href="https://uhdmovies.my/vikings">right</a></div></article>`;
const page = `<h1>Download Vikings S01-S06 (2013-2020) Dual Audio</h1><div class="entry-content">
<h2>Vikings S01 Hin-Eng Dual Audio</h2><p>Vikings S01 1080p BluRay [Hindi + English]</p><p><a href="https://en.thenaukriadda.in/?sid=s1e1">Episode 1</a><a href="https://en.thenaukriadda.in/?sid=s1e2">Episode 2</a><a href="https://example.com/all.zip">Zip / Pack</a></p>
<h2>Vikings S02 Hin-Eng Dual Audio</h2><p>Vikings S02 1080p BluRay [Hindi + English]</p><p><a href="https://en.thenaukriadda.in/?sid=s2e1">Episode 1</a></p>
<h2>Vikings S06 Hin-Eng Dual Audio</h2><p>Vikings S06 1080p BluRay [Hindi + English]</p><p><a href="https://en.thenaukriadda.in/?sid=s6e1">Episode 1</a></p></div>`;
const ctx = {
  module: { exports: {} }, require, URL, URLSearchParams, setTimeout, clearTimeout, console: { log: x => logs.push(x) },
  VUEO_DISCOVERY_CONTEXT: { tmdb: { id: 44217, name: 'Vikings', first_air_date: '2013-03-03', original_language: 'en' } },
  fetch: async (url, options = {}) => {
    calls.push({ url, options });
    const u = new URL(url); let body;
    if (url.includes('domains.json')) body = JSON.stringify({ UHDMovies: 'https://uhdmovies.my' });
    else if (u.hostname === 'uhdmovies.my' && u.searchParams.has('s')) body = search;
    else if (u.pathname === '/wrong') throw Error('Wrong series selected');
    else if (u.pathname === '/vikings') body = page;
    else if (u.searchParams.has('sid')) body = `<form id="lp-land" method="POST" action="https://en.thenaukriadda.in/"><input name="_lp_http" value="${u.searchParams.get('sid')}"></form>`;
    else if (u.hostname === 'en.thenaukriadda.in' && u.pathname === '/' && options.method === 'POST') {
      const p = new URLSearchParams(options.body); assert.equal(p.get('_lp_http'), 's6e1');
      body = '<form id="lp-s1-form" action="https://en.thenaukriadda.in/article"><input name="_lp_http2" value="s6e1"><input name="_lp_token" value="a"><input name="_lp_chain" value="b"><input name="_lp_hop_index" value="0"></form>';
    } else if (u.pathname === '/article') {
      assert.equal(options.method, 'POST'); assert.ok(options.headers.Cookie.includes('session=abc'));
      body = `<script>sc("lp-test","cookie-value",60);bg.setAttribute('href',"https:\\/\\/en.thenaukriadda.in\\/?lp_go=lp-test");</script>`;
    } else if (u.searchParams.has('lp_go')) {
      assert.ok(options.headers.Cookie.includes('lp-test=cookie-value')); body = '<script>window.location.replace("https:\\/\\/driveseed.org\\/r?key=test");</script>';
    } else if (u.pathname === '/r') body = '<script>window.location.replace("/file/test")</script>';
    else if (u.pathname === '/file/test') body = '<ul><li class="list-group-item">Name : Vikings.S06E01.1080p.English.mkv</li></ul><a href="https://cdn.example/6-1.mkv">Instant Download</a><a href="https://ads.example/">Ad</a>';
    else if (u.pathname === '/zfile/generate') {
      if (options.method === 'POST') { assert.ok(options.body.includes('name="key"')); assert.ok(options.body.includes('testkey')); assert.equal(options.headers['x-token'], 'driveseed.org'); body = JSON.stringify(mode === 'hosterror' ? {error: true} : {url: 'https://cdn.example/cloud.mkv'}); }
      else body = '<script>async function generate(action = "cloud") {formData.append("key", "testkey");}</script>';
    }
    else if (u.hostname === 'video-seed.dev' && u.pathname === '/api') {assert.equal(options.method,'POST');assert.equal(new URLSearchParams(options.body).get('keys'),'test-token');assert.equal(options.headers['x-token'],'video-seed.dev');body=JSON.stringify({url:'https://cdn.example/videoseed.mkv'});}
    else if (u.pathname === '/unresolved') body = '<html><a href="https://ads.example/">Download advertisement</a></html>';
    else throw Error('Unexpected URL ' + u.hostname + u.pathname);
    if (mode === 'blocked' && u.searchParams.has('sid')) return { ok: false, status: 403 };
    return { ok: true, status: 200, url, headers: { get: k => k === 'set-cookie' ? 'session=abc; Path=/' : 'text/html', getSetCookie: () => ['session=abc; Path=/'] }, text: async () => body };
  }
};
vm.createContext(ctx); vm.runInContext(source, ctx);
const meta = ctx.VUEO_DISCOVERY_CONTEXT.tmdb;
assert.equal(ctx.uhdMatches('Download Vikings: Valhalla (2022)', meta), false);
assert.equal(ctx.uhdMatches('Download Vikings S01-S06 (2013-2020)', meta), true);
assert.equal(ctx.uhdMatches('Download Vikings (2020)', meta), false);
assert.equal(ctx.uhdMatches('Download 1917 (2019) English', { title: '1917', release_date: '2019-01-01' }), true);
for (const season of [1, 2, 6]) {
  const items = ctx.uhdItems(page, 'https://uhdmovies.my/vikings', 'tv', season, 1);
  assert.equal(items.length, 1); assert.ok(items[0].url.endsWith('s' + season + 'e1'));
}
assert.equal(ctx.uhdItems('<h1>Show Season 1-3</h1><div class="entry-content"><a href="https://x.example/a">Episode 1</a></div>', 'https://uhdmovies.my/', 'tv', 3, 1).length, 0);
const movie = ctx.uhdItems('<div class="entry-content"><p>Film.2160p.English.mkv [20GB]</p><p><a class="maxbutton" href="https://x.example/file">Download (G-Drive)</a></p><p>Film.1080p.mkv [5GB]</p><p><a class="maxbutton" href="https://x.example/file2">Download (G-Drive)</a></p></div>', 'https://uhdmovies.my/', 'movie');
assert.deepEqual(Array.from(movie, x => x.quality), ['2160p', '1080p']);
assert.equal((await ctx.module.exports.getStreams('bad', 'tv', 6, 1)).length, 0); assert.equal(calls.length, 0);
let rows = await ctx.module.exports.getStreams(44217, 'tv', 6, 1);
assert.equal(rows.length, 1); assert.equal(rows[0].url, 'https://cdn.example/6-1.mkv'); assert.equal(rows[0].quality, '1080p');
assert.ok(!calls.some(x => x.url.includes('/wrong') || /sid=s[12]e/.test(x.url) || x.url.includes('ads.example')));
assert.equal((await ctx.uhdResolve('https://driveseed.org/unresolved', {}, ctx.uhdState(), 0, {})).length, 0);
const seedRows = await ctx.uhdResolve('https://video-seed.dev/?url=test-token', {quality:'1080p'}, ctx.uhdState(), 0, {}); assert.equal(seedRows[0].url,'https://cdn.example/videoseed.mkv');
const cloudRows = await ctx.uhdResolve('https://driveseed.org/zfile/generate', {quality:'2160p'}, ctx.uhdState(), 0, {}); assert.equal(cloudRows.length, 1); assert.equal(cloudRows[0].url,'https://cdn.example/cloud.mkv'); assert.equal(cloudRows[0].quality,'2160p');
mode = 'hosterror';assert.equal((await ctx.uhdResolve('https://driveseed.org/zfile/generate', {}, ctx.uhdState(), 0, {})).length,0);
assert.equal((await ctx.uhdResolve('https://driveseed.org/file/test', {expectedSeason:1, expectedEpisode:1}, ctx.uhdState(),0,{})).length,0);
mode = 'blocked'; rows = await ctx.module.exports.getStreams(44217, 'tv', 6, 1); assert.equal(rows.length, 0);
assert.ok(!logs.some(x => /cookie-value|\?sid=|\?key=|session=abc/.test(x)));
console.log('PASS UHDMovies: exact title/year, Valhalla rejection, numeric title 1917, season isolation, ambiguous season rejection, movie qualities, lp-land/lp-s1 POSTs, JS cookie and lp_go, Driveseed redirects, media-only output, multipart cloud generation, VideoSeed API, host-error rejection, host filename mismatch rejection, blocked hosts, no ad following, sanitized logs.');
