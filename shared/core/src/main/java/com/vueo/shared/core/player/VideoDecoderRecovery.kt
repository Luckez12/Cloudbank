package com.vueo.shared.core.player

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import com.vueo.shared.core.diagnostics.RuntimeDiagnostics

/** Bounded codec then track recovery per source; failed decoder/configuration pairs stay excluded. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class VideoDecoderRecovery(private val decoderSession: VideoDecoderSession) {
    private var policy = VideoFallbackPolicy()

    fun reset() {
        policy = VideoFallbackPolicy()
        decoderSession.reset()
    }

    private fun isVideoDecoderError(error: PlaybackException, format: Format?): Boolean =
        format?.sampleMimeType?.startsWith("video/") == true &&
            error.errorCode in setOf(
                PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
                PlaybackException.ERROR_CODE_DECODING_FAILED,
                PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
                PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            )

    private fun snapshot(format: Format) = VideoFallbackFormat(
        format.sampleMimeType, format.codecs, format.width, format.height, format.frameRate,
    )

    private data class Candidate(val group: Tracks.Group, val index: Int, val format: Format)

    fun tryRecover(player: Player, error: PlaybackException, failedFormat: Format?, platform: String, resumePositionMs: Long = 0L): Boolean {
        if (!isVideoDecoderError(error, failedFormat)) return false
        val failed = failedFormat ?: return false
        val codecName = generateSequence(error as Throwable) { it.cause }
            .take(8)
            .filterIsInstance<androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException>()
            .firstOrNull()?.codecInfo?.name
        // Media3 already exhausts initialization fallback. Manual recovery is for later failures.
        val decoder = if (error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED) {
            null
        } else {
            decoderSession.next(failed, codecName)
        }
        if (decoder != null) {
            val position = player.currentPosition.coerceAtLeast(resumePositionMs).coerceAtLeast(0L)
            val shouldPlay = player.playWhenReady
            // stop() releases the failed renderer/codec; prepare() rebuilds its candidate list.
            // The MediaItem, request headers and track selection parameters are retained.
            player.stop()
            player.seekTo(position)
            player.prepare()
            player.playWhenReady = shouldPlay
            RuntimeDiagnostics.recordPlayerEvent(platform, "VIDEO_DECODER_RECOVERY",
                "route=codec next=$decoder positionMs=$position")
            return true
        }
        val candidates = player.currentTracks.groups
            .filter { it.type == C.TRACK_TYPE_VIDEO }
            .flatMap { group ->
                (0 until group.length).mapNotNull { index ->
                    val format = group.getTrackFormat(index)
                    if (group.isTrackSupported(index)) Candidate(group, index, format) else null
                }
            }
        val nextIndex = policy.next(snapshot(failed), candidates.map { snapshot(it.format) })
        val next = nextIndex?.let(candidates::get)
        if (next == null) {
            RuntimeDiagnostics.recordPlayerEvent(platform, "VIDEO_DECODER_EXHAUSTED", "trackAttempts=${policy.attempts} alternatives=${candidates.size}")
            return false
        }
        val position = player.currentPosition.coerceAtLeast(resumePositionMs).coerceAtLeast(0L)
        val shouldPlay = player.playWhenReady
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .setOverrideForType(TrackSelectionOverride(next.group.mediaTrackGroup, next.index))
            .build()
        RuntimeDiagnostics.recordPlayerEvent(
            platform, "VIDEO_DECODER_RECOVERY",
            "attempt=${policy.attempts} from=${failed.sampleMimeType}/${failed.width}x${failed.height} to=${next.format.sampleMimeType}/${next.format.width}x${next.format.height} positionMs=$position",
        )
        // Keep the existing media item, headers, audio/subtitle selections and resume position.
        player.seekTo(position)
        player.prepare()
        player.playWhenReady = shouldPlay
        return true
    }

    fun failureMessage(error: PlaybackException, format: Format?): String? {
        if (!isVideoDecoderError(error, format)) return null
        val codec = when (format?.sampleMimeType) {
            "video/hevc" -> "HEVC/H.265"
            "video/avc" -> "H.264"
            "video/dolby-vision" -> "Dolby Vision"
            else -> "this video format"
        }
        return "This device could not decode $codec from this source. No compatible video fallback succeeded. Try another source."
    }
}
