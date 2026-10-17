# Cloudbank VidSrc.to 1.0.1

Apply at Cloudbank repository root after installing the companion rebuilt VUEO app. Refresh Cloudbank in VUEO. Manifest becomes 1.20.30; VidSrc.to becomes 1.0.1. ZxcStream is excluded and all other providers are preserved. No YAML changes.

One bounded HTML request (1.6-second wait guard) discovers the current iframe. Only the previously observed vsembed.ru host with the exact requested movie or season-episode path is accepted; otherwise the original embed URL is retained. This step lets optional track hooks run on the actual player document, removing the wrapper from browser loading when possible. It is a necessary discovery step for track metadata, not a title search. No source API is guessed. Changing navigation to the inner document still requires real-device verification.

The existing single WebView session stays bounded at 12 seconds. A 700ms finish grace replaces 500ms to allow track metadata. At most two HLS candidates are checked as before. After the first valid playlist, up to eight observed subtitle sidecars are checked concurrently with 1.2-second wait guards. English/Malay/Indonesian metadata is preferred, unknown languages are not guessed. Deduplicates URLs, rejects HTML, empty files and thumbnail sprites; forwards only timed VTT/SRT cue files with per-track headers. HLS subtitle references stay in the original master; HLS subtitle playlists are not flattened. Standalone ASS/TTML are unsupported. Signed subtitle URLs are not cached.

If the app returns no subtitle array, video links can still be returned and diagnostics ask for the companion app patch. No universal Cloudflare bypass or CAPTCHA solver is added. Wait guards cannot cancel in-flight native work.

Run node tests/vidsrc-to-subtitles.cjs and npm run validate.

Validation: JavaScript fixture tests passed; Cloudbank npm run validate passed for all 53 providers. These tests validate routes, bridge hook behavior and timed-text fixtures, not live subtitle playback. Native Android compilation was attempted but blocked before compilation because Gradle could not resolve com.android.application:9.1.1. No Android build success is claimed.

Live status: v1.0.0 video playback was confirmed by the user's Android log. The development network still returns a Cloudflare 403 for the inner player; no live subtitle list or cue timing was observed. Rebuild and test in VUEO to confirm real-site capture and playback. A captured valid cue file can still be wrong-language or out of sync upstream.
