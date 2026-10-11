# PlayIMDb original display — 1.20.3

All registered providers use the original PlayIMDb layout:

```text
🟡 Provider | 720p HD | English-Audio
🎬 Movie Title - 2026
💎 720P | 🌍 English
🎞️ M3U8 | ⏱️ 90 min | 📌 Server 1
```

Series use `🎬 Series Title - S1E2 (2026)`. Unavailable title, quality,
audio, format and duration are omitted. Server numbers are list positions when
no source server name exists. Quality and audio come from provider output;
they are never inferred from a provider's catalog language. Movie runtime is
TMDB metadata, not a measurement of the video file. No new network requests.
PlayIMDb itself retains its original upstream output, including its defaults.

Only name/title presentation changes. Playback URLs, headers, subtitles,
settings, mapping repairs, enabled flags and provider registrations are kept.
The formatter is embedded because the app downloads standalone provider files.
Run `python3 scripts/embed_stream_display.py` after changing its source.
