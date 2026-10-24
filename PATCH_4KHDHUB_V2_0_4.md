# 4KHDHub 2.0.4 — English and Malay subtitle allowlist

Apply at repository root and refresh provider. No YAML. Includes prior 2.0.3 changes and authorized CineVibe/CineMode manifest removal.

Only English (en/eng/English, including regional codes) and Malay (ms/msa/may/Malay/Bahasa Melayu/Melayu, including regional codes) external subtitle tracks are forwarded. Other languages and unidentified und tracks are rejected. Incomplete metadata cannot be used to invent a language. A track with language=und and a usable lang or recognized label can still be identified. If the single track in the earlier device log remains unidentified, the new policy intentionally forwards zero subtitles. This does not manufacture missing English/Malay captions or confirm their content is playable. The app can separately expose embedded HLS tracks; this provider allowlist governs its external subtitles payload.

Tests include en metadata recovery, ms-MY normalization, WebVTT/SubRip MIME, rejection of Indonesian, Hindi, Japanese, French and und, plus existing Watch and download regressions. All pass; repository validates 25 providers. No additional requests or waits are added. Device subtitle cue delivery remains unverified.
