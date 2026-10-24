# Viduki v1.0.6

Upload providers/viduki.js and manifest.json to matching paths. No YML.

Strict subtitle allowlist: English (en) and Malay (ms), including regional tags. Normalize aliases before filtering. Every other language and unknown language is rejected BEFORE subtitle file fetching. No fallback to Indonesian, Albanian or other languages. If English/Malay are absent or fail cue validation, return video without subtitles. Maximum two candidates per allowed language, four total. Discovery cancellation, no-extra-wait behavior and video extraction from v1.0.5 remain unchanged.

Tests cover allowed regional tags/aliases, non-English/Malay rejection, mixed candidate ordering, subtitle cue/MIME validation, exact routes and cancellation/late responses. Device playback/rendering requires testing.
