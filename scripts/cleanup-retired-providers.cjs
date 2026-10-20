// Run after extracting this ZIP at the Cloudbank repository root.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const retired = new Set(['dahmermovies', 'dahmermovies-tv', 'torrentio', 'ctgmovies', 'allwish']);
if (manifest.scrapers.some(item => retired.has(item.id))) throw new Error('Apply the updated manifest before cleanup.');
const files = ["providers/dahmermovies.js", "providers/dahmermovies-4k.js", "providers/torrentio.js", "providers/ctgmovies.js", "providers/allwish.js", "tests/dahmer-browser-handoff.cjs", "tests/dahmer-consolidated.cjs", "tests/dahmer-get-validation.cjs", "scripts/cleanup-dahmer-allwish.cjs"];
for (const relative of files) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) { console.log('Already absent: ' + relative); continue; }
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected file: ' + relative);
    fs.unlinkSync(full);
    console.log('Removed: ' + relative);
}
