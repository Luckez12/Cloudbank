# KissKH 1.4.1 — subtitle and metadata polish

- Filter sidecars to recognized English/Malay codes or labels before the task cap, subtitle-text fetch and decryption. Deduplicate accepted URLs. Unknown, Indonesian, Arabic and other languages are excluded. Recognize common regional two-letter subtags without treating ms-ind as Malay. Explicit recognized language codes take precedence over contradictory display labels.
- Set subtitle language/lang to en/ms, keep readable labels and existing format, emit text/vtt, application/x-subrip or text/x-ssa as appropriate. Decrypted/plain TXT retains SRT MIME and existing conversion behavior.
- Stop guessing quality from numbers in media URL paths. Quality remains Auto because the current resolver does not retain trustworthy resolution metadata. Original master URL is unchanged.
- Include actual HTTP response status alongside stage, host and elapsed milliseconds in diagnostics. This does not establish the source of the prior app summary HTTP494 and makes no app-side changes.

Search, matching, cache, key generation, video endpoint, playback URLs/headers, concurrent video/subtitle flow and conditional key fallback unchanged. No network requests added; rejected subtitle TXT files avoid fetch/decryption work. Existing embedded tracks in the media are outside the provider sidecar filter. No claim of measured speed gain.

Validation: 48 KissKH checks including cold/warm request counts, no TXT requests for discarded languages, canonical EN/MS/MIME, encrypted/plain subtitle handling, URL quality inference removal, true HTTP status logging, exact-season/title matching, keys, timeout/fallback and concurrent requests. All 25 providers validate. Device playback not retested. VUEO unchanged. No YAML.
