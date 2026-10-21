package com.vueo.shared.core.player

import android.content.Context
import android.os.Handler
import androidx.media3.common.Format
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener

/** Retains the subtitle factories and Media3's secure/Dolby Vision base-layer selection rules. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
open class CompatibleVideoRenderersFactory(
    context: Context,
    private val decoderSession: VideoDecoderSession,
) : DefaultRenderersFactory(context) {
    init { setEnableDecoderFallback(true) }

    override fun buildVideoRenderers(
        context: Context,
        extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector,
        enableDecoderFallback: Boolean,
        eventHandler: Handler,
        eventListener: VideoRendererEventListener,
        allowedVideoJoiningTimeMs: Long,
        out: ArrayList<Renderer>,
    ) {
        val first = out.size
        super.buildVideoRenderers(context, extensionRendererMode, mediaCodecSelector,
            enableDecoderFallback, eventHandler, eventListener, allowedVideoJoiningTimeMs, out)
        // Preserve extension renderer ordering; replace only the platform video renderer.
        val index = (first until out.size).firstOrNull { out[it] is MediaCodecVideoRenderer } ?: return
        val builder = MediaCodecVideoRenderer.Builder(context)
            .setCodecAdapterFactory(getCodecAdapterFactory())
            .setMediaCodecSelector(mediaCodecSelector)
            .setAllowedJoiningTimeMs(allowedVideoJoiningTimeMs)
            .setEnableDecoderFallback(true)
            .setEventHandler(eventHandler)
            .setEventListener(eventListener)
            .setMaxDroppedFramesToNotify(MAX_DROPPED_VIDEO_FRAME_COUNT_TO_NOTIFY)
        out[index] = CompatibleVideoRenderer(context.applicationContext, builder, decoderSession)
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
private class CompatibleVideoRenderer(
    private val appContext: Context,
    builder: MediaCodecVideoRenderer.Builder,
    private val session: VideoDecoderSession,
) : MediaCodecVideoRenderer(builder) {
    private var queriedFormat: Format? = null
    private var epoch = -1L

    override fun getDecoderInfos(
        mediaCodecSelector: MediaCodecSelector,
        format: Format,
        requiresSecureDecoder: Boolean,
    ): List<MediaCodecInfo> {
        // Super resolves secure/tunneling and compatible Dolby Vision base-layer codecs first.
        val native = super.getDecoderInfos(mediaCodecSelector, format, requiresSecureDecoder)
        val plan = session.plan(appContext, format, native)
        queriedFormat = format
        epoch = plan.generation
        return plan.infos
    }

    override fun onCodecInitialized(
        name: String,
        configuration: MediaCodecAdapter.Configuration,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        super.onCodecInitialized(name, configuration, initializedTimestampMs, initializationDurationMs)
        session.initialized(configuration.format, name, epoch)
    }

    override fun onCodecError(codecError: Exception) {
        val name = (codecError as? MediaCodecDecoderException)?.codecInfo?.name ?: getCodecInfo()?.name
        session.failed(queriedFormat, name, epoch)
        super.onCodecError(codecError)
    }
}
