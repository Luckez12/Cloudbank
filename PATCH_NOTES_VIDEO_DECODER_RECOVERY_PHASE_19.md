# VUEO Phase 19 — video decoder recovery (Mobile + TV)

Apply the files at the repository root, then rebuild/install the Mobile or TV app. This is an app patch, not a Cloudbank provider patch. No YML, deletion script or resolution cap is included.

Baseline: VUEO-NEXT-main (55), with the Phase 17 frame-continuity and Phase 18 live SmartSubs updates applied. Full MobilePlayer/TvPlayerScreen replacements retain those updates. Nine production files change; validation files are optional.

## Result

The old recovery path could only switch video tracks within a file. A single-track MKV could immediately log attempts=0 alternatives=0 even when another decoder might work. Media3 decoder-initialization fallback was already enabled; this patch adds bounded recovery from later decoding failures.

The shared renderer queries the actual format using Media3 1.11.0, ranks fully supported hardware decoders ahead of supported software, and records profile/codecs, dimensions, colour metadata and selected decoder. It delegates native secure/tunneling and Dolby Vision base-layer decisions to Media3. It never changes Dolby Vision bytes or simply relabels them as HEVC.

After a runtime video-decoder failure, try up to two other decoders that Media3 reports as supporting that exact configuration. Exclude the failed decoder/configuration pair, release the failed renderer with stop(), seek to the saved position, prepare the same MediaItem and preserve playWhenReady. Request headers and track-selection parameters remain attached to the same player/item. Initialization fallback that Media3 already exhausted is not replayed manually.

If codec recovery is exhausted, retain the existing supported-video-track fallback, then hand the failure to the existing source recovery path. Automatic source switching continues to obey the user's Auto Source Recovery setting and existing resume-position/budget rules. Failed decoder state belongs to one source, not all movies or the device. Switching source or explicitly pressing Retry starts fresh. All 4K choices remain available.

## Diagnostic events

- VIDEO_DECODER_PLAN: actual input format and candidate support/hardware status.
- VIDEO_DECODER_SELECTED: actual selected decoder plus input format/colour information.
- VIDEO_CODEC_RETRY / VIDEO_CODEC_EXHAUSTED: decoder recovery outcome and bounded attempt count.
- VIDEO_DECODER_RECOVERY route=codec: the retry decoder and resume position.
- VIDEO_DECODER_EXHAUSTED trackAttempts=…: the separate existing video-track recovery count.

No source URLs, authorization headers or signed media queries are added to these events.

## Validation

56 checks passed: 23 codec-policy checks, 16 existing video-track policy checks, and 17 recovery control-flow JVM checks. The latter use real Media3 Format/Player/PlaybackException APIs, a fake Player, injected device-capability snapshots and a diagnostics capture stub; they do not run a physical Android decoder. They verify stop/seek/prepare order, saved position, paused/playing state, no media-item replacement, exhausted recovery, manual reset, source isolation, stale callbacks, and no retries for network errors or already-exhausted initialization fallback.

The production decoder/session/recovery classes and extracted unchanged subtitle factory bodies for Mobile/TV were compiled with Kotlin 2.3.21 against the real Media3 1.11.0 binaries. Only the diagnostics sink was substituted. One pre-existing deprecated subtitle callback warning remains.

A complete Gradle/APK build was not run: this environment has no Android SDK. Hardware playback remains unverified. Rebuild both clients, then test the working Masterplan 4K source, a previously failing 4K/Dolby Vision source, paused playback recovery and another source. Share the new debug/performance log. A file still needs another source when no available decoder can support its format.

## Source reference

[Media3 DefaultRenderersFactory](https://developer.android.com/reference/androidx/media3/exoplayer/DefaultRenderersFactory) documents initialization fallback. The pinned 1.11.0 source JARs were used to verify the protected renderer APIs and full-format capability methods used here.
