package com.vueo.shared.core.diagnostics
object RuntimeDiagnostics {
    val events = mutableListOf<String>()
    fun recordPlayerEvent(platform: String, event: String, details: String) { events += "$platform $event $details" }
}
