# KShow123 1.0.1 — episode metadata fallback

Fixes the early zero-result path seen for TMDB 33238 S01 E821: v1.0.0 required ep.air_date before any KShow123 search. The app log shows this field was unavailable, although a direct TMDB request returned episode 821 with air_date 2026-10-04. The exact reason for the app response difference is not established.

Missing, failed or show-shaped episode metadata now permits exact site discovery. A TMDB air date is trusted only when season_number and episode_number match the request. Exact TMDB title alias, selected site season and episode page title/number are required. S01 uses the requested episode number. Later explicitly numbered site seasons use that season's number; continuous later seasons require complete counts for preceding regular seasons. Conflicting available air dates still reject the result (one day tolerance for timezone labels). Missing air-date comparison is stated honestly in the log.

Tests passed using the current real KShow123 E821/search HTML and a live encrypted player API response: no date, show-shaped payload, HTTP 404 fallback, wrong-title rejection, conflicting-date rejection, continuous numbering, AES extraction and intro.vtt exclusion. Repository validation passed for 51 providers. These tests do not verify Android playback or server availability. The live API POST succeeded with HTTP 200 using the site AJAX headers (now included). CDN playback remains unverified.

Apply ZIP at repository root. Contains manifest.json, providers/kshow123.js and this note only. No workflow changes. Repository version: 1.20.21; provider version: 1.0.1.
