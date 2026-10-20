# Cloudbank 1.20.51 / Cinevibe 2.0.0

Apply this ZIP at the Cloudbank repository root, then refresh the repository/provider in VUEO. This is a provider-only patch. No VUEO Kotlin, app build, provider-specific native bridge or YML/workflow change is included.

If you have not applied the prior three-provider removal, run:

```bash
node scripts/cleanup-retired-providers.cjs
```

Dahmermovies, Torrentio and CTGMovies remain removed. Prior AllWish and standalone Dahmer TV removals remain in force. 48 providers remain. After the removal, only the Cinevibe provider entry and source change in this patch.

## Website audit and replacement

The user supplied cinevibe.cc after cinevibe.asia could not be reached. The .cc homepage, its public JavaScript and its watch-player chunk were read. Browser UI navigation reached `/watch/movie/tenzing-1288069`, which loaded the site's Server 1 iframe:

`https://vidsrc.wtf/api/1/movie/?id=1288069&color=e01621&autoPlay=true`

A TV page for Game of Thrones S1E2 visibly displayed the selected episode and used:

`https://vidsrc.wtf/api/1/tv/?id=1399&s=1&e=2&color=e01621&autoPlay=true`

The current watch-player JavaScript publishes these exact TMDB routes. It embeds third-party servers. It does not use the old cinebox-1 token API from the .asia scraper. The observed .cc player layout alone does not establish ownership continuity with the former .asia site; this patch targets the user-specified .cc site.

The old API, fixed session/fingerprint values and token generator were removed. The provider uses the published Server 1 route directly, preserving iframe context and the Cinevibe Referer through VUEO's existing generic webviewResolve API. This avoids loading the full recommendation app, title search, TMDB detail fetches and obsolete token work. Display metadata can still come from the existing shared context.

Directly opening the player as a top-level document did not reveal media in the cloud browser; loading it as the website's iframe did. The provider therefore sets directLoad:false. This uses the normal wrapper already supported by VUEO. It does not force a new app/browser environment or add native site rules.

## Acceptance behavior

Only observed MP4 or HLS candidates are considered; obvious ad/trailer/preview URLs are excluded. Captured playback headers are retained, excluding connection/Host/Range controls and malformed header values. The first candidate that validates is returned; at most two are checked.

MP4 validation uses one GET with Range bytes=0-1 and requires HTTP 206, a matching Content-Range, a plausible total size and MP4/binary MIME. Native VUEO intentionally omits binary response bodies, so this is transport/header validation, not a media-signature or decoder proof. HLS acceptance requires an actual EXT-M3U playlist. Auto is used only for a master playlist; direct MP4 and single media playlists remain Unknown when their resolution is unverified. 403/429 stop candidate iteration.

Captured VTT/SRT subtitle sidecars are forwarded with their observed labels, languages and headers. The provider itself does not cache generated signed URLs. VUEO's ordinary discovery cache is not changed. Only the website's default Server 1 is included in this version; this patch does not claim support for every server offered by the site.

## Verification and limits

- 29 executable provider cases pass: exact movie/TV routes, input validation, iframe/Referer context, first-result behavior, no old token fallback, headers, MP4 range/status rejection, HLS content, subtitles, duplicates, no provider result cache and 403/429 stop behavior.
- Full Cloudbank validation passes with 48 providers.
- In the cloud browser the Tenzing media element had readyState 4, reported a duration around 2h05m, advanced its playback clock and responded to a forward seek. It reported zero video dimensions in that browser, so a decoded visual first frame was not established.
- One separate bounded native GET to the observed signed Tenzing MP4 returned HTTP 206, video/mp4, bytes 0-1/1278072360 and Content-Length 2. Only two bytes were read. No observed signed media URL is embedded in this patch.
- A real Android generic-WebView discovery and Media3 playback/seek test remain pending. The browser and native range observations are not a full device playback test.

Run `node tests/cinevibe-cc.cjs` for fixtures and `node scripts/validate.mjs` for repository validation. Live UI pages and public script paths were audited on 2026-10-20. Website changes can require another provider update.
