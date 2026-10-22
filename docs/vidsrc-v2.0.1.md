# VidSrc v2.0.1 — basic resolver compatibility

The v2.0.0 request used `waitForMediaReady: false`, but required every result to contain a true `networkObserved` or `responseObserved` flag. VUEO's resolver emits these flags and session diagnostics only when `waitForMediaReady` is enabled. Basic mode emits `streams` with URL, label and headers, without these flags. The mismatch discarded every basic-mode candidate, including valid media.

The user's log with one captured candidate, an unknown finish reason and false pageFinished is consistent with this mismatch. The old pageFinished log converted an absent field into false. This log alone does not prove that the page failed, Turnstile blocked discovery or the captured URL is playable.

This provider-only correction keeps basic mode so discovery can finish on a candidate. It accepts absent observation flags only in basic results and checks the captured manifest/file with one GET capped at 1.8 seconds. HLS must be a real playlist; HTML and JSON are rejected. MP4 uses a small Range request and requires video/mp4. Checks for up to three candidates run in parallel. Detailed output that explicitly lacks network/response observation is still rejected. No signed URLs are cached or printed.

Master HLS remains the exact captured URL, Auto quality and adaptive MIME. No child playlist, segment, subtitle or separate site API requests are added. Missing diagnostics now print not-provided, and captured count is no longer mislabeled as observed count. The normal maximum remains 17 seconds in WebView plus 1.8 seconds for basic media checks, inside the provider's existing result budget.

Validation passes for 36 providers. Regression fixtures cover actual basic output with omitted flags, detailed observed output, HTML at a media-shaped URL, exact movie/episode routing, invalid episodes, audio metadata and preservation of the original master URL with exactly one master check. These are contract tests, not live Android playback tests. The supplied log does not reveal the captured URL; device testing is still required to establish its accessibility and playback.

Manifest v1.20.76, VidSrc v2.0.1. Existing delete instructions for UHDMovies, VegaMovies and VidEasy are included. VidLink remains deferred. No VUEO application changes.
