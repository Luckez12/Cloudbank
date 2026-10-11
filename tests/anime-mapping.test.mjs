import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// Anime resolver tests now belong to CloudAnime. Guard the completed migration here.
const retired = [
  'allanime', 'animekai', 'anizone', 'anikototv', 'anidb', 'animepahe',
  'animesalt', 'animedekho', 'animetsu', 'animeworld', 'anime-sama', 'animezey',
  'hianime', 'kurage', 'reanime', 'vidnest-anime', 'goated'
];
test('migrated anime providers and removed Goated remain absent from Cloudbank', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  for (const id of retired) {
    assert.ok(!manifest.scrapers.some(provider => provider.id === id), id + ' must not remain registered');
    assert.ok(!fs.existsSync('providers/' + id + '.js'), id + ' must not remain in Cloudbank');
  }
  const vidnest = manifest.scrapers.find(provider => provider.id === 'vidnest');
  assert.ok(vidnest, 'ordinary Vidnest must remain registered');
  assert.ok(fs.existsSync(vidnest.filename), 'ordinary Vidnest file must remain');
});
