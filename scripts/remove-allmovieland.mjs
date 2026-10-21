import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.scrapers)) throw new Error('manifest.scrapers is missing');
const removed = manifest.scrapers.filter(p => /^allmovieland(?:-|$)/i.test(p.id));
manifest.scrapers = manifest.scrapers.filter(p => !/^allmovieland(?:-|$)/i.test(p.id));
if (removed.length) {
  const version = manifest.version.split('.').map(Number);
  version[2]++;
  manifest.version = version.join('.');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
for (const filename of fs.readdirSync(path.join(root, 'providers'))) {
  if (/^allmovieland(?:-.*)?\.js$/i.test(filename)) fs.rmSync(path.join(root, 'providers', filename));
}
console.log(`Removed ${removed.length} AllMovieLand manifest entries and provider files.`);
