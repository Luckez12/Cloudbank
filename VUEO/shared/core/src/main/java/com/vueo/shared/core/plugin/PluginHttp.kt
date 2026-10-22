package com.vueo.shared.core.plugin

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.dnsoverhttps.DnsOverHttps
import org.json.JSONObject
import okio.Buffer
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/** Shared native networking for repository downloads and the future QuickJS fetch bridge. */
object PluginHttp {
    private val bootstrapClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(12, TimeUnit.SECONDS)
            .build()
    }

    private val doh: Dns by lazy {
        DnsOverHttps.Builder()
            .client(bootstrapClient)
            .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
            .bootstrapDnsHosts(
                InetAddress.getByName("1.1.1.1"),
                InetAddress.getByName("1.0.0.1"),
            )
            .includeIPv6(false)
            .build()
    }

    private val resilientDns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> =
            try {
                Dns.SYSTEM.lookup(hostname).ifEmpty {
                    throw UnknownHostException("System DNS returned no addresses for $hostname")
                }
            } catch (systemError: UnknownHostException) {
                try {
                    doh.lookup(hostname)
                } catch (dohError: UnknownHostException) {
                    dohError.addSuppressed(systemError)
                    throw dohError
                }
            }
    }

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .dns(resilientDns)
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(12, TimeUnit.SECONDS)
            .callTimeout(18, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .build()
    }

    private val manualRedirectClient: OkHttpClient by lazy {
        client.newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    suspend fun getText(url: String): String = withContext(Dispatchers.IO) {
        requireHttps(url)
        val request = Request.Builder()
            .url(url)
            .header("Accept", "*/*")
            .header("User-Agent", "VUEO/0.9.6")
            .build()

        executeResponse(client, request) { response ->
            if (!response.isSuccessful) {
                error("HTTP ${response.code} from ${response.request.url.host}")
            }
            readBoundedText(response, MAX_PROVIDER_SCRIPT_BYTES)
        }
    }

    suspend fun executeJson(requestJson: String): String = withContext(Dispatchers.IO) {
        runCatching {
            val input = JSONObject(requestJson)
            // Generic opt-in transport for small binary resources (e.g. public
            // WASM modules). Existing text and large-media behavior stays intact.
            val binaryResponse = input.optString("responseEncoding") == "base64"
            val url = input.optString("url")
            requireHttps(url)
            rejectLocalAddress(url)

            val method = input.optString("method", "GET").uppercase()
            val requestBuilder = Request.Builder().url(url)
            val headers = input.optJSONObject("headers")
            if (headers != null) {
                val iterator = headers.keys()
                while (iterator.hasNext()) {
                    val key = iterator.next()
                    if (key.lowercase() in BLOCKED_REQUEST_HEADERS) continue
                    val value = headers.optString(key)
                    if (value.isNotBlank()) requestBuilder.header(key, value)
                }
            }
            if (headers?.has("User-Agent") != true) {
                requestBuilder.header("User-Agent", "VUEO/0.9.6")
            }

            val bodyText = if (input.isNull("body")) null else input.optString("body")
            val body = bodyText?.toRequestBody(
                input.optString("contentType")
                    .takeIf { it.isNotBlank() }
                    ?.toMediaTypeOrNull()
            )

            when (method) {
                "GET" -> requestBuilder.get()
                "HEAD" -> requestBuilder.head()
                "POST" -> requestBuilder.post(body ?: ByteArray(0).toRequestBody())
                "PUT" -> requestBuilder.put(body ?: ByteArray(0).toRequestBody())
                "PATCH" -> requestBuilder.patch(body ?: ByteArray(0).toRequestBody())
                "DELETE" -> if (body != null) requestBuilder.delete(body) else requestBuilder.delete()
                else -> requestBuilder.method(method, body)
            }

            val requestClient = if (input.optString("redirect", "follow") == "manual") {
                manualRedirectClient
            } else {
                client
            }

            executeResponse(requestClient, requestBuilder.build()) { response ->
                encodeResponse(response, method, binaryResponse)
            }
        }.getOrElse { error ->
            if (error is CancellationException) throw error
            JSONObject()
                .put("error", error.message ?: error::class.java.simpleName)
                .toString()
        }
    }

    internal fun encodeResponse(response: Response, method: String, binaryResponse: Boolean): String {
        val responseHeaders = JSONObject()
        response.headers.names().forEach { name ->
            responseHeaders.put(name, response.headers.values(name).joinToString(", "))
        }

        /*
         * Providers often fetch a URL only to inspect status, headers
         * or redirects. Never copy an entire direct media/download
         * response into the Java heap. Normal scraper text remains
         * available, bounded to protect a 256 MB process.
         */
        val responseBody = response.body
        val mediaType = responseBody.contentType()
        val contentType = mediaType?.toString().orEmpty().lowercase()
        val declaredLength = responseBody.contentLength()

        val textualResponse =
            contentType.isBlank() ||
                contentType.startsWith("text/") ||
                "json" in contentType ||
                "javascript" in contentType ||
                "xml" in contentType ||
                "mpegurl" in contentType

        val oversizedBody =
            declaredLength > (if (binaryResponse) MAX_PLUGIN_BINARY_RESPONSE_BYTES else MAX_PLUGIN_RESPONSE_BODY_BYTES)

        val skipBody =
            method == "HEAD" ||
                contentType.startsWith("video/") ||
                contentType.startsWith("audio/") ||
                (oversizedBody && !textualResponse)

        var bodyTruncated =
            oversizedBody && method != "HEAD"

        val responseText =
            if (skipBody) {
                ""
            } else {
                val source = responseBody.source()
                val buffer = Buffer()
                var remaining = if (binaryResponse) MAX_PLUGIN_BINARY_RESPONSE_BYTES else MAX_PLUGIN_RESPONSE_BODY_BYTES

                while (remaining > 0L) {
                    val read =
                        source.read(
                            buffer,
                            minOf(
                                HTTP_READ_CHUNK_BYTES,
                                remaining,
                            ),
                        )
                    if (read == -1L) break
                    remaining -= read
                }

                if (remaining == 0L) {
                    bodyTruncated = true
                }

                if (binaryResponse) {
                    buffer.readByteString().base64()
                } else {
                    buffer.readString(
                        mediaType?.charset(Charsets.UTF_8)
                            ?: Charsets.UTF_8
                    )
                }
            }

        return JSONObject()
            .put("status", response.code)
            .put("statusText", response.message)
            .put("url", response.request.url.toString())
            .put("body", responseText)
            .put("bodyTruncated", bodyTruncated)
            .put("headers", responseHeaders)
            .apply { if (binaryResponse) put("bodyEncoding", "base64") }
            .toString()
    }

    // Process the body on OkHttp's worker, keeping cancellation attached until
    // decoding completes. Closing the active response also interrupts body reads.
    private suspend fun executeResponse(
        requestClient: OkHttpClient,
        request: Request,
        decode: (Response) -> String,
    ): String = suspendCancellableCoroutine { continuation ->
        val call = requestClient.newCall(request)
        val activeResponse = AtomicReference<Response?>(null)
        continuation.invokeOnCancellation {
            call.cancel()
            activeResponse.getAndSet(null)?.close()
        }
        if (!continuation.isActive) return@suspendCancellableCoroutine
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                if (continuation.isActive) continuation.resumeWithException(error)
            }

            override fun onResponse(call: Call, response: Response) {
                activeResponse.set(response)
                try {
                    response.use {
                        if (!continuation.isActive) return
                        val value = decode(response)
                        if (continuation.isActive) continuation.resume(value)
                    }
                } catch (error: Exception) {
                    if (continuation.isActive) continuation.resumeWithException(error)
                } finally {
                    activeResponse.compareAndSet(response, null)
                }
            }
        })
    }

    internal const val MAX_PROVIDER_SCRIPT_BYTES = 8L * 1024L * 1024L

    private fun readBoundedText(
        response: Response,
        limit: Long,
    ): String {
        val body = response.body
        require(body.contentLength() <= limit) {
            "Provider script exceeds the 8 MiB size limit."
        }
        val buffer = Buffer()
        val source = body.source()
        var remaining = limit + 1L
        while (remaining > 0L) {
            val count = source.read(buffer, minOf(HTTP_READ_CHUNK_BYTES, remaining))
            if (count == -1L) break
            remaining -= count
        }
        require(buffer.size <= limit) { "Provider script exceeds the 8 MiB size limit." }
        return buffer.readString(body.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8)
    }

    private fun requireHttps(url: String) {
        require(url.startsWith("https://", ignoreCase = true)) {
            "Plugin network access only allows HTTPS."
        }
    }

    private fun rejectLocalAddress(url: String) {
        val host = url.toHttpUrl().host
        val addresses = resilientDns.lookup(host)
        require(addresses.none(::isPrivateAddress)) {
            "Plugin network access cannot reach local/private addresses."
        }
    }

    private fun isPrivateAddress(address: InetAddress): Boolean {
        if (
            address.isAnyLocalAddress ||
            address.isLoopbackAddress ||
            address.isLinkLocalAddress ||
            address.isSiteLocalAddress
        ) return true

        val bytes = address.address
        if (bytes.size == 4) {
            val first = bytes[0].toInt() and 0xFF
            val second = bytes[1].toInt() and 0xFF
            if (first == 100 && second in 64..127) return true
        }
        if (bytes.size == 16) {
            val first = bytes[0].toInt() and 0xFF
            if (first == 0xFC || first == 0xFD) return true
        }
        return false
    }

    private const val MAX_PLUGIN_RESPONSE_BODY_BYTES =
        4L * 1024L * 1024L

    private const val MAX_PLUGIN_BINARY_RESPONSE_BYTES =
        256L * 1024L

    private const val HTTP_READ_CHUNK_BYTES =
        32L * 1024L

    private val BLOCKED_REQUEST_HEADERS = setOf(
        "host",
        "content-length",
        "connection",
        "accept-encoding",
    )
}
