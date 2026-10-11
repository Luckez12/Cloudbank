# Cloudbank — Test-Plugin adaptation

Reference: Test-Plugin-main (12).zip, snapshot 17e99d41a378fff21fdc1ef8e9cc0036e6a4bfca.
Base: Cloudbank-main (2).zip with the VidLink single-provider v1.20.5 patch.

All eight reference provider IDs match existing Cloudbank providers. No provider variants are removed in this patch.

| Provider | Transferred path |
|---|---|
| MSM21 | PlayerX AES extraction, independent server-option scans, partial winners at scan deadline, per-invocation cancellation |
| PencuriMovie | VOE decoded/signed URLs and playback headers, HG mirror extraction, checked HLS/direct selection per website choice |
| KissKH | Exact title/season discovery, current kkey capture/cache and bounded legacy key fallback |
| MovieBox | Signed mobile API, session token/host-health routing, 1080p-first and 720p fallback |
| 4KHDHub | Parallel quality/host resolution and verified direct playback candidates |
| HDHub4u | Search API, quality/host extraction, HLS and direct/seek checks |
| OneTouchTV | AES response parsing and title/episode discovery |
| CineMode | Same-session WebView source capture after backend calls |

The transferred engine is tried first, with an 11-second maximum wait. An empty result, rejection or deadline invokes the retained Cloudbank engine, with a 7.5-second maximum wait. This retains existing archive/landing discovery, H5 mirrors and native-host paths as fallbacks. Shared metadata, existing provider IDs, display formatter, enabled states and platform settings are retained. The final getStreams interface returns an array; this is not incremental UI delivery.

Local corrections:
- KissKH rejects a context whose explicit TMDB ID or media type differs from the request. The supplied regression test failed before this correction.
- HDHub4u rejects explicitly different seasons instead of only subtracting a score that could remain positive.

Verification: repository test suite and static validation; transferred MSM21 (16), PencuriMovie extraction (12), PencuriMovie selection (8) and KissKH (3) regression cases are run from the exact embedded source. Integration tests cover primary success, legacy fallback, errors, shared metadata, preserved headers/subtitles, invalid inputs and wrong-season rejection.

Limits: no live Android playback verified. CineMode and current KissKH key capture depend on the app WebView bridge. PencuriMovie requires the app to respect provider User-Agent headers. A JS timeout stops accepting late results; native requests may still finish in the background if cancellation is unsupported. The retained fallback gets less time than running it alone, so this patch does not establish universal performance improvement. No site is declared working or permanently dead from mocked tests.
