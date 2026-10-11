# 4KHDHub consolidation — Cloudbank 1.20.10

Provider version 1.8.0. Baseline: 1.20.9 HDHub4u merge and clean provider names.

## Audit

V2 and V3 otherwise share the same core, but V2 includes Hblinks/hubstream.dad selection and bounded nested Hblinks -> HubDrive/HubCloud/direct extraction that V3 lacks. Their selection picks one initial extractor per file block. The ordinary provider already contains the original Cloudbank engine and the adapted Test-Plugin engine; both remain instead of adding another duplicate engine.

## Consolidation

V2 nested Hblinks/hubstream.dad behavior is transferred into the primary resolver, with a depth limit of two and per-call bounds. Hblinks-only pages are accepted by the movie fallback parser. Imported movie-card search parsing is supported alongside the existing URL-pattern parser. Current-domain discovery uses the shared domains.json source, caches successful results for four hours, coalesces simultaneous requests and backs off for five minutes on failure. It starts concurrently with TMDB metadata. V2/V3 default 4khdhub.click is retained as a last domain fallback after one/fans.

Instead of one successful result per quality, the primary collector processes independent URLs with three workers, at most eight selected candidates, a 5.2-second collection window and at most 2.5 seconds per candidate. Quality groups are interleaved so a large 4K group does not consume every slot. Completed results survive failed or stalled sources. A 10-second primary extraction deadline limits the collection phase; the existing outer 11-second primary attempt and 7.5-second original fallback remain. This is bounded candidate collection, not exhaustive discovery of every mirror; slow sources can be omitted.

HLS URLs with .m3u8 paths are read and must begin with #EXTM3U before return. A valid master remains intact with Auto quality, preserving its audio/video/subtitle groups. Direct-file response probes remain for non-HLS sources. Duplicate URLs are queued once, and final deduplication includes playback headers and subtitle metadata rather than quality alone. Distinct servers at the same quality are retained. Extractor-specific headers/subtitles survive stream formatting and the original fallback output. Season zero is preserved. PlayIMDb display and shared metadata wrappers remain.

## Validation

249 JavaScript tests and 7 Python tests passed. Validator: 93 providers. New tests cover nested Hblinks/hubstream.dad and cycle depth limits, independent same-quality servers, three-worker collection, verified master/Auto output, invalid HLS rejection, duplicate quality buttons, partial results at deadline, balanced candidate selection, domain cache/coalescing, movie-card discovery, Hblinks-only detail fallback and playback metadata preservation.

Live checks on 2026-10-11: 4khdhub.one homepage and /?s=Jailer returned HTTP 200; that search produced no movie cards for this title. The homepage contains movie-card URLs and an official search form with input name s. 4khdhub.click returned HTTP 502. The upstream domains.json was verified during the immediately preceding HDHub4u audit and lists 4khdhub.one. These are domain/site checks, not live source resolution or Android playback verification.

## Apply

Extract into repo root after 1.20.9. Manually delete providers/4khdhub-v2.js and providers/4khdhub-v3.js. ZIP extraction cannot delete existing files. No YML or deletion workflow is included. Provider-name emoji cleanup from 1.20.9 is retained. Historical import reports retain upstream provenance; docs/test-plugin-adaptation.json records the edited core hash.
