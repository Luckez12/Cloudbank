// Run after extracting this patch at the Cloudbank repository root.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.scrapers.some(s => s.id === 'allwish' || s.id === 'dahmermovies-tv')) {
  throw new Error('Apply the updated manifest before cleanup.');
}
const merged = fs.readFileSync(path.join(root, 'providers/dahmermovies.js'), 'utf8');
if (!merged.includes('CLOUDBANK_DAHMER_CONSOLIDATED_V1') || !merged.includes('CLOUDBANK_DAHMER_TV_CORE_START')) {
  throw new Error('Integrated Dahmermovies provider is missing; cleanup stopped.');
}
for (const relative of ['providers/allwish.js', 'providers/dahmermovies-4k.js', 'tests/dahmer-consolidated.cjs', 'tests/dahmer-get-validation.cjs']) {
  const full = path.join(root, relative);
  if (fs.existsSync(full)) {
    if (!fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink()) throw new Error('Unexpected file: ' + relative);
    fs.unlinkSync(full);
    console.log('Removed ' + relative);
  } else console.log('Already removed ' + relative);
}
