# Stream display

All 103 Cloudbank providers include the same standalone English formatter.
It changes only each playable result's `name` and `title`. Provider registration,
URL, headers, subtitle tracks, quality, settings and other playback fields are
retained. Extraction code and imported source attribution are unchanged.

Example with available metadata:

```text
Project Hail Mary (2026)
1080p · WEB-DL · HEVC
English Audio · AAC 5.1
Subtitles: English, Malay
HLS · Server 1 · 2.4 GB · 90 min
```

Series titles append `S01E05`. Details are omitted when unavailable; no default
resolution or audio language is invented. Real server names are retained where
identifiable, otherwise results receive numbered server labels. Subtitle labels
are converted to English without filtering or modifying subtitle tracks.

Title/year/runtime are taken from TMDB data already observed by that provider,
or a matching host discovery context. No additional network requests are made.
Source titles remain available when TMDB details are absent. Movie runtime is
content metadata, not measured video duration; series-average runtime is not
displayed as an episode duration. Source-supplied minute durations are retained.
Technical labels describe what upstream supplied and are not a media probe.

The provider's repeated stream name is empty. App-generated provider headers
and the visual layout remain controlled by the consuming app; a client that
substitutes a fallback name may still show its own label. Live playback and
actual device rendering need verification in the app.

The authoritative formatter is `scripts/stream-display.js`. After editing it,
run `python3 scripts/embed_stream_display.py` to embed identical copies in the
providers, then `npm run validate` and `npm test`.
