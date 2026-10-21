package com.vueo.mobile.ui

import com.vueo.shared.core.player.LiveSmartSubs
import android.app.Activity
import android.net.Uri
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.graphics.Typeface
import android.util.TypedValue
import android.os.Build
import android.os.SystemClock
import android.widget.Toast
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SettingsInputComponent
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.media3.ui.PlayerView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.ForwardingRenderer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.text.TextOutput
import androidx.media3.common.C
import androidx.media3.common.AudioAttributes
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.MediaItem as Media3MediaItem
import com.vueo.mobile.core.extensions.AddonCategory
import com.vueo.mobile.core.extensions.ExtensionInstaller
import com.vueo.mobile.core.extensions.primaryAddonCategory
import com.vueo.mobile.core.extensions.ExtensionKind
import com.vueo.mobile.core.extensions.MediaExtension
import com.vueo.mobile.core.extensions.UnifiedMediaEngine
import com.vueo.mobile.core.extensions.SourceRanker
import com.vueo.mobile.core.extensions.SourceDiscoveryCache
import com.vueo.mobile.core.extensions.CatalogDiscoveryCache
import com.vueo.mobile.core.enrichment.MdblistClient
import com.vueo.mobile.core.enrichment.MediaRating
import com.vueo.mobile.core.enrichment.TmdbEnhancementClient
import com.vueo.shared.core.enrichment.ContentWarning
import com.vueo.shared.core.enrichment.ContentWarningRepository
import com.vueo.shared.core.detail.DetailPeoplePolicy
import com.vueo.shared.core.detail.DetailUpstreamPolicy
import com.vueo.shared.core.home.HomeCatalogPolicy
import com.vueo.shared.core.home.HomeRecommendationPolicy
import com.vueo.shared.core.search.DiscoverCatalogPolicy
import com.vueo.shared.core.search.DiscoverSortMode
import com.vueo.shared.core.search.SearchResultOrderPolicy
import com.vueo.shared.core.search.SearchMediaFilter
import com.vueo.shared.core.recommendation.RelatedContentOrchestrator
import com.vueo.shared.core.search.SearchOrchestrator
import com.vueo.shared.core.search.MediaEntityKind
import com.vueo.shared.core.search.MediaEntityTarget
import com.vueo.shared.core.source.SourceDiscoveryEngine
import com.vueo.shared.core.source.SourceDiscoveryRequest
import com.vueo.mobile.core.dna.UserDnaEngine
import com.vueo.mobile.core.dna.UserDnaPreferences
import com.vueo.mobile.core.model.CatalogRow
import com.vueo.mobile.BuildConfig
import com.vueo.mobile.R
import com.vueo.mobile.core.storage.PlaybackStore
import com.vueo.mobile.core.storage.LibraryStore
import com.vueo.mobile.core.storage.ProfileStore
import com.vueo.mobile.core.storage.VueoProfile
import com.vueo.mobile.core.storage.LibraryPlaybackEntry
import com.vueo.mobile.core.storage.PreferredQuality
import com.vueo.mobile.core.storage.PlayerOrientation
import com.vueo.mobile.core.storage.PlayerVideoFit
import com.vueo.mobile.core.storage.SettingsStore
import com.vueo.mobile.core.player.PlayerSkipKind
import com.vueo.mobile.core.player.PlayerSkipRepository
import com.vueo.mobile.core.player.PlayerSkipSegment
import com.vueo.mobile.core.player.PlayerPlaybackPhase
import com.vueo.mobile.core.player.PlayerSourceAssessment
import com.vueo.mobile.core.player.PlayerSourceAudioMatch
import com.vueo.mobile.core.player.PlayerSourcePolicy
import com.vueo.shared.core.player.PlayerTrackPolicy
import com.vueo.mobile.core.player.PlayerSourceRecoverySession
import com.vueo.mobile.core.player.PLAYER_REBUFFER_TIMEOUT_MS
import com.vueo.mobile.core.player.PLAYER_RECOVERY_SOURCE_TIMEOUT_MS
import com.vueo.mobile.core.player.PLAYER_STARTUP_TIMEOUT_MS
import com.vueo.mobile.core.storage.VueoDataMigration
import com.vueo.mobile.core.update.VueoUpdateManager
import com.vueo.mobile.core.model.SubtitleTrack
import com.vueo.mobile.core.plugin.PluginStore
import com.vueo.mobile.core.plugin.ProviderCodeSyncManager
import com.vueo.mobile.core.plugin.ProviderCodeStore
import com.vueo.mobile.core.plugin.ProviderHealthStatus
import com.vueo.mobile.core.plugin.ProviderHealthRecord
import com.vueo.mobile.core.plugin.PluginHealthStore
import com.vueo.mobile.core.plugin.PluginSourceEngine
import com.vueo.mobile.core.plugin.PluginRepositoryDescriptor
import com.vueo.mobile.core.plugin.PluginRepositoryClient
import com.vueo.mobile.core.model.EpisodeItem
import com.vueo.mobile.core.model.MediaCompany
import com.vueo.mobile.core.model.MediaItem
import com.vueo.shared.core.media.MediaTypePolicy
import com.vueo.mobile.core.model.MediaPerson
import com.vueo.mobile.core.model.StreamSource
import com.vueo.mobile.core.storage.AddonStore
import com.vueo.mobile.ui.components.NetworkImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

internal fun PlayerView.applyVueoSubtitleStyle(
    style: PlayerSubtitleStyleState,
    fontScale: Float = 1f,
) {
    subtitleView?.apply {
        setApplyEmbeddedStyles(false)
        setApplyEmbeddedFontSizes(false)
        setFixedTextSize(
            TypedValue.COMPLEX_UNIT_SP,
            style.fontSizeSp.toFloat() *
                fontScale.coerceIn(.35f, 1f),
        )
        setBottomPaddingFraction(
            style.bottomPaddingPercent / 100f
        )
        setStyle(
            CaptionStyleCompat(
                style.textColor,
                if (style.backgroundEnabled) {
                    withSubtitleAlpha(
                        style.backgroundColor,
                        style.backgroundOpacityPercent,
                    )
                } else {
                    android.graphics.Color.TRANSPARENT
                },
                android.graphics.Color.TRANSPARENT,
                if (style.outlineEnabled) {
                    CaptionStyleCompat.EDGE_TYPE_OUTLINE
                } else {
                    CaptionStyleCompat.EDGE_TYPE_NONE
                },
                style.outlineColor,
                com.vueo.shared.core.player.SubtitleFonts.resolve(context, style.fontFamily, style.bold),
            )
        )
    }
}

private fun withSubtitleAlpha(colour: Int, opacityPercent: Int): Int {
    val alpha = (opacityPercent.coerceIn(0, 100) * 255 + 50) / 100
    return (colour and 0x00FFFFFF) or (alpha shl 24)
}

@androidx.annotation.OptIn(
    androidx.media3.common.util.UnstableApi::class
)
internal class VueoSubtitleOffsetRenderersFactory(
    context: Context,
    decoderSession: com.vueo.shared.core.player.VideoDecoderSession,
    internal val subtitleDelayUsProvider: () -> Long,
    internal val shouldNormalizeCuePositionProvider: () -> Boolean,
) : com.vueo.shared.core.player.CompatibleVideoRenderersFactory(context, decoderSession) {

    override fun buildTextRenderers(
        context: Context,
        output: TextOutput,
        outputLooper: android.os.Looper,
        extensionRendererMode: Int,
        out: ArrayList<Renderer>,
    ) {
        val normalizingOutput =
            VueoCueNormalizingTextOutput(
                delegate = output,
                shouldNormalizeCuePositionProvider =
                    shouldNormalizeCuePositionProvider,
            )
        val firstTextRenderer = out.size
        super.buildTextRenderers(
            context,
            normalizingOutput,
            outputLooper,
            extensionRendererMode,
            out,
        )
        for (index in firstTextRenderer until out.size) {
            out[index] = VueoSubtitleOffsetRenderer(
                baseRenderer = out[index],
                subtitleDelayUsProvider = subtitleDelayUsProvider,
            )
        }
    }
}

internal class VueoCueNormalizingTextOutput(
    internal val delegate: TextOutput,
    internal val shouldNormalizeCuePositionProvider: () -> Boolean,
) : TextOutput {
    override fun onCues(cueGroup: CueGroup) {
        delegate.onCues(
            CueGroup(
                cueGroup.cues.map(::normalizeCuePosition),
                cueGroup.presentationTimeUs,
            )
        )
    }

    @Deprecated(
        "Uses a deprecated player callback for text outputs."
    )
    override fun onCues(cues: List<Cue>) {
        delegate.onCues(
            cues.map(::normalizeCuePosition)
        )
    }

    internal fun normalizeCuePosition(cue: Cue): Cue {
        if (
            !shouldNormalizeCuePositionProvider() ||
            cue.bitmap != null ||
            cue.verticalType != Cue.TYPE_UNSET ||
            cue.line == Cue.DIMEN_UNSET
        ) {
            return cue
        }

        return cue.buildUpon()
            .setLine(
                Cue.DIMEN_UNSET,
                Cue.TYPE_UNSET,
            )
            .setLineAnchor(Cue.TYPE_UNSET)
            .build()
    }
}

internal class VueoSubtitleOffsetRenderer(
    baseRenderer: Renderer,
    internal val subtitleDelayUsProvider: () -> Long,
) : ForwardingRenderer(baseRenderer) {
    override fun render(
        positionUs: Long,
        elapsedRealtimeUs: Long,
    ) {
        val subtitlePositionUs =
            (positionUs - subtitleDelayUsProvider())
                .coerceAtLeast(0L)
        super.render(
            subtitlePositionUs,
            elapsedRealtimeUs,
        )
    }
}

@Composable
internal fun PlayerFullscreenEffect(
    context: android.content.Context,
    orientation: PlayerOrientation,
) {
    DisposableEffect(
        context,
        orientation,
    ) {
        val activity = context as? Activity
        val window = activity?.window
        val decor = window?.decorView
        val previousFlags =
            decor?.systemUiVisibility ?: 0
        val previousOrientation =
            activity?.requestedOrientation
                ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

        activity?.requestedOrientation =
            when (orientation) {
                PlayerOrientation.AUTO,
                PlayerOrientation.LANDSCAPE ->
                    ActivityInfo
                        .SCREEN_ORIENTATION_SENSOR_LANDSCAPE

                PlayerOrientation.PORTRAIT ->
                    ActivityInfo
                        .SCREEN_ORIENTATION_SENSOR_PORTRAIT

                PlayerOrientation.FOLLOW_DEVICE ->
                    ActivityInfo
                        .SCREEN_ORIENTATION_UNSPECIFIED
            }

        if (Build.VERSION.SDK_INT >= 30) {
            window?.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior =
                    WindowInsetsController
                        .BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            decor?.systemUiVisibility =
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }

        onDispose {
            activity?.requestedOrientation =
                previousOrientation

            if (Build.VERSION.SDK_INT >= 30) {
                window?.insetsController?.show(
                    WindowInsets.Type.systemBars()
                )
            } else {
                decor?.systemUiVisibility =
                    previousFlags
            }
        }
    }
}

internal data class PlayerTrackChoice(
    val key: String,
    val label: String,
    val override:
        TrackSelectionOverride?,
    val selected: Boolean,
    val language: String?,
    val sourceLabel: String,
    val metadata: String?,
    val selectionId: String,
    val externalSubtitle: SubtitleTrack? = null,
)

/**
 * External subtitles are discovered independently from ExoPlayer's track
 * timeline. Keep them visible in the workspace as soon as discovery publishes
 * them, even if ExoPlayer has not exposed the matching text group yet.
 *
 * A provisional choice has no override. Selection code resolves it back to a
 * real player track before applying it.
 */
internal fun mergeDiscoveredSubtitleChoices(
    playerChoices: List<PlayerTrackChoice>,
    discoveredSubtitles: List<SubtitleTrack>,
): List<PlayerTrackChoice> {
    val knownSelectionIds =
        playerChoices
            .asSequence()
            .map { it.selectionId }
            .toMutableSet()
    val result = playerChoices.toMutableList()

    discoveredSubtitles.forEach { subtitle ->
        val selectionId =
            PlayerTrackPolicy.externalSubtitleSelectionId(subtitle)
        if (
            !subtitle.url.startsWith("https://") ||
            !knownSelectionIds.add(selectionId)
        ) {
            return@forEach
        }

        result +=
            PlayerTrackChoice(
                key = "discovered:$selectionId",
                label =
                    subtitle.name
                        ?.takeIf { it.isNotBlank() }
                        ?: friendlySubtitleLanguageName(subtitle.language),
                override = null,
                selected = false,
                language = subtitle.language,
                sourceLabel =
                    PlayerTrackPolicy.subtitleProviderLabel(subtitle)
                        .takeIf { it.isNotBlank() }
                        ?: "External",
                metadata = PlayerTrackPolicy.subtitleDisplayId(subtitle),
                selectionId = selectionId,
                externalSubtitle = subtitle,
            )
    }

    return result
}

internal const val PLAYER_SUBTITLE_LABEL_PREFIX =
    PlayerTrackPolicy.SUBTITLE_LABEL_PREFIX

internal const val PLAYER_SUBTITLE_OFF =
    PlayerTrackPolicy.SUBTITLE_OFF

internal const val PLAYER_SUBTITLE_LANGUAGE_PREFIX =
    PlayerTrackPolicy.SUBTITLE_LANGUAGE_PREFIX

internal const val PLAYER_AUDIO_AUTO =
    PlayerTrackPolicy.AUDIO_AUTO

internal fun playerPreferredSubtitleLanguageCode(
    settingsStore: SettingsStore,
): String? {
    val lastSelection = settingsStore.lastSubtitleSelection()
    return lastSelection
        ?.takeIf {
            it.startsWith(
                PLAYER_SUBTITLE_LANGUAGE_PREFIX
            )
        }
        ?.removePrefix(
            PLAYER_SUBTITLE_LANGUAGE_PREFIX
        )
        ?: settingsStore
            .preferredSubtitleLanguage()
            .languageCode
}

internal fun playerSubtitlesEnabledAtStart(
    settingsStore: SettingsStore,
): Boolean =
    when (val lastSelection = settingsStore.lastSubtitleSelection()) {
        PLAYER_SUBTITLE_OFF -> false
        null -> settingsStore.subtitlesOnByDefault()
        else ->
            lastSelection.startsWith(
                PLAYER_SUBTITLE_LANGUAGE_PREFIX
            ) || settingsStore.subtitlesOnByDefault()
    }

internal fun playerTrackChoices(
    tracks: Tracks,
    trackType: Int,
    externalSubtitles: Map<String, SubtitleTrack> = emptyMap(),
): List<PlayerTrackChoice> {
    val result =
        mutableListOf<
            PlayerTrackChoice
        >()

    tracks.groups.forEachIndexed {
        groupIndex,
        group ->

        if (
            group.type !=
            trackType
        ) {
            return@forEachIndexed
        }

        for (
            trackIndex in
            0 until group.length
        ) {
            if (
                !group.isTrackSupported(
                    trackIndex
                )
            ) {
                continue
            }

            val format =
                group.getTrackFormat(
                    trackIndex
                )

            val externalSubtitle =
                format.id?.let(externalSubtitles::get)
                    ?: format.label
                        ?.removePrefix(
                            PLAYER_SUBTITLE_LABEL_PREFIX
                        )
                        ?.takeIf {
                            format.label?.startsWith(
                                PLAYER_SUBTITLE_LABEL_PREFIX
                            ) == true
                        }
                        ?.let(externalSubtitles::get)
            val trackLanguage =
                externalSubtitle?.language
                    ?: format.language
                    ?: format.label
                        ?.trim()
                        ?.takeIf { it.length in 2..3 }
            val label = if (
                trackType == C.TRACK_TYPE_TEXT
            ) {
                externalSubtitle?.name
                    ?.takeIf { it.isNotBlank() }
                    ?: friendlySubtitleLanguageName(
                        trackLanguage
                    )
            } else {
                buildAudioTrackLabel(
                    formatLabel = format.label,
                    language = format.language,
                    fallbackIndex = result.size + 1,
                )
            }
            val selectionId = if (
                externalSubtitle != null
            ) {
                PlayerTrackPolicy.externalSubtitleSelectionId(externalSubtitle)
            } else if (trackType == C.TRACK_TYPE_AUDIO) {
                buildAudioSelectionId(
                    language = trackLanguage,
                    formatLabel = format.label,
                    channelCount = format.channelCount,
                    sampleMimeType = format.sampleMimeType,
                    trackId = format.id,
                )
            } else {
                PlayerTrackPolicy.builtinSubtitleSelectionId(
                    language = trackLanguage,
                    formatLabel = format.label,
                    trackId = format.id,
                    groupIndex = groupIndex,
                    trackIndex = trackIndex,
                )
            }

            result +=
                PlayerTrackChoice(
                    key =
                        "$groupIndex:" +
                            trackIndex,
                    label = label,
                    override =
                        TrackSelectionOverride(
                            group.mediaTrackGroup,
                            trackIndex,
                        ),
                    selected =
                        group
                            .isTrackSelected(
                                trackIndex
                            ),
                    language = trackLanguage,
                    sourceLabel =
                        externalSubtitle?.let(PlayerTrackPolicy::subtitleProviderLabel)
                            ?: "Built-in",
                    metadata = if (trackType == C.TRACK_TYPE_AUDIO) {
                        buildAudioTrackMetadata(
                            formatLabel = format.label,
                            channelCount = format.channelCount,
                            sampleMimeType = format.sampleMimeType,
                        )
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

internal fun buildAudioTrackLabel(
    formatLabel: String?,
    language: String?,
    fallbackIndex: Int,
): String =
    PlayerTrackPolicy.audioTrackLabel(
        formatLabel = formatLabel,
        language = language,
        fallbackIndex = fallbackIndex,
    )

internal fun buildAudioTrackMetadata(
    formatLabel: String?,
    channelCount: Int,
    sampleMimeType: String?,
): String =
    PlayerTrackPolicy.audioTrackMetadata(
        formatLabel = formatLabel,
        channelCount = channelCount,
        sampleMimeType = sampleMimeType,
    )

internal fun buildAudioSelectionId(
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

internal fun findSavedAudioTrack(
    tracks: List<PlayerTrackChoice>,
    savedSelection: String?,
): PlayerTrackChoice? {
    if (savedSelection.isNullOrBlank()) return null
    tracks.firstOrNull {
        it.selectionId == savedSelection
    }?.let { return it }

    val savedLanguage = savedSelection
        .split(':')
        .getOrNull(1)
        ?.takeIf { it.isNotBlank() && it != "und" }
        ?: return null
    return tracks.firstOrNull {
        canonicalSubtitleLanguage(it.language) == savedLanguage
    }
}

@Composable
internal fun PlayerTrackDialogRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(
                onClick = onClick
            ),
        shape = RoundedCornerShape(14.dp),
        color = if (selected) {
            VueoPlayerAccent.copy(alpha = .12f)
        } else {
            Color.White.copy(alpha = .035f)
        },
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (selected) {
                VueoPlayerAccent.copy(alpha = .42f)
            } else {
                Color.White.copy(alpha = .07f)
            },
        ),
    ) {
        Row(
            modifier = Modifier.padding(
                horizontal = 13.dp,
                vertical = 11.dp,
            ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(18.dp)
                    .clip(CircleShape)
                    .border(
                        1.dp,
                        if (selected) {
                            VueoPlayerAccent
                        } else {
                            Color.White.copy(alpha = .36f)
                        },
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (selected) {
                    Box(
                        modifier = Modifier
                            .size(9.dp)
                            .clip(CircleShape)
                            .background(VueoPlayerAccent),
                    )
                }
            }

            Spacer(Modifier.width(10.dp))

            Text(
                label,
                color = Color.White.copy(
                    alpha = if (selected) .96f else .76f
                ),
                fontSize = 12.sp,
                fontWeight = if (selected) {
                    FontWeight.SemiBold
                } else {
                    FontWeight.Normal
                },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

internal fun applyTrackChoice(
    player: ExoPlayer,
    trackType: Int,
    choice: PlayerTrackChoice,
) {
    val trackOverride = choice.override ?: return
    if (trackType == C.TRACK_TYPE_TEXT) {
        if (LiveSmartSubs.select(player, trackOverride)) return
        LiveSmartSubs.clear(player)
    }
    player.trackSelectionParameters =
        player
            .trackSelectionParameters
            .buildUpon()
            .setTrackTypeDisabled(
                trackType,
                false,
            )
            .clearOverridesOfType(
                trackType
            )
            .setOverrideForType(
                trackOverride
            )
            .build()
}

internal fun clearTrackOverride(
    player: ExoPlayer,
    trackType: Int,
    disable: Boolean,
) {
    if (trackType == C.TRACK_TYPE_TEXT) LiveSmartSubs.clear(player)
    player.trackSelectionParameters =
        player
            .trackSelectionParameters
            .buildUpon()
            .clearOverridesOfType(
                trackType
            )
            .setTrackTypeDisabled(
                trackType,
                disable,
            )
            .build()
}

internal fun PlayerVideoFit.toMedia3ResizeMode(): Int =
    when (this) {
        PlayerVideoFit.FIT ->
            AspectRatioFrameLayout.RESIZE_MODE_FIT
        PlayerVideoFit.FILL ->
            AspectRatioFrameLayout.RESIZE_MODE_FILL
        PlayerVideoFit.ZOOM ->
            AspectRatioFrameLayout.RESIZE_MODE_ZOOM
    }
