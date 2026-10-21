package com.vueo.tv.player

import com.vueo.shared.core.player.LiveSmartSubs
import android.content.Context
import android.os.Looper
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.SpannedString
import androidx.media3.common.C
import androidx.media3.common.text.Cue
import androidx.media3.exoplayer.ForwardingRenderer
import androidx.media3.exoplayer.Renderer
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.text.TextOutput
import com.vueo.shared.core.language.LanguagePolicy
import com.vueo.shared.core.media.SubtitleTrack
import com.vueo.shared.core.player.PlayerTrackPolicy

internal const val TV_SUBTITLE_OFF = PlayerTrackPolicy.SUBTITLE_OFF
internal const val TV_SUBTITLE_LANGUAGE_PREFIX = PlayerTrackPolicy.SUBTITLE_LANGUAGE_PREFIX
internal const val TV_AUDIO_AUTO = PlayerTrackPolicy.AUDIO_AUTO
private const val TV_SUBTITLE_LABEL_PREFIX = PlayerTrackPolicy.SUBTITLE_LABEL_PREFIX

internal data class TvPlayerTrackChoice(
    val key: String,
    val label: String,
    val override: TrackSelectionOverride?,
    val selected: Boolean,
    val language: String?,
    val sourceLabel: String,
    val metadata: String?,
    val selectionId: String,
    val externalSubtitle: SubtitleTrack? = null,
)

internal data class TvSubtitleLanguageGroup(
    val code: String,
    val label: String,
    val tracks: List<TvPlayerTrackChoice>,
)

internal data class TvPlayerSubtitleStyleState(
    val fontFamily: String = "default",
    val fontSizeSp: Int = 26,
    val commentaryFontSizeSp: Int = 26,
    val bold: Boolean = false,
    val showCommentary: Boolean = true,
    val textColor: Int = 0xFFFFFFFF.toInt(),
    val outlineEnabled: Boolean = true,
    val outlineColor: Int = 0xFF000000.toInt(),
    val backgroundEnabled: Boolean = false,
    val backgroundColor: Int = 0xFF000000.toInt(),
    val backgroundOpacityPercent: Int = 60,
    val bottomPaddingPercent: Int = 8,
)

internal fun tvExternalSubtitleSelectionId(track: SubtitleTrack): String =
    PlayerTrackPolicy.externalSubtitleSelectionId(track)

internal fun tvExternalSubtitleLabel(track: SubtitleTrack): String =
    PlayerTrackPolicy.externalSubtitleLabel(track)

/**
 * Subtitle discovery can finish before Media3 publishes matching text TrackGroups.
 * Keep those external tracks visible in the TV workspace immediately, then resolve
 * the provisional entry back to a real override when the user selects it.
 */
internal fun tvMergeDiscoveredSubtitleChoices(
    playerChoices: List<TvPlayerTrackChoice>,
    discoveredSubtitles: List<SubtitleTrack>,
): List<TvPlayerTrackChoice> {
    val knownSelectionIds = playerChoices.asSequence().map { it.selectionId }.toMutableSet()
    val result = playerChoices.toMutableList()

    discoveredSubtitles.forEach { subtitle ->
        val selectionId = tvExternalSubtitleSelectionId(subtitle)
        if (!subtitle.url.startsWith("https://") || !knownSelectionIds.add(selectionId)) {
            return@forEach
        }
        result += TvPlayerTrackChoice(
            key = "discovered:$selectionId",
            label = subtitle.name?.takeIf { it.isNotBlank() } ?: tvFriendlyLanguage(subtitle.language),
            override = null,
            selected = false,
            language = subtitle.language,
            sourceLabel = PlayerTrackPolicy.subtitleProviderLabel(subtitle).takeIf { it.isNotBlank() } ?: "External",
            metadata = PlayerTrackPolicy.subtitleDisplayId(subtitle),
            selectionId = selectionId,
            externalSubtitle = subtitle,
        )
    }
    return result
}

internal fun tvPlayerTrackChoices(
    tracks: Tracks,
    trackType: Int,
    externalSubtitles: Map<String, SubtitleTrack> = emptyMap(),
): List<TvPlayerTrackChoice> {
    val result = mutableListOf<TvPlayerTrackChoice>()

    tracks.groups.forEachIndexed { groupIndex, group ->
        if (group.type != trackType) return@forEachIndexed

        for (trackIndex in 0 until group.length) {
            if (!group.isTrackSupported(trackIndex)) continue
            val format = group.getTrackFormat(trackIndex)
            val externalSubtitle =
                format.id?.let(externalSubtitles::get)
                    ?: format.label
                        ?.removePrefix(TV_SUBTITLE_LABEL_PREFIX)
                        ?.takeIf { format.label?.startsWith(TV_SUBTITLE_LABEL_PREFIX) == true }
                        ?.let(externalSubtitles::get)
            val trackLanguage =
                externalSubtitle?.language
                    ?: format.language
                    ?: format.label?.trim()?.takeIf { it.length in 2..3 }
            val selectionId = when {
                externalSubtitle != null -> tvExternalSubtitleSelectionId(externalSubtitle)
                trackType == C.TRACK_TYPE_AUDIO -> tvBuildAudioSelectionId(
                    language = trackLanguage,
                    formatLabel = format.label,
                    channelCount = format.channelCount,
                    sampleMimeType = format.sampleMimeType,
                    trackId = format.id,
                )
                else -> PlayerTrackPolicy.builtinSubtitleSelectionId(
                    language = trackLanguage,
                    formatLabel = format.label,
                    trackId = format.id,
                    groupIndex = groupIndex,
                    trackIndex = trackIndex,
                )
            }
            val label = if (trackType == C.TRACK_TYPE_TEXT) {
                externalSubtitle?.name?.takeIf { it.isNotBlank() }
                    ?: tvFriendlyLanguage(trackLanguage)
            } else {
                tvBuildAudioTrackLabel(format.label, format.language, result.size + 1)
            }
            result += TvPlayerTrackChoice(
                key = "$groupIndex:$trackIndex",
                label = label,
                override = TrackSelectionOverride(group.mediaTrackGroup, trackIndex),
                selected = group.isTrackSelected(trackIndex),
                language = trackLanguage,
                sourceLabel = externalSubtitle?.let(PlayerTrackPolicy::subtitleProviderLabel) ?: if (trackType == C.TRACK_TYPE_TEXT) "Built-in" else "Stream",
                metadata = if (trackType == C.TRACK_TYPE_AUDIO) {
                    tvBuildAudioTrackMetadata(format.label, format.channelCount, format.sampleMimeType)
                } else {
                    externalSubtitle
                        ?.let { PlayerTrackPolicy.subtitleDisplayId(it) }
                        ?: PlayerTrackPolicy.subtitleDisplayId(format.id)
                },
                selectionId = selectionId,
                externalSubtitle = externalSubtitle,
            )
        }
    }

    return result
}

internal fun tvBuildSubtitleLanguageGroups(
    tracks: List<TvPlayerTrackChoice>,
    preferredLanguageCode: String?,
    secondaryLanguageCode: String?,
): List<TvSubtitleLanguageGroup> {
    val preferred = preferredLanguageCode?.let(::tvCanonicalLanguage)
    val secondary = secondaryLanguageCode?.let(::tvCanonicalLanguage)

    return tracks
        .groupBy { tvCanonicalLanguage(it.language) }
        .map { (code, groupedTracks) ->
            TvSubtitleLanguageGroup(
                code = code,
                label = tvFriendlyLanguage(code),
                tracks = groupedTracks,
            )
        }
        .sortedWith(
            compareBy<TvSubtitleLanguageGroup> {
                when (it.code) {
                    preferred -> 0
                    secondary -> 1
                    "und" -> 3
                    else -> 2
                }
            }.thenBy { it.label.lowercase() }
        )
}

internal fun tvFindSavedAudioTrack(
    tracks: List<TvPlayerTrackChoice>,
    savedSelection: String?,
): TvPlayerTrackChoice? {
    if (savedSelection.isNullOrBlank()) return null
    tracks.firstOrNull { it.selectionId == savedSelection }?.let { return it }
    val savedLanguage = savedSelection.split(':').getOrNull(1)
        ?.takeIf { it.isNotBlank() && it != "und" }
        ?: return null
    return tracks.firstOrNull { tvCanonicalLanguage(it.language) == savedLanguage }
}

internal fun tvApplyTrackChoice(
    player: androidx.media3.exoplayer.ExoPlayer,
    trackType: Int,
    choice: TvPlayerTrackChoice,
) {
    val trackOverride = choice.override ?: return
    if (trackType == C.TRACK_TYPE_TEXT) {
        if (LiveSmartSubs.select(player, trackOverride)) return
        LiveSmartSubs.clear(player)
    }
    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
        .setTrackTypeDisabled(trackType, false)
        .clearOverridesOfType(trackType)
        .setOverrideForType(trackOverride)
        .build()
}

internal fun tvClearTrackOverride(
    player: androidx.media3.exoplayer.ExoPlayer,
    trackType: Int,
    disable: Boolean,
) {
    if (trackType == C.TRACK_TYPE_TEXT) LiveSmartSubs.clear(player)
    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
        .clearOverridesOfType(trackType)
        .setTrackTypeDisabled(trackType, disable)
        .build()
}

internal fun tvCanonicalLanguage(value: String?): String =
    LanguagePolicy.canonicalOrUnknown(value)

internal fun tvFriendlyLanguage(value: String?): String =
    LanguagePolicy.friendlyName(value)

private fun tvBuildAudioTrackLabel(
    formatLabel: String?,
    language: String?,
    fallbackIndex: Int,
): String =
    PlayerTrackPolicy.audioTrackLabel(
        formatLabel = formatLabel,
        language = language,
        fallbackIndex = fallbackIndex,
    )

private fun tvBuildAudioTrackMetadata(
    formatLabel: String?,
    channelCount: Int,
    sampleMimeType: String?,
): String =
    PlayerTrackPolicy.audioTrackMetadata(
        formatLabel = formatLabel,
        channelCount = channelCount,
        sampleMimeType = sampleMimeType,
    )

private fun tvBuildAudioSelectionId(
    language: String?,
    formatLabel: String?,
    channelCount: Int,
    sampleMimeType: String?,
    trackId: String?,
): String =
    PlayerTrackPolicy.audioSelectionId(
        language = language,
        formatLabel = formatLabel,
        channelCount = channelCount,
        sampleMimeType = sampleMimeType,
        trackId = trackId,
    )

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class TvSubtitleOffsetRenderersFactory(
    context: Context,
    decoderSession: com.vueo.shared.core.player.VideoDecoderSession,
    private val subtitleDelayUsProvider: () -> Long,
) : com.vueo.shared.core.player.CompatibleVideoRenderersFactory(context, decoderSession) {

    override fun buildTextRenderers(
        context: Context,
        output: TextOutput,
        outputLooper: Looper,
        extensionRendererMode: Int,
        out: ArrayList<Renderer>,
    ) {
        val firstTextRenderer = out.size
        super.buildTextRenderers(
            context,
            output,
            outputLooper,
            extensionRendererMode,
            out,
        )
        for (index in firstTextRenderer until out.size) {
            out[index] = TvSubtitleOffsetRenderer(
                baseRenderer = out[index],
                subtitleDelayUsProvider = subtitleDelayUsProvider,
            )
        }
    }
}

/** Stack simultaneous lower-screen captions even when their horizontal metadata differs.
 * Commentary classification is owned by TvSubtitlePlayerView using the global v101
 * full-parentheses rule. This helper only combines cues within the layer it receives.
 * No timing, subtitle offset, bitmap or vertical-caption metadata is changed.
 */
internal fun tvStackCollidingSubtitleCues(cues: List<Cue>): List<Cue> {
    if (cues.isEmpty()) return emptyList()
    val orderedGroups = mutableListOf<MutableList<Cue>>()
    val groups = linkedMapOf<TvSubtitlePlacement, MutableList<Cue>>()
    val bottomGroup = mutableListOf<Cue>()
    for (cue in cues) {
        if (cue.bitmap != null || cue.verticalType != Cue.TYPE_UNSET || cue.text.isNullOrBlank()) {
            orderedGroups.add(mutableListOf(cue))
            continue
        }
        if (tvIsBottomSubtitleCue(cue)) {
            if (bottomGroup.isEmpty()) orderedGroups.add(bottomGroup)
            bottomGroup.add(cue)
            continue
        }
        val placement = TvSubtitlePlacement(
            line = cue.line,
            lineType = if (cue.line == Cue.DIMEN_UNSET) Cue.TYPE_UNSET else cue.lineType,
            lineAnchor = if (cue.line == Cue.DIMEN_UNSET) Cue.TYPE_UNSET else cue.lineAnchor,
            position = cue.position,
            positionAnchor = cue.positionAnchor,
            size = cue.size,
            alignment = cue.textAlignment,
            multiRowAlignment = cue.multiRowAlignment,
            shearDegrees = cue.shearDegrees,
        )
        groups.getOrPut(placement) { mutableListOf<Cue>().also { orderedGroups.add(it) } }.add(cue)
    }

    return orderedGroups.mapNotNull { group ->
        val unique = group.distinctBy { it.text.toString() }
        when {
            group === bottomGroup -> tvBuildBottomSubtitleCue(unique)
            unique.size == 1 -> unique.first()
            else -> {
                val builder = unique.first().buildUpon()
                val text = SpannableStringBuilder()
                unique.forEachIndexed { index, item ->
                    if (index > 0) text.append('\n')
                    text.append(requireNotNull(item.text))
                }
                builder.setText(SpannedString(text)).build()
            }
        }
    }
}

private fun tvBuildBottomSubtitleCue(cues: List<Cue>): Cue {
    val unique = cues.distinctBy { it.text.toString() }
    val seed = unique.first()
    val text = SpannableStringBuilder()
    unique.forEachIndexed { index, item ->
        if (index > 0) text.append('\n')
        text.append(requireNotNull(item.text))
    }
    return seed.buildUpon()
        .setText(SpannedString(text))
        .setLine(Cue.DIMEN_UNSET, Cue.TYPE_UNSET)
        .setLineAnchor(Cue.TYPE_UNSET)
        .setPosition(Cue.DIMEN_UNSET)
        .setPositionAnchor(Cue.TYPE_UNSET)
        .setSize(Cue.DIMEN_UNSET)
        .setTextAlignment(Layout.Alignment.ALIGN_CENTER)
        .setMultiRowAlignment(Layout.Alignment.ALIGN_CENTER)
        .build()
}

private fun tvIsBottomSubtitleCue(cue: Cue): Boolean = when {
    cue.line == Cue.DIMEN_UNSET -> true
    cue.lineType == Cue.LINE_TYPE_FRACTION -> cue.line >= .70f
    cue.lineType == Cue.LINE_TYPE_NUMBER -> cue.line in -3f..-1f
    else -> false
}

private data class TvSubtitlePlacement(
    val line: Float,
    val lineType: Int,
    val lineAnchor: Int,
    val position: Float,
    val positionAnchor: Int,
    val size: Float,
    val alignment: Layout.Alignment?,
    val multiRowAlignment: Layout.Alignment?,
    val shearDegrees: Float,
)

private class TvSubtitleOffsetRenderer(
    baseRenderer: Renderer,
    private val subtitleDelayUsProvider: () -> Long,
) : ForwardingRenderer(baseRenderer) {
    override fun render(positionUs: Long, elapsedRealtimeUs: Long) {
        val subtitlePositionUs = (positionUs - subtitleDelayUsProvider()).coerceAtLeast(0L)
        super.render(subtitlePositionUs, elapsedRealtimeUs)
    }
}
