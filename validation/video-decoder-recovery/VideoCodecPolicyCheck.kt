package com.vueo.shared.core.player

fun main() {
    var checks = 0
    fun verify(condition: Boolean) { check(condition); checks++ }
    val sw = VideoCodecCandidate("software", supported = true, hardware = false)
    val hw = VideoCodecCandidate("hardware", supported = true, hardware = true)
    val hw2 = VideoCodecCandidate("hardware2", supported = true, hardware = true)
    val exceeds = VideoCodecCandidate("4k-unsupported", supported = false, hardware = true)
    val key = "hevc:main10:3840x2160:hdr10"
    val all = listOf(exceeds, sw, hw, hw2, sw)
    val policy = VideoCodecPolicy()
    verify(policy.ordered(key, all).map { it.name } == listOf("hardware", "hardware2", "software", "4k-unsupported"))
    // A working supported 4K choice stays available; there is no resolution cap or forced AVC.
    verify(policy.ordered(key, listOf(hw)).single() == hw)
    verify(policy.attempts == 0)
    verify(policy.next(key, "hardware", all) == "hardware2")
    verify(policy.attempts == 1)
    verify("hardware" !in policy.ordered(key, all).map { it.name })
    verify(policy.next(key, "hardware2", all) == "software")
    verify(policy.attempts == 2)
    verify(policy.next(key, "software", all) == null)
    verify(policy.ordered(key, all).single() == exceeds)
    verify(policy.next(key, "4k-unsupported", all) == null)
    verify(policy.ordered(key, all).isEmpty())
    // No forced unsupported decoder when a single-track MKV runs out of compatible alternatives.
    verify(VideoCodecPolicy().next(key, "hardware", listOf(hw, exceeds)) == null)
    verify(VideoCodecPolicy().next(key, "hardware", listOf(hw)) == null)
    verify(VideoCodecPolicy().next(key, null, all) == null)
    verify(VideoCodecPolicy().next(key, "unobserved", all) == null)
    verify(VideoCodecPolicy().next(key, "hardware", emptyList()) == null)
    // Failure for one profile never globally blacklists the same codec for other files/formats.
    val scoped = VideoCodecPolicy()
    verify(scoped.next(key, "hardware", all) == "hardware2")
    verify(scoped.ordered("hevc:main8:3840x2160:sdr", all).first() == hw)
    verify(VideoCodecPolicy().ordered(key, all).first() == hw)
    verify(VideoCodecPolicy().next(key, "software", listOf(sw, hw)) == "hardware")
    // Stable native order is retained within each support/hardware bucket.
    verify(VideoCodecPolicy().ordered(key, listOf(hw2, hw)).map { it.name } == listOf("hardware2", "hardware"))
    verify(VideoCodecPolicy().ordered(key, listOf(exceeds)).single() == exceeds)
    println("PASS: $checks video codec policy checks")
}
