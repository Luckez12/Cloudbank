package com.vueo.shared.core.plugin
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.util.Base64
fun main() {
 fun response(bytes: ByteArray, mime: String) = Response.Builder().request(Request.Builder().url("https://example.com/resource").build()).protocol(Protocol.HTTP_1_1).code(200).message("OK").header("Content-Type", mime).body(bytes.toResponseBody(mime.toMediaType())).build()
 val bytes = ByteArray(4097) { ((it * 37) % 256).toByte() }
 val binary = JSONObject(PluginHttp.encodeResponse(response(bytes, "application/wasm"), "GET", true))
 check(binary.getString("bodyEncoding") == "base64")
 check(!binary.getBoolean("bodyTruncated"))
 check(Base64.getDecoder().decode(binary.getString("body")).contentEquals(bytes))
 val text = "Bahasa Melayu — 日本語"
 val normal = JSONObject(PluginHttp.encodeResponse(response(text.toByteArray(), "text/html; charset=utf-8"), "GET", false))
 check(normal.getString("body") == text)
 check(!normal.has("bodyEncoding"))
 val media = JSONObject(PluginHttp.encodeResponse(response(bytes, "video/mp4"), "GET", true))
 check(media.getString("body").isEmpty())
 val large = JSONObject(PluginHttp.encodeResponse(response(ByteArray(300000), "application/wasm"), "GET", true))
 check(large.getBoolean("bodyTruncated"))
 check(large.getString("body").isEmpty())
 val head = JSONObject(PluginHttp.encodeResponse(response(bytes, "application/wasm"), "HEAD", true))
 check(head.getString("body").isEmpty())
 println("Native binary transport: byte-exact base64, unchanged UTF-8 default, HEAD/media exclusions and 256 KiB bound passed.")
}
