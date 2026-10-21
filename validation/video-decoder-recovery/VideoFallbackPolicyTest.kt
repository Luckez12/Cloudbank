package com.vueo.shared.core.player

private fun hevc(width: Int = 2592, height: Int = 1080, codecs: String = "hvc1.1.6.L150.90") =
    VideoFallbackFormat("video/hevc", codecs, width, height, 24f)
private fun avc(width: Int = 1920, height: Int = 1080) =
    VideoFallbackFormat("video/avc", "avc1.640028", width, height, 24f)

fun main() {
    var checks = 0
    fun verify(value: Boolean) { check(value); checks++ }
    val failed = hevc()
    // Reproduce the logged ultrawide HEVC failure; prefer compatible H.264.
    verify(VideoFallbackPolicy().next(failed, listOf(failed, hevc(1280, 720), avc())) == 2)
    // Prefer full HD over 4K, without forcing all successful playback to H.264.
    verify(VideoFallbackPolicy().next(failed, listOf(avc(3840, 2160), avc(1280, 720), avc())) == 2)
    verify(VideoFallbackPolicy().next(failed, listOf(hevc(1280, 720))) == 0)
    verify(VideoFallbackPolicy().next(failed, listOf(failed)) == null)
    verify(VideoFallbackPolicy().next(failed, emptyList()) == null)
    verify(VideoFallbackPolicy().next(failed, listOf(hevc(3840, 2160))) == null)
    verify(VideoFallbackPolicy().next(failed, listOf(hevc(-1, -1))) == null)
    val session = VideoFallbackPolicy()
    val smaller = hevc(1280, 720)
    verify(session.next(failed, listOf(failed, smaller)) == 1)
    // Failed configurations stay excluded even when a later failure has another codec.
    verify(session.next(smaller, listOf(failed, smaller, avc())) == 2)
    verify(session.next(avc(), listOf(failed, smaller, avc())) == null)
    verify(VideoFallbackPolicy().next(failed, listOf(smaller)) == 0) // independent source
    val bounded = VideoFallbackPolicy()
    var current = failed
    for (width in listOf(1920, 1280, 960)) {
        val next = hevc(width, 540)
        verify(bounded.next(current, listOf(next)) == 0)
        current = next
    }
    verify(bounded.next(current, listOf(hevc(640, 360))) == null)
    verify(bounded.attempts == 3)
    println("PASS: $checks video fallback policy checks")
}
