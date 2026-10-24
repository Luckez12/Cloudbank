# Viduki v1.0.4

Upload providers/viduki.js and manifest.json to matching paths. No YML.

Video discovery/capture and no-CDN-recheck flow from v1.0.3 preserved. Subtitle collector starts alongside WebView. Immediately on WebView return (including empty capture) or failure/timeout, stop collection and abort outstanding subtitle fetches where AbortController is supported. Late results are ignored and cannot trigger subsequent requests even if transport ignores abort. No subtitle await or post-discovery fetch remains. A 3500ms independent cap can stop subtitle work earlier.

Only subtitles whose VTT/SRT cues were already validated during discovery are returned. A missing/not_downloaded index is skipped without preparation requests, polling or retries. Captured but unvalidated late subtitle URLs are not forwarded. Zero subtitles is valid and never blocks video.

Tests cover pending index and pending subtitle body at discovery completion, abort signals, late-result suppression, failure cleanup and valid subtitles completed before discovery. Video playback/speed on device remain unverified for this revision.
