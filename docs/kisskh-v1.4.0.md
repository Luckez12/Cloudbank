# KissKH v1.4.0 — Cloudbank 1.20.52

## Scope

Replaces only the KissKH provider implementation and updates its manifest entry.
Based on Cloudbank manifest 1.20.51 (48 providers), including the existing removal
of Dahmermovies, Torrentio and CTGMovies and the existing Cinevibe v2.0.0 entry.
No VUEO app changes or workflow/YML files.

## Findings in the previous KissKH file

- Three nested resolver implementations could perform repeated discovery after a
  failed/timed-out engine. Their domain, token and subtitle behavior differed.
- The transferred engine returned video without subtitle extraction. Its first
  host was kisskh.is; other engines used kisskh.id or kisskh.nl.
- Older paths depended on Google Apps Script for video/subtitle keys, despite a
  per-episode local token generator already being bundled in the alternate core.
- A unique exact-title result was not rejected for a known conflicting release year.
- Subtitle language substring matching could classify French as English.
- Missing alternative_titles could throw during metadata alias collection.

## New request path

1. Reuse VUEO metadata only when its ID/type matches the request; otherwise fetch
   TMDB metadata once. Do not refetch metadata in fallback engines.
2. Search the title through the KissKH JSON API on kisskh.id. Try kisskh.do only
   after an actual primary-host request/schema failure. Remember a working host
   for 30 minutes in the runtime. Successful empty searches do not scan mirrors.
3. Inspect exact title/alias candidates, release year, explicit season and type.
   Known conflicting years are rejected. Duplicate exact matches require a unique
   year resolution. S2+ requires an explicit season entry; no absolute-episode
   guesses, first-result selection or fractional-episode rounding.
4. Only after no verified match, try up to two additional distinct metadata aliases
   sequentially. No title/year query permutations or eager alias fan-out.
5. Select the requested episode ID. Generate separate video/subtitle tokens locally
   and request both APIs concurrently. The normal cold path uses four KissKH API
   requests: search, detail, video and subtitle list. Encrypted subtitle files add
   their own requests. Old runtimes without shared metadata also need TMDB.
6. Preserve direct media headers and observed quality; do not invent audio-language
   evidence or resolution. Reject HTML/embed URLs as direct video sources.
7. After a rejected/empty video token response or subtitle authentication failure,
   optionally capture fresh tokens from that episode's page via the existing
   native webviewResolve bridge, then retry each matching captured token once.
   Captures from another host/episode are rejected. No WebView on the normal path.

## Subtitles

Readable SRT/VTT/ASS links keep their language and referer headers. TXT captions
are downloaded, checked and decrypted using the existing two AES key/IV pairs,
then returned as inline SRT using the same data-URI approach already present in
the legacy provider. Wrong/unknown encryption is omitted with a SUBTITLE_SKIP
log instead of exposing encrypted text as a working caption track. A subtitle
failure does not discard video. No external decryption service is added.

The subtitle pipeline is capped at 4.5 seconds, three concurrent text downloads,
16 unique tracks and 600,000 characters per downloaded caption text. HTTP request
timers include body parsing and abort network requests where AbortController is
available. Each discovery run has an 18.5-second overall deadline, below the
existing 20-second app runtime limit.

## Cache and memory

- Up to 500 compact title mappings, 30-day TTL, least recently used eviction.
- Up to 32 compact episode lists (no description/artwork); lists over 1,000 episodes
  are not cached. Ongoing/unknown-status lists expire after 5 minutes; completed
  lists after 6 hours. A missing requested episode forces a detail refresh.
- Cache identity includes media type, TMDB ID and season. Title/year changes or
  detail identity failures invalidate a cached match.
- Signed media URLs, subtitles and tokens are not retained in this cache.
- This cache is runtime-local. It survives only while the host preserves that JS
  global context. If VUEO recreates it for every scan, only cold-path improvements
  apply; this patch does not promise persistent storage across scans/app restarts.

## Validation and limits

- `node tests/kisskh-fast.cjs`: 42 checks passed.
- `npm run validate`: 48 provider entries passed static validation.
- Token vectors for three episode IDs match both video/subtitle token output from
  the previously bundled engine. This checks compatibility, not current server
  acceptance for every episode.
- Live standalone API probes returned search results for My Demon on kisskh.id
  and kisskh.do and valid detail on kisskh.id: drama 8268, S1E1 episode 139842.
- Other live requests intermittently timed out. The full new resolver's live run
  ended after both search-host timeouts and returned zero sources. No end-to-end
  playback, media bytes, Android TV/mobile subtitle rendering or speed improvement
  is claimed as verified. Test those on the device before marking KissKH working.

## Device checks

Test My Demon (TMDB 218539), S1E1 first. Check that the log reaches MATCH with drama
8268 and episode 139842, then reports stream/subtitle counts. Test playback, seek,
English/other available captions, another episode, a later-season title and a
movie. If it fails, share the sanitized KissKH log to identify search, detail,
video-key or subtitle failure. Do not mark the provider complete on HTTP 200 alone.

## Attribution

The local token algorithm is adapted from the existing bundled Yoruix engine;
the equivalent AES implementation is checked against its output. Existing shared
metadata, alias collection and Cloudbank display adapter are retained with the
documented corrections. Existing GPL notices and licensing apply; see
docs/LICENSE-Yoruix-GPL-3.0.txt and docs/UPSTREAM.md in the repository.
