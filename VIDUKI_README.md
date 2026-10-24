# Viduki v1.0.3

Upload providers/viduki.js and manifest.json to matching repo paths. No YML or app patch.

This revision retains the v1.0.2 WebView capture path that returned raw=1 accepted=1 on the device. It removes all provider HTTP GET/HEAD rechecks of the captured video CDN URL. That duplicate check previously timed out at 1800ms and discarded the result. The player now receives the exact captured URL and playback headers using the same handoff pattern as Mapple/VidFast. Browser website session setup and internal server fallback still take time; there is no fixed scan-time guarantee.

Explicit captured HTTP errors, non-media content types, negative observation evidence, known resolutions below 720p and explicit dub-only metadata remain rejected. Basic bridge results may omit observation fields; detailed bridge results must contain positive evidence. Unknown quality remains Auto and unknown audio stays unlabelled. Without fetching a master again, this revision cannot inspect its advertised rendition heights. It does not claim HTTP verification of basic bridge URLs or successful device playback.

Website subtitle endpoint is fetched and cue-validated concurrently with WebView. Session/selected-row subtitle candidates are combined, deduplicated and validated together. Only actual VTT/SRT cues are forwarded with language, MIME and captured headers. A maximum of four native subtitle candidates is checked concurrently with a 2200ms bound. No blank/HTML sidecars are passed. Missing subtitles do not invalidate video.

Tests use controlled bridge fixtures and forbid any HTTP call to the video CDN. They cover basic/detailed bridge evidence, captured HTTP errors/non-media, explicit low quality/dub-only, exact movie/TV routes, subtitle MIME/language, VTT/SRT and empty/HTML subtitle rejection. Android playback and subtitle rendering remain unverified for this revision.
