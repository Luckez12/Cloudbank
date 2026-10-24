# Viduki v1.0.2

Upload providers/viduki.js and manifest.json to the matching repo paths. No YML, no app change.

Based on working repo patterns:
- Mapple/VidFast: basic bridge can omit observation flags; detailed responses or explicitly negative observation fields require positive native evidence.
- VidSrc.to: one exact TMDB WebView, viewport/play interactions, 500ms first-candidate grace, HLS HTTP content verification. No media-readiness wait and no JSON API response capture.
- Preserve Viduki website internal server fallback and parallel website subtitle retrieval/validation. No cross-API sweep or separate direct-API session.

Capture log reports raw and accepted candidate counts, bridge version, known finish reason, filter rejection counters and limited video diagnostics. Basic bridge candidates still require a successful HTTP playlist check. Invalid HTTP statuses, HTML, invalid playlists, known low quality and explicit dub-only are rejected. Only a maximum of two candidates are checked; each fetch plus body read has an 1800ms bound.

Subtitle cue validation and normalized language/MIME from v1.0.1 retained. Empty/HTML subtitles are discarded; missing subtitles do not invalidate video. Unknown audio remains unlabelled. Adaptive/unknown resolution may remain Auto.

Validation: controlled bridge tests cover absent evidence flags on basic and detailed bridges, explicit negative evidence, captured HTTP error, playlist HTTP error/HTML, invalid/low playlist, VTT/SRT language/MIME, empty/HTML subtitles, movie/TV identity and invalid input. No Android playback or speed claim for this version. Prior log did not include raw count; this is a compatible fix and diagnostic improvement, not proof that missing flags caused that specific failure.
