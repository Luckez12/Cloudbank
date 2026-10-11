# VixSrc consolidation — Cloudbank 1.20.8

VixSrc provider version 1.1.0. Apply to the 1.20.7 Castle-merged baseline.

## Audit

The original provider uses komiknostalgia.id/api/movie or /api/tv, reads a src embed and extracts a signed playlist. It forces an .m3u8 suffix and has narrow single-quote parsing, mandatory metadata before extraction and an assumed 1080p default. The original optional Node proxy is unavailable in the embedded runtime.

V2 goes directly to vixsrc.to/movie or /tv and searches HTML for a masterPlaylist payload. Its query construction only handles the special ?b=1 case, its token/expiry parser is narrow, TMDB failure blocks extraction, and subtitle lookup is awaited but the subtitle URL is never attached to returned streams.

## Consolidation

The ordinary VixSrc ID now uses the official API/embed route first, direct-page parsing second and original custom-domain API/embed route last. The official route avoids the wrapper page discovered during live testing. V2 is removed from the manifest; manual deletion of providers/vixsrc-v2.js is required. No deletion automation or YML is included.

A scoped parser reads single/double-quoted and numeric fields inside masterPlaylist, including nested params; it handles escaped strings, relative URLs and existing query parameters. Signed tokens are encoded once. Playlist endpoints retain their original paths; no .m3u8 extension is invented. Incomplete signed payloads are rejected. No page scripts are executed.

HLS responses must begin with #EXTM3U. A successful master is returned once with Auto quality and embed Referer/Origin; audio, video and embedded subtitle selection remain in the master. English external subtitle tracks are now attached when available; optional subtitle/metadata failure does not remove the stream. TMDB display metadata runs concurrently and is capped at 1.2s; VUEO shared metadata and PlayIMDb display wrappers are preserved. Native fetch requests include body reading in their time budget, with a total extraction deadline of 17.5s. The old hasSettings descriptor was removed because the exported provider never implemented a settings handler.

## Validation

Live check on 2026-10-11: vixsrc.to homepage HTTP 200; /movie/550 HTTP 200 but no masterPlaylist; /api/movie/550 HTTP 200 with a relative embed src; embed HTTP 200 with a nested signed masterPlaylist; the newly constructed extensionless master URL returned HTTP 200 with #EXTM3U, 2 video variants, 2 audio tracks and 6 embedded subtitle tracks. komiknostalgia.id/api/movie/550 returned HTTP 502 in this environment, so it remains a last fallback. These results establish extraction and master availability for one movie, not end-to-end playback on Android, segment/key delivery, every title or TV playback.

Full automated suite: 240 JavaScript tests and 7 Python tests passed. Validator: 97 providers. Tests cover scoped signed parsing, special token encoding, query preservation, direct and API/embed routes, relative src, numeric expiry, escaped strings, subtitle attachment and failure, metadata failure, season zero, invalid HLS rejection, original custom-domain fallback, route failures and bounded waits.

Official documentation: https://vixsrc.to/ — /movie/{id}, /tv/{id}/{season}/{episode}; custom domains are supported. Preserve upstream provenance in docs/upstream-import.json and docs/yoruix-import.json; the latter keeps historical V2 import data.
