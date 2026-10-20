# Cloudbank 1.20.46 — Dahmermovies consolidation and All-Wish removal

Based on the supplied Cloudbank-main (8).zip, manifest 1.20.45. This patch changes Cloudbank only. It does not add All-Wish to CloudAnime.

## Result

- Dahmermovies v1.1.0 retains the existing `dahmermovies` identity, quality settings and display wrapper.
- The former Dahmermovies-TV catalogue extraction is embedded in the main provider. The preferred path prioritizes 4K and retains playback headers, including Range. It supports both padded and ordinary season directory names.
- The existing main extraction, including its existing version fallback, remains available only after the preferred catalogue path returns empty, fails or exhausts its 6.5-second budget. The overall public extraction budget is 18.5 seconds. Transport calls and body reads remain bounded; expired scopes cannot initiate more HTTP. In-flight requests may continue when the host does not cancel them.
- Quality switches apply before the preferred path's five-file cap. Known qualities are read from filenames; the old TV implementation's blanket 1080p label is replaced with the actual known resolution or Unknown. No repository-wide minimum-resolution change is included.
- Exact episode boundaries prevent E1 from matching E10/E11. A conflicting explicit season is rejected. Specials (season zero) remain supported.
- Standalone `dahmermovies-tv` and `allwish` entries are removed, leaving 51 providers. The other 50 entries and provider implementations are unchanged.

## Apply

Extract the patch into the Cloudbank repository root, then run:

```
node scripts/cleanup-dahmer-allwish.cjs
npm run validate
node tests/dahmer-consolidated.cjs
```

The cleanup script checks that the updated manifest and integrated provider are present before deleting only:

- `providers/allwish.js`
- `providers/dahmermovies-4k.js`

It is safe to run again. Commit the file deletions together with the patch. Alternatively, delete the two listed files manually after applying the patch.

The repository's current ZIP workflow copies files and does not process DELETE_FILES.txt or run this cleanup script. Uploading this ZIP alone does not delete the old tracked files; complete the cleanup above to avoid orphan-provider validation errors. The patch contains no YML changes.

## Validation

- 13 controlled integration cases pass against the actual consolidated script: movie/TV extraction, 4K ordering, actual quality labels, episode/season boundaries, padded-season fallback, settings before the five-file cap, merged settings, retained legacy metadata, series alias/specials, invalid coordinates, global exports, expired request scopes and actual empty fallback paths.
- Cleanup was exercised twice against a disposable copy of the supplied full repository; the second run reports the files already removed.
- The existing repository validator passes with all 51 providers after cleanup.
- Live media playback on Android has not been tested. This patch consolidates the existing extraction routes; it does not certify availability of the remote catalogue or every final link.
