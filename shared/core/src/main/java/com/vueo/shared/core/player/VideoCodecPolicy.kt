package com.vueo.shared.core.player

/** Device capability results, never provider quality labels, decide decoder recovery. */
internal data class VideoCodecCandidate(
    val name: String,
    val supported: Boolean,
    val hardware: Boolean,
)

/** Thread-confined by VideoDecoderSession's lock. State belongs to one source, not the device. */
internal class VideoCodecPolicy(private val maxRecoveries: Int = 2) {
    private val failed = mutableMapOf<String, MutableSet<String>>()
    var attempts: Int = 0
        private set

    fun ordered(key: String, candidates: List<VideoCodecCandidate>): List<VideoCodecCandidate> =
        candidates.distinctBy { it.name }
            .filter { it.name !in failed[key].orEmpty() }
            .sortedWith(compareBy<VideoCodecCandidate> { if (it.supported) 0 else 1 }
                .thenBy { if (it.supported && it.hardware) 0 else 1 })

    /** Never retries the failed decoder for this exact configuration or forces unsupported codecs. */
    fun next(key: String, failedName: String?, candidates: List<VideoCodecCandidate>): String? {
        if (failedName.isNullOrBlank() || candidates.none { it.name == failedName }) return null
        failed.getOrPut(key) { linkedSetOf() }.add(failedName)
        if (attempts >= maxRecoveries) return null
        val next = ordered(key, candidates).firstOrNull { it.supported } ?: return null
        attempts++
        return next.name
    }
}
