# Selected provider removals — 24 October 2026

User-authorized removals in this patch:

- `providers/streamflix.js`
- `providers/fibwatch.js`
- `providers/onlykdrama.js`
- `providers/yflix.js`

The included manifest has already removed these four entries. Vidnest and Mapple remain enabled.
ZIP extraction overlays files; it cannot physically remove existing files.
Run `node scripts/retire-selected-providers.cjs` once from the repository root after extraction, or run the included **Remove selected retired providers** GitHub Actions workflow manually after applying the ZIP.
The cleanup script removes only these four files and their manifest entries; repeated runs are safe.
