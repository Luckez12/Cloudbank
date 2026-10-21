# Decoder recovery checks

These standalone checks live outside Android source sets. Do not copy the diagnostics stub into src/main.

Pure policies, using Kotlin/JVM 2.3.21 and Java 17:

```sh
kotlinc shared/core/src/main/java/com/vueo/shared/core/player/VideoCodecPolicy.kt validation/video-decoder-recovery/VideoCodecPolicyCheck.kt -include-runtime -d /tmp/vueo-codec-policy.jar
java -jar /tmp/vueo-codec-policy.jar
kotlinc shared/core/src/main/java/com/vueo/shared/core/player/VideoFallbackPolicy.kt validation/video-decoder-recovery/VideoFallbackPolicyTest.kt -include-runtime -d /tmp/vueo-track-policy.jar
java -jar /tmp/vueo-track-policy.jar
```

For VideoDecoderRecoveryJvmCheck, compile VideoCodecPolicy, VideoFallbackPolicy, VideoDecoderSession and VideoDecoderRecovery with the validation diagnostics stub and the test file, against the real Media3 1.11.0 common/exoplayer/container/decoder/datasource/extractor JARs, Android API signatures, Guava and AndroidX annotation/annotation-experimental. Run com.vueo.shared.core.player.VideoDecoderRecoveryJvmCheckKt with those libraries on the JVM classpath. The test injects capability snapshots using reflection and substitutes only the Player calls and diagnostics sink; it does not instantiate an Android codec or claim device support.

Expected counts: 23 codec-policy, 16 track-policy, 17 recovery checks. Device tests and a full Android build are still required.
