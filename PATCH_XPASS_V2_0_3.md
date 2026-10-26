# XPass 2.0.3 — identity conflicts, no media probes

Validate explicit identity in existing decrypted index server records, playlist response objects, playlist items and individual sources. No additional network calls or waiting. Recognized scalar fields: tmdbId/tmdb_id; season/season_number/seasonNumber; episode/episode_number/episodeNumber; bounded metadata/identity objects. Recognize unambiguous SxxEyy and Season N Episode N markers in title/filename/fileName and decoded URL paths. Recognize canonical /movie/ID or /tv/ID/S/E route metadata; preserve the original URL including signatures. Do not treat generic id, season_id, episode_id, quality labels, opaque filenames or signature query text as identity. Do not compare numeric TMDB identifiers to IMDb tt identifiers without mapping.

Reject explicit conflicts only. Filter index entries before playlist request and filter mixed playlist items/sources individually. Keep server racing so mismatching records do not prematurely win. Logs report rejection reason and matched/unknown/rejected object counts. A matching requested server URL is not proof of episode content. Unknown identity remains eligible rather than discarding otherwise valid streams.

No media probes, release-date lookup, inferred release schedule or guessed season fallback. English/Malay subtitle behavior from 2.0.2 retained. This cannot verify an inaccessible or wrongly mapped episode when the API provides only opaque media URLs. User's TMDB126437 S02E05 has not been confirmed fixed: live endpoint request timed out at proxy CONNECT. Logs from device are needed to establish whether that response exposes useful identity metadata.

Validation: authenticated cipher suite, existing movie/TV pipeline and URL shim, delayed/missing/failed subtitles, identity conflicts at root/item/source, mixed playlists, canonical routes, filename markers, signed-query noninspection, unknown identity acceptance, season zero and IMDb handling. All 25 providers validate.

VUEO unchanged. No YAML.
