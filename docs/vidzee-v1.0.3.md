# VidZee v1.0.3 — Auto and Unknown quality labels

Auto is returned only when the retrieved HLS master contains multiple variant entries. The source title includes the maximum advertised height when available, for example Auto (up to 2160p). A single-variant master with resolution metadata returns that resolution. Media-only playlists, MP4 links without dimensions, and unreadable playlists return Unknown. No resolution is inferred from filenames or URL paths.

This is a provider-only patch. It does not add player-side dimension updates; those require the current VUEO app source. UI rendering of the literal Unknown value still needs verification in VUEO. No additional network requests, segment/init reads, binary probes, or Range headers are introduced. The v1.0.2 extraction URLs, request headers, subtitle handling, server order and original-language filtering are retained. Default servers whose audio language is unavailable remain unverified, as in v1.0.2.

Validation: 52-provider repository validation and both VidZee suites pass. Cases include multi-variant masters with and without dimensions, single-variant 720p, media-only and unreadable playlists, preserved source headers/URLs, no segment requests and original-language filtering. Android playback has not been retested for this version.

Repo version: 1.20.26. Provider version: 1.0.3.
Apply at Cloudbank repository root, refresh the repo in VUEO, and check provider version 1.0.3. No YAML changes.
