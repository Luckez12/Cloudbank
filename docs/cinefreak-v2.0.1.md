# CineFreak 2.0.1 — accept dual and unknown audio

The 2.0.0 policy wrongly excluded dual-audio files even when they included the original language. The user's Moana (TMDB 1108427) log therefore showed an exact title match but zero eligible files.

Updated policy:
- Accept a single original-language label.
- Accept dual/multi audio when the listed languages include TMDB original_language.
- Accept unknown or absent audio labels, including dual audio without a language list.
- Reject explicit language lists that exclude the known original language, and explicit dub-only labels.
- Preserve the actual language list and distinguish dual audio and unknown audio in display fields. Unknown is never described as confirmed original.

The actual Moana page now yields dual-audio candidates (English + Hindi), including 2160p and 1080p. This is a parsing result, not confirmed video discovery or playback. The provider retains the earlier maximum of two quality candidates.

12 fixture checks pass. Minimum 720p, title/year/type/episode checks, pack rejection, hidden-link rejection and HTTP Range/media-signature validation remain active. Container audio tracks are not inspected or rewritten. VUEO can offer the included tracks when playback succeeds; this patch does not force the original track as default.

Live CineCloud accessibility remains unconfirmed; previous tests received HTTP 403. A new host error may appear now that eligible files can reach host extraction. Do not interpret this audio-policy fix as a confirmed host/playback fix.

No VUEO or YML changes. The manifest becomes Cloudbank 1.20.57, CineFreak 2.0.1. If the separate AllMovieLand removal script was applied, run it after applying this ZIP's manifest to preserve that removal.
