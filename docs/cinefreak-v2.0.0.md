# CineFreak 2.0.0 — .net original-audio filtering

## Changes

- Replaces the old .nl provider with the current .net public search endpoint.
- Requires an exact TMDB title alias, release year and movie/series type, checked again on the selected post.
- Requires each file's explicit language label to match TMDB original_language. Unknown, dubbed, dual-audio and multi-audio files are rejected. Native Hindi is accepted only for Hindi-original titles.
- Requires 720p or above, skips hidden/aria-hidden links, and only follows explicit CineCloud file links.
- Series use exact season/episode keys. Episode ranges and combined files are rejected.
- Direct media must pass an HTTP 206 Range probe and MKV/MP4 signature check. HTML, embedded players, archives and ignored Range requests are rejected.
- Keeps the existing stream display formatter. No subtitle URLs are invented: an “SRT included” note refers to the container, not an external subtitle file.
- Uses an 18.5-second discovery budget and a maximum 4.2-second timeout per request. No signed media URL cache and no VUEO/YML changes.

## Validation and limits

11 fixture checks pass, including full mocked discovery, original-language filtering, exact episodes, host 403, hidden links and ignored Range requests. Run `node tests/cinefreak-original.cjs`.

The real Me Before You (2016) page parsed to one visible English-labelled 720p download candidate. The real The Borgias season page used combined episode packs; S01E01 was correctly rejected.

Live playback is NOT confirmed. The direct CineCloud page returned HTTP 403. A full live Node discovery attempt timed out at search after approximately 4.2 seconds and returned zero sources. Browser and device access can differ, but success is not assumed.

The new in-page streaming API additionally requires browser verification and may prepare files asynchronously. This provider does not bypass that verification or claim that API is usable through plain HTTP.

Audio eligibility is based on explicit per-file labels compared with TMDB metadata. The remote container's audio tracks are not decoded or inspected by the provider; mislabeled uploads remain possible. Dual-audio containers are excluded rather than relabeled as original-only.

## Applying

Apply this ZIP using the existing repository ZIP workflow. It contains the CineFreak provider, manifest update, tests and this note. Test on VUEO and send the CineFreak debug log if it returns no results. This is a device-test build, not a confirmed playback fix.

The manifest is based on live Cloudbank 1.20.55 (MovieBox 3.0.1 retained) and becomes 1.20.56. The separate AllMovieLand deletion script, if needed, should run after applying this manifest so the earlier requested removal remains in effect.
