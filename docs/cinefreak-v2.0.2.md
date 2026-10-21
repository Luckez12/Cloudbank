# CineFreak 2.0.2 — restore extensionless links and diagnose host stage

The device log for VisionQuest S01E01 confirmed the title/year/type match and two eligible episode files. Five HTTP requests and no media checks indicate that host HTML extraction produced no direct media candidates. This is separate from the corrected audio filter.

The rebuilt parser had omitted upstream support for extensionless links on workers.dev, r2.dev, cloudflarestorage.com, .buzz and pub-* storage hosts. This version restores those candidate patterns while retaining mandatory HTTP 206 Range and MKV/MP4 signature validation. An iframe or normal player page is never treated as a media URL.

New logs report each host attempt, response content type, final origin, visible/hidden anchor counts, iframe count, blocked/challenge indicators, distinct link hostnames, extracted candidate count and media probe attempts. Queries, file codes and signed URLs are not printed by these new diagnostics.

14 fixture checks pass, including extensionless storage extraction and diagnostic token redaction. The user's exact CineCloud file page returned HTTP 403 in the external test environment, so its current on-device HTML and playback are not confirmed. This is a targeted extraction correction plus a diagnostic build, not a claim of confirmed playback. If it still returns no results, send the new HOST_PAGE and HOST_EXTRACT log lines.

The audio policy from 2.0.1 remains: original audio, dual/multi containing original, and unknown are accepted. Explicit dub-only/non-original language lists are rejected when identifiable. Minimum 720p, exact episode selection and pack rejection remain active.

Cloudbank manifest 1.20.58; CineFreak 2.0.2. No VUEO/YML changes. Apply the separate AllMovieLand removal script after this manifest if preserving that earlier removal.
