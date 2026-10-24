# Viduki v1.0.1

Upload providers/viduki.js and manifest.json to the same repo paths. No YML.

Changes: WebView waitForMediaReady=false, finishAfterFirstMs=150. Keep API 1 website internal fallback; do not scan all APIs. Keep one small video playlist HTTP check. Website subtitle fetch and content verification start alongside WebView. Verify a maximum of four subtitle URLs concurrently, with bounded waits. Only valid VTT/SRT text cues are returned, with normalized language, MIME and headers. Invalid or missing subtitles do not block a video result.

Tests: exact movie/TV routes, bridge completion options, English language/MIME, valid VTT, HTML subtitle rejection while video succeeds, video HTTP errors/HTML, low quality, unobserved URLs, invalid input. Tests use controlled fixtures. Android end-to-end performance and subtitle rendering are unverified for this version. This removes deliberate media-readiness waiting; it cannot guarantee a fixed speed because API/host latency varies.

Original audio and quality limitations from v1.0.0 remain. Unknown audio is not labelled original; unknown quality remains Auto.
