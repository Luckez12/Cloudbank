# HDHub4u consolidation and manifest name cleanup — Cloudbank 1.20.9

HDHub4u version 1.7.0. Baseline: Cloudbank 1.20.8 with Castle and VixSrc merges.

## Audit and consolidation

HDHub4u V2 and V3 have the same discovery and extractor flow. Their embedded cores differ in generated timestamp, default domain (new6.hdhub4u.cl versus new6.hdhub4u.fo) and Hblinks selectors; V2 adds deduplication and the broader div.entry-content a selector. The current ordinary provider already contains the original Cloudbank engine and the adapted Test-Plugin engine, with broader all-anchor parsing, verified direct/HLS extraction and stronger title/season matching.

Both existing engines remain. Useful imported behavior is consolidated into them: V2/V3 domain fallbacks, Hblinks dispatch to Hubstream/Vidstack/Hdstream4u, and Vidstack AES subtitle mapping. V2/V3 standalone entries are removed. No third duplicate extraction engine is added. Original import reports retain historical provenance; docs/test-plugin-adaptation.json records the changed core hash.

The default domain is new3.hdhub4u.free, verified during this audit. The shared upstream domain updater is cached for four hours on success, coalesces simultaneous refreshes, and backs off for five minutes on failure. Refresh starts concurrently with TMDB metadata. Search uses the refreshed domain, then falls back to the original/imported domains.

Verified HLS masters are returned intact as Auto, preserving their native video/audio/subtitle groups. The provider no longer returns only child renditions from a working master. HLS verification rejects HTML even if the response claims an HLS content type. Distinct source URLs or playback headers are no longer discarded just because their quality is equal. Existing discovery/resolution task counts, provider budgets and original-engine fallback remain; this does not promise exhaustive discovery of every server.

Vidstack subtitle URLs, Referer and Origin survive decryption and stream formatting. HTTPS sources are not downgraded. The original fallback also preserves extractor-specific headers and subtitle metadata. Season-zero input is preserved, and HTTP time limits now include response-body reading.

## Manifest cleanup

Leading emoji removed from these 12 names: All-Wish, AnimeWorld, Anime-Sama, Castle, Goated, MoviesHunt, PersianStremio, Peachify, Torrentio, VidRock, VidLove, OnlyKDrama. Provider IDs, filenames and logo URLs remain unchanged. Only HDHub4u V2/V3 entries are removed.

## Validation

245 JavaScript tests and 7 Python tests passed. Validator: 95 providers. New tests cover verified master/Auto output, invalid HLS rejection, preserving independent servers at the same quality, encrypted Vidstack subtitle transfer, Hblinks player-host dispatch, cached/coalesced domain updates, imported fallback domains, requested season-zero handling, bounded body reads and manifest name cleanup.

Live checks on 2026-10-11: the upstream domains.json returned HTTP 200 with HDHUB4u=https://new3.hdhub4u.free; new6.hdhub4u.cl and new5.hdhub4u.cl redirected there with HTTP 200; new6.hdhub4u.fo redirected to hdhub4u.bi with HTTP 200. Search API returned HTTP 200 and one Jailer result. Its detail page returned HTTP 200, and the current parser found WATCH (hdstream4u.com), HubCDN and nine quality blocks. No live end-to-end playback, video segment delivery or Android playback was verified.

## Files and manual deletion

Extract at repo root. Manually delete providers/hdhub4u-v2.js and providers/hdhub4u-v3.js. ZIP extraction cannot remove existing files. No YML or deletion workflow is included. This patch includes a full manifest based on 1.20.8 and incorporates the requested Castle name cleanup.
