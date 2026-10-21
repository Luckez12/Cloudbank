package com.vueo.shared.core.player

import android.content.Context
import androidx.media3.common.Format
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import com.vueo.shared.core.diagnostics.RuntimeDiagnostics

/** Shared by the renderer thread and UI recovery; no URLs or global codec blacklist are logged. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class VideoDecoderSession(private val platform: String) {
    private var sourceKey: String? = null
    private var generation = 0L
    private var policy = VideoCodecPolicy()
    private val plans = mutableMapOf<String, List<VideoCodecCandidate>>()
    private val initialized = mutableMapOf<String, String>()
    private var lastFailure: Pair<String, String>? = null

    internal data class Plan(val infos: List<MediaCodecInfo>, val generation: Long)

    @Synchronized
    fun beginSource(key: String?) {
        if (sourceKey == key) return
        sourceKey = key
        reset()
    }

    @Synchronized
    internal fun reset() {
        generation++
        policy = VideoCodecPolicy()
        plans.clear()
        initialized.clear()
        lastFailure = null
    }

    private fun key(format: Format): String = listOf(
        format.sampleMimeType, format.codecs, format.width, format.height, format.frameRate,
        format.colorInfo, format.drmInitData?.hashCode(),
    ).joinToString("|")

    private fun description(format: Format): String =
        "mime=${format.sampleMimeType} codecs=${format.codecs} size=${format.width}x${format.height} " +
            "fps=${format.frameRate} color=${format.colorInfo}"

    @Synchronized
    internal fun plan(context: Context, format: Format, infos: List<MediaCodecInfo>): Plan {
        val key = key(format)
        val capabilities = infos.map { info ->
            VideoCodecCandidate(info.name, runCatching { info.isFormatSupported(context, format) }.getOrDefault(false), info.hardwareAccelerated)
        }
        // Bound adaptive-stream bookkeeping. Runtime failures remain scoped to the source session.
        if (plans.size >= 64 && key !in plans) {
            val oldest = plans.keys.first()
            plans.remove(oldest)
            initialized.remove(oldest)
        }
        plans[key] = capabilities
        val ordered = policy.ordered(key, capabilities)
        RuntimeDiagnostics.recordPlayerEvent(platform, "VIDEO_DECODER_PLAN",
            "${description(format)} candidates=" + ordered.joinToString(",") {
                "${it.name}:${if (it.supported) "supported" else "exceeds-or-unsupported"}:${if (it.hardware) "hw" else "sw"}"
            })
        return Plan(ordered.mapNotNull { candidate -> infos.firstOrNull { it.name == candidate.name } }, generation)
    }

    @Synchronized
    internal fun initialized(format: Format, name: String, epoch: Long) {
        if (epoch != generation) return
        initialized[key(format)] = name
        if (lastFailure?.first == key(format)) lastFailure = null
        RuntimeDiagnostics.recordPlayerEvent(platform, "VIDEO_DECODER_SELECTED", "name=$name ${description(format)}")
    }

    @Synchronized
    internal fun failed(format: Format?, name: String?, epoch: Long) {
        if (epoch != generation || format == null || name == null) return
        lastFailure = key(format) to name
    }

    @Synchronized
    internal fun next(format: Format, reportedName: String?): String? {
        val key = key(format)
        val name = reportedName ?: lastFailure?.takeIf { it.first == key }?.second ?: initialized[key]
        val candidates = plans[key].orEmpty()
        val next = policy.next(key, name, candidates)
        RuntimeDiagnostics.recordPlayerEvent(platform,
            if (next == null) "VIDEO_CODEC_EXHAUSTED" else "VIDEO_CODEC_RETRY",
            "failed=${name ?: "unknown"} next=${next ?: "none"} attempts=${policy.attempts} " +
                "supported=${candidates.count { it.supported }} ${description(format)}")
        return next
    }
}
