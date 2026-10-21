package com.vueo.tv.player

import com.vueo.shared.core.player.LiveSmartSubs
import com.vueo.shared.core.player.SubtitleFlowDiagnostics
import com.vueo.shared.core.diagnostics.PerformanceDiagnostics
import com.vueo.shared.core.diagnostics.PerformanceDiagnostics.Tab
import com.vueo.shared.core.player.PlayerSourceDisplay

import android.graphics.Typeface
import android.net.Uri
import android.os.SystemClock
import android.view.KeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.List
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.vueo.shared.core.enrichment.ContentWarning
import com.vueo.shared.core.enrichment.ContentWarningRepository
import com.vueo.shared.core.enrichment.TmdbEnhancementClient
import com.vueo.shared.core.media.EpisodeItem
import com.vueo.shared.core.media.MediaItem as VueoMediaItem
import com.vueo.shared.core.media.StreamSource
import com.vueo.shared.core.media.SubtitleTrack
import com.vueo.shared.core.player.PlayerTrackPolicy
import com.vueo.shared.core.player.PlayerSubtitleUpdatePolicy
import com.vueo.shared.core.player.SubtitleReadinessProbe
import com.vueo.shared.core.player.SubtitleSessionCache
import com.vueo.shared.core.player.SubtitleSessionDataSource
import com.vueo.shared.core.player.SubtitleFormat
import com.vueo.shared.core.player.SubtitleFormatPolicy
import com.vueo.shared.core.player.PlayerSkipPolicy
import com.vueo.shared.core.player.PlayerSkipRepository
import com.vueo.shared.core.player.PlayerSkipSegment
import com.vueo.shared.core.player.PlayerSourcePolicy
import com.vueo.shared.core.source.SOURCE_RECOVERY_SOURCE_TIMEOUT_MS
import com.vueo.shared.core.source.SOURCE_REBUFFER_TIMEOUT_MS
import com.vueo.shared.core.source.SOURCE_STARTUP_TIMEOUT_MS
import com.vueo.shared.core.source.SourceCandidate
import com.vueo.shared.core.source.SourceRecoverySession
import com.vueo.shared.core.source.SourceSelector
import com.vueo.shared.core.storage.PlayerVideoFit
import com.vueo.shared.core.storage.SubtitleVisibility
import com.vueo.tv.core.TvRuntime
import com.vueo.tv.core.TvSourceBundle
import com.vueo.tv.ui.TvDesign
import com.vueo.tv.ui.motion.TvMotion
import com.vueo.tv.ui.motion.tvPanelEnter
import com.vueo.tv.ui.motion.tvPanelExit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal enum class TvPlayerPanel {
    NONE,
    SUBTITLES,
    AUDIO,
    SOURCES,
    EPISODES,
    MORE,
}

internal data class TvPlayerOption(
    val key: String,
    val title: String,
    val meta: String? = null,
    val selected: Boolean = false,
    val enabled: Boolean = true,
    val providerName: String? = null,
    val qualityLabel: String? = null,
    val playbackFailed: Boolean = false,
)

// Persistence launched from this scope survives the Player composable leaving the tree.
// That lets Back/navigation happen immediately instead of waiting for JSON history writes.
private val tvPlayerPersistenceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
private val tvPlayerCleanupScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
private val tvPlayerPersistenceMutex = Mutex()

private fun enqueueTvPlayerPersistence(
    block: () -> Unit,
    afterPersist: (() -> Unit)? = null,
) {
    tvPlayerPersistenceScope.launch {
        tvPlayerPersistenceMutex.withLock {
            block()
        }
        afterPersist?.let { callback ->
            withContext(Dispatchers.Main.immediate) {
                callback()
            }
        }
    }
}

@Composable
fun TvPlayerScreen(
    runtime: TvRuntime,
    media: VueoMediaItem,
    episode: EpisodeItem?,
    bundle: TvSourceBundle,
    bundleState: State<TvSourceBundle?>,
    source: StreamSource,
    initialPositionMs: Long,
    playerSessionId: Int,
    onBack: () -> Unit,
    sourcesSearching: Boolean = false,
    pluginsStopped: Boolean = false,
    onRefreshSources: () -> Unit = {},
    sourcesStopped: Boolean = false,
    onStopSources: () -> Unit = {},
    onRefreshSubtitles: suspend () -> Int = { 0 },
    onLibraryChanged: () -> Unit,
    onPlayNextEpisode: (EpisodeItem, StreamSource) -> Unit = { _, _ -> },
    onPrefetchNextEpisode: (EpisodeItem, StreamSource) -> Unit = { _, _ -> },
    onValidateNextEpisodePrefetch: suspend (EpisodeItem, StreamSource, Int) -> Unit = { _, _, _ -> },
    onActiveSourceChanged: (StreamSource) -> Unit = {},
    episodeSwitching: Boolean = false,
    onEpisodeFrameReady: () -> Unit = {},
    onEpisodePlaybackFailed: (String) -> Unit = {},
) {
    val latestEpisodeSwitching = androidx.compose.runtime.rememberUpdatedState(episodeSwitching)
    val latestEpisodeFrameReady = androidx.compose.runtime.rememberUpdatedState(onEpisodeFrameReady)
    val latestEpisodePlaybackFailed = androidx.compose.runtime.rememberUpdatedState(onEpisodePlaybackFailed)
    val context = LocalContext.current
    if (!com.vueo.shared.core.profile.KidsContentPolicy.allows(media.certification, runtime.profileStore.kidsAgeLimit())) {
        androidx.activity.compose.BackHandler(onBack = onBack)
        androidx.compose.foundation.layout.Column(
            modifier = Modifier.fillMaxSize().background(Color.Black),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        ) {
            androidx.compose.material3.Text("This title is unavailable for this Kids profile.", color = Color.White)
            androidx.compose.material3.Button(onClick = onBack) { androidx.compose.material3.Text("Back") }
        }
        return
    }

    val lifecycleOwner = context as? LifecycleOwner
    val rootRequester = remember { FocusRequester() }
    val restartRequester = remember { FocusRequester() }
    val progressRequester = remember { FocusRequester() }
    val nextRequester = remember { FocusRequester() }
    val subtitlesRequester = remember { FocusRequester() }
    val subtitleWorkspaceRequester = remember { FocusRequester() }
    val audioRequester = remember { FocusRequester() }
    val sourcesRequester = remember { FocusRequester() }
    val episodesRequester = remember { FocusRequester() }
    val moreRequester = remember { FocusRequester() }
    val skipRequester = remember { FocusRequester() }
    val nextContextRequester = remember { FocusRequester() }
    val errorRequester = remember { FocusRequester() }

    val mediaKey = "${media.type}:${media.id}:${bundle.videoId}"
    val settings = runtime.settingsStore

    val minimumResumePositionMs = if (episode != null) 0L else 5_000L
    val savedPosition = remember(mediaKey) { runtime.playbackStore.positionMs(mediaKey) }
    // If Back just captured a newer cursor, Details may still hold the previous
    // persisted position for a few milliseconds. The process-local cursor wins
    // regardless of whether playback moved forward or was deliberately rewound.
    val liveSessionSnapshot = runtime.playbackStore.sessionSnapshot(mediaKey)
    val startPosition =
        when {
            liveSessionSnapshot != null -> liveSessionSnapshot.resumePositionMs
            initialPositionMs > minimumResumePositionMs -> initialPositionMs
            settings.resumePlaybackEnabled() && savedPosition > minimumResumePositionMs -> savedPosition
            else -> 0L
        }

    val playableSources = remember(bundle.sources, source.url) {
        (listOf(source) + bundle.sources)
            .filter { it.isDirectPlayable }
            .distinctBy { SourceSelector.identityKey(it.toSourceCandidateForPlayer()) }
    }
    val latestPlayableSources = androidx.compose.runtime.rememberUpdatedState(playableSources)
    val latestBundle by bundleState
    var activeSource by remember(bundle.videoId, source.url) { mutableStateOf(source) }
    var addonSubtitles by remember(bundle.videoId) {
        mutableStateOf(bundle.subtitles)
    }
    val latestDiscoveredSubtitles = latestBundle
        ?.takeIf { it.videoId == bundle.videoId }
        ?.subtitles
        .orEmpty()
    LaunchedEffect(latestDiscoveredSubtitles) {
        val merged = (addonSubtitles + latestDiscoveredSubtitles).distinctBy { it.url }
        if (merged != addonSubtitles) {
            addonSubtitles = merged
            com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlayerEvent("TV", "SUBTITLES_MERGED",
                "episode=${episode?.episode ?: 0} received=${latestDiscoveredSubtitles.size} total=${merged.size}")
        }
    }
    val providerSubtitles = com.vueo.shared.core.player.StreamSubtitlePolicy.forPlayback(activeSource, addonSubtitles)
    val smartSubsStore = remember(context) { com.vueo.shared.core.smartsubs.SmartSubsSettingsStore(context.applicationContext) }
    var smartSubsTracks by remember(mediaKey, activeSource.url) { mutableStateOf(emptyList<SubtitleTrack>()) }
    var smartSubsMessage by remember(mediaKey, activeSource.url) { mutableStateOf<String?>(null) }
    var smartSubsRefreshing by remember(mediaKey) { mutableStateOf(false) }
    var smartSubsRefreshGeneration by remember(mediaKey) { mutableIntStateOf(0) }
    LaunchedEffect(mediaKey, activeSource.url, providerSubtitles, smartSubsRefreshGeneration) {
        val config = smartSubsStore.configuration()
        smartSubsMessage = null
        if (!config.enabled) { smartSubsTracks = emptyList(); smartSubsRefreshing = false; return@LaunchedEffect }
        if (!config.connected) {
            smartSubsTracks = emptyList(); smartSubsRefreshing = false
            smartSubsMessage = "SmartSubs session needs renewal. Test Connection in Gemini settings."
            return@LaunchedEffect
        }
        val candidates = com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.eligibleSources(providerSubtitles, config.includeAddonSources)
        if (candidates.isEmpty()) {
            smartSubsTracks = emptyList(); smartSubsRefreshing = false
            if (providerSubtitles.any { com.vueo.shared.core.language.LanguagePolicy.canonicalCode(it.language) == "en" }) {
                smartSubsMessage = "SmartSubs needs a supported English VTT/SRT subtitle source."
            }
            return@LaunchedEffect
        }
        smartSubsRefreshing = true
        try {
            // Batch late provider/addon updates. This POST only lists tracks, never translates.
            delay(350L)
            smartSubsTracks = com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.discover(
                config = config, mediaType = media.type, videoId = bundle.videoId, tracks = candidates,
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            smartSubsMessage = com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.failureMessage(error)
        } finally { smartSubsRefreshing = false }
    }
    val liveSubtitles = (providerSubtitles + smartSubsTracks).distinctBy { it.url }

    val externalSubtitlesBySelectionId = remember(liveSubtitles) {
        liveSubtitles.associateBy(::tvExternalSubtitleSelectionId)
    }
    val latestExternalSubtitlesBySelectionId =
        androidx.compose.runtime.rememberUpdatedState(externalSubtitlesBySelectionId)
    val latestLiveSubtitles = androidx.compose.runtime.rememberUpdatedState(liveSubtitles)
    var resumeTargetMs by remember(bundle.videoId) { mutableLongStateOf(startPosition) }
    val sourceRecoverySession = remember(bundle.videoId) { SourceRecoverySession() }
    var hasRenderedFirstFrame by remember(bundle.videoId) { mutableStateOf(false) }
    var isBuffering by remember(bundle.videoId) { mutableStateOf(false) }
    var recoveryInProgress by remember(bundle.videoId) { mutableStateOf(false) }
    var playbackError by remember(bundle.videoId) { mutableStateOf<String?>(null) }
    var retryGeneration by remember(bundle.videoId) { mutableIntStateOf(0) }
    var autoNextCancelled by remember(bundle.videoId) { mutableStateOf(false) }
    var nextEpisodeDispatched by remember(bundle.videoId) { mutableStateOf(false) }
    var autoNextCompletedCurrent by remember(bundle.videoId) { mutableStateOf(false) }
    // End-of-episode persistence can be triggered by STATE_ENDED, the contextual
    // Next action, auto-next, and Player disposal within a few hundred ms. Keep
    // one completion write and one explicit handoff write at most per video.
    var completionPersistenceQueued by remember(bundle.videoId) { mutableStateOf(false) }
    var episodeHandoffPersistenceQueued by remember(bundle.videoId) { mutableStateOf(false) }
    var libraryProgressRevision by remember(media.id, media.type) { mutableIntStateOf(0) }
    var focusedPrompt by remember { mutableStateOf(TvPlayerPromptTarget.NONE) }

    var subtitleDelayMs by remember(mediaKey) { mutableIntStateOf(settings.subtitleDelayMs(mediaKey)) }
    val latestSubtitleDelayMs = androidx.compose.runtime.rememberUpdatedState(subtitleDelayMs)
    val storedSubtitleFontSizeSp = remember {
        settings.migrateTvSubtitlePresentationDefaults()
        settings.subtitleFontSizeSp()
    }
    val storedSubtitleBottomPaddingPercent = remember { settings.subtitleBottomPaddingPercent() }
    val storedSubtitleTextColor = remember { settings.subtitleTextColor() }
    val storedSubtitleTextOpacityPercent = remember { settings.subtitleTextOpacityPercent() }
    var subtitleStyle by remember {
        mutableStateOf(
            TvPlayerSubtitleStyleState(
                fontSizeSp = storedSubtitleFontSizeSp,
                commentaryFontSizeSp = settings.subtitleCommentaryFontSizeSp(),
                fontFamily = settings.subtitleFontFamily(),
                bold = settings.subtitleBold(),
                showCommentary = settings.tvSubtitleCommentaryEnabled(),
                textColor = if ((storedSubtitleTextColor ushr 24) != 0xFF) {
                    storedSubtitleTextColor
                } else {
                    withAlpha(storedSubtitleTextColor, storedSubtitleTextOpacityPercent)
                },
                outlineEnabled = settings.subtitleOutlineEnabled(),
                outlineColor = settings.subtitleOutlineColor(),
                backgroundEnabled = settings.subtitleBackgroundEnabled(),
                backgroundColor = settings.subtitleBackgroundColor(),
                backgroundOpacityPercent =
                    settings.subtitleBackgroundOpacityPercent(),
                bottomPaddingPercent = storedSubtitleBottomPaddingPercent,
            )
        )
    }
    fun rememberedExternalSubtitle(): String? {
        val savedLanguage = settings.lastSubtitleSelection()
            ?.takeIf { it.startsWith(TV_SUBTITLE_LANGUAGE_PREFIX) }
            ?.removePrefix(TV_SUBTITLE_LANGUAGE_PREFIX) ?: return null
        return liveSubtitles.firstOrNull {
            tvCanonicalLanguage(it.language) == tvCanonicalLanguage(savedLanguage)
        }?.let(::tvExternalSubtitleSelectionId)
    }
    var pendingSubtitleSelectionId by remember(mediaKey) {
        mutableStateOf(rememberedExternalSubtitle())
    }
    var translatingSubtitleSelectionId by remember(mediaKey) {
        mutableStateOf<String?>(null)
    }
    var requestedSubtitleSelectionId by remember(mediaKey) {
        mutableStateOf<String?>(null)
    }
    var subtitlePreparationJob by remember(mediaKey) { mutableStateOf<Job?>(null) }
    var subtitleDiscoveryRefreshing by remember(mediaKey) { mutableStateOf(false) }
    var subtitleRefreshMessage by remember(mediaKey) { mutableStateOf<String?>(null) }

    val traceSource = androidx.compose.runtime.rememberUpdatedState(activeSource)
    val httpFactory = remember(bundle.videoId) {
        DefaultHttpDataSource.Factory()
            .setUserAgent("VUEO-TV")
            .setAllowCrossProtocolRedirects(true)
    }
    val videoDecoderSession = remember(bundle.videoId) {
        com.vueo.shared.core.player.VideoDecoderSession("TV").apply { beginSource(activeSource.url) }
    }
    val player = remember(bundle.videoId) {
        ExoPlayer.Builder(
            context,
            TvSubtitleOffsetRenderersFactory(
                context = context,
                decoderSession = videoDecoderSession,
                subtitleDelayUsProvider = {
                    latestSubtitleDelayMs.value.toLong() * 1_000L
                },
            ),
        )
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(context)
                    .setDataSourceFactory(SubtitleSessionDataSource.Factory(
                        com.vueo.shared.core.player.PlaybackHttpTraceDataSource.Factory(
                            httpFactory, "TV", { traceSource.value.headers }, { traceSource.value.url },
                        )
                    ))
            )
            .build()
            .apply { setAudioAttributes(AudioAttributes.DEFAULT, true) }
    }

    val liveSmartSubs = remember(player, mediaKey, activeSource.url) {
        LiveSmartSubs(player, "TV") { latestSubtitleDelayMs.value.toLong() }
    }
    DisposableEffect(liveSmartSubs) { onDispose { liveSmartSubs.close() } }
    LaunchedEffect(liveSmartSubs, liveSubtitles) { liveSmartSubs.update(liveSubtitles) }

    var pauseBackdropVisible by remember(playerSessionId) { mutableStateOf(false) }
    var playbackRequested by remember(player) { mutableStateOf(player.playWhenReady) }
    var playerForeground by remember(playerSessionId) {
        mutableStateOf(lifecycleOwner?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) ?: true)
    }
    val pauseBackdropCapturedKey = remember(playerSessionId) { intArrayOf(0) }
    var controlsVisible by remember { mutableStateOf(true) }
    var playbackFeedbackToken by remember(playerSessionId) { mutableIntStateOf(0) }
    var playbackFeedbackPaused by remember(playerSessionId) { mutableStateOf(false) }
    var activePanel by remember { mutableStateOf(TvPlayerPanel.NONE) }
    var restorePanelFocus by remember { mutableStateOf<TvPlayerPanel?>(null) }
    var endedFocusAssigned by remember(mediaKey) { mutableStateOf(false) }
    var endedControlsDismissed by remember(mediaKey) { mutableStateOf(false) }
    var interactionToken by remember { mutableIntStateOf(0) }
    var positionMs by remember { mutableLongStateOf(startPosition) }
    var durationMs by remember { mutableLongStateOf(0L) }
    var playing by remember { mutableStateOf(false) }
    var ended by remember { mutableStateOf(false) }
    var nextCountdown by remember { mutableIntStateOf(0) }
    var resolvedImdbId by remember(mediaKey) { mutableStateOf<String?>(null) }
    var skipSegments by remember(mediaKey) { mutableStateOf<List<PlayerSkipSegment>>(emptyList()) }
    var contentWarnings by remember(mediaKey) { mutableStateOf<List<ContentWarning>>(emptyList()) }
    var warningVisible by remember(playerSessionId) { mutableStateOf(false) }
    var warningShown by remember(playerSessionId) { mutableStateOf(false) }
    var textTracks by remember(bundle.videoId) { mutableStateOf<List<TvPlayerTrackChoice>>(emptyList()) }
    var audioTracks by remember(bundle.videoId) { mutableStateOf<List<TvPlayerTrackChoice>>(emptyList()) }
    var subtitlesDisabled by remember(mediaKey) {
        mutableStateOf(
            when (settings.lastSubtitleSelection()) {
                TV_SUBTITLE_OFF -> true
                null -> !settings.subtitlesOnByDefault()
                else -> false
            }
        )
    }
    var audioAutomaticSelected by remember(mediaKey) { mutableStateOf(true) }
    var subtitlePreferenceRestored by remember(bundle.videoId, activeSource.url) { mutableStateOf(false) }
    var audioPreferenceRestored by remember(bundle.videoId, activeSource.url) { mutableStateOf(false) }
    var appliedSubtitleUrls by remember(bundle.videoId, activeSource.url) {
        mutableStateOf(PlayerSubtitleUpdatePolicy.sourceKeys(LiveSmartSubs.videoSubtitles(liveSubtitles)))
    }
    var subtitleTrackRefreshInProgress by remember(bundle.videoId, activeSource.url) {
        mutableStateOf(false)
    }
    var playbackSpeed by remember(bundle.videoId) { mutableStateOf(settings.playerPlaybackSpeed()) }
    var videoFit by remember(bundle.videoId) { mutableStateOf(settings.playerVideoFit()) }
    var autoPlayNextEpisode by remember { mutableStateOf(settings.autoPlayNextEpisodeEnabled()) }
    var skipSegmentsEnabled by remember(mediaKey) { mutableStateOf(settings.skipSegmentsEnabled()) }
    var contentWarningsEnabled by remember(mediaKey) { mutableStateOf(settings.contentWarningsEnabled()) }
    var resumeAfterLifecyclePause by remember(playerSessionId) { mutableStateOf(false) }
    var pendingSeekPositionMs by remember(bundle.videoId) { mutableStateOf<Long?>(null) }
    // Display seek targets directly until the existing seek anchor settles.
    var seekMotionDirect by remember(bundle.videoId) { mutableStateOf(false) }
    var seekHoldActive by remember(bundle.videoId) { mutableStateOf(false) }
    var hiddenSeekProgressVisible by remember(bundle.videoId) { mutableStateOf(false) }
    val seekCommitJob = remember(bundle.videoId) { arrayOfNulls<Job>(1) }
    val seekAnchorClearJob = remember(bundle.videoId) { arrayOfNulls<Job>(1) }
    var controlFocusHandoffPending by remember { mutableStateOf(true) }
    var exitingPlayer by remember(playerSessionId) { mutableStateOf(false) }
    var startupAudioMuted by remember(playerSessionId) { mutableStateOf(true) }

    val nextEpisode = remember(media.episodes, episode?.id) { nextEpisode(media.episodes, episode) }
    LaunchedEffect(activeSource.url) { onActiveSourceChanged(activeSource) }
    var prefetchDispatched by remember(bundle.videoId, activeSource.url) { mutableStateOf(false) }
    var threeMinutePrefetchCheckDispatched by remember(bundle.videoId, activeSource.url) { mutableStateOf(false) }
    var oneMinutePrefetchCheckDispatched by remember(bundle.videoId, activeSource.url) { mutableStateOf(false) }
    val prefetchBaseEligible =
        playing && !episodeSwitching && nextEpisode != null && durationMs > 0L
    val prefetchEligible =
        prefetchBaseEligible &&
            positionMs >= (durationMs - 300_000L).coerceAtLeast(0L)
    val threeMinutePrefetchCheckEligible =
        prefetchBaseEligible &&
            positionMs >= (durationMs - 180_000L).coerceAtLeast(0L)
    val oneMinutePrefetchCheckEligible =
        prefetchBaseEligible &&
            positionMs >= (durationMs - 60_000L).coerceAtLeast(0L)

    LaunchedEffect(prefetchEligible, nextEpisode?.id, activeSource.url) {
        if (prefetchEligible && !prefetchDispatched) {
            prefetchDispatched = true
            nextEpisode?.let { onPrefetchNextEpisode(it, activeSource) }
        }
    }
    LaunchedEffect(threeMinutePrefetchCheckEligible, nextEpisode?.id, activeSource.url) {
        if (threeMinutePrefetchCheckEligible && !threeMinutePrefetchCheckDispatched) {
            threeMinutePrefetchCheckDispatched = true
            nextEpisode?.let { target ->
                onPrefetchNextEpisode(target, activeSource)
                onValidateNextEpisodePrefetch(target, activeSource, 180)
            }
        }
    }
    LaunchedEffect(oneMinutePrefetchCheckEligible, nextEpisode?.id, activeSource.url) {
        if (oneMinutePrefetchCheckEligible && !oneMinutePrefetchCheckDispatched) {
            oneMinutePrefetchCheckDispatched = true
            nextEpisode?.let { target ->
                onPrefetchNextEpisode(target, activeSource)
                onValidateNextEpisodePrefetch(target, activeSource, 60)
            }
        }
    }

    val activeSkip = remember(positionMs, durationMs, skipSegments) {
        PlayerSkipPolicy.activeSegment(skipSegments, positionMs, durationMs)
    }
    val earlyNextEligible = PlayerSkipPolicy.canStartNextDuringCredits(
        skipSegments, positionMs, durationMs,
    )
    val autoNextEligible = !episodeSwitching && !nextEpisodeDispatched && !autoNextCancelled &&
        autoPlayNextEpisode && nextEpisode != null &&
        activePanel == TvPlayerPanel.NONE && playbackError == null &&
        !recoveryInProgress && pendingSeekPositionMs == null && player.playWhenReady &&
        (ended || (skipSegmentsEnabled && earlyNextEligible && playing && !isBuffering && hasRenderedFirstFrame))
    val latestAutoNextEligible = androidx.compose.runtime.rememberUpdatedState(autoNextEligible)
    // Keep the subtitle workspace reachable even when discovery currently has no
    // tracks. The workspace owns the explicit Off state and Refresh action, so
    // hiding the chrome action here would strand the user with no way to retry.
    val hasSubtitleControl = true
    val hasAudioControl = audioTracks.isNotEmpty() || !activeSource.audio.isNullOrBlank()
    val hasSourcesControl = playableSources.isNotEmpty()
    val hasEpisodesControl = media.episodes.isNotEmpty()

    val focusScope = rememberCoroutineScope()
    var pendingFocusJob by remember { mutableStateOf<Job?>(null) }
    val lastInteractionElapsedMs = remember { longArrayOf(0L) }
    val revealActivationKey = remember { intArrayOf(0) }
    val hiddenPlaybackActivationKey = remember { intArrayOf(0) }
    val backPressCaptured = remember { booleanArrayOf(false) }

    fun noteInteraction() {
        pauseBackdropVisible = false
        val now = SystemClock.elapsedRealtime()
        if (now - lastInteractionElapsedMs[0] < 24L) return
        lastInteractionElapsedMs[0] = now
        interactionToken += 1
    }

    fun isFocusRequestAllowed(requester: FocusRequester): Boolean = !latestEpisodeSwitching.value && when (requester) {
        progressRequester, restartRequester, nextRequester, subtitlesRequester,
        audioRequester, sourcesRequester, episodesRequester, moreRequester ->
            controlsVisible && activePanel == TvPlayerPanel.NONE
        skipRequester -> !pauseBackdropVisible && activePanel == TvPlayerPanel.NONE && activeSkip != null
        nextContextRequester -> !pauseBackdropVisible && activePanel == TvPlayerPanel.NONE && nextCountdown > 0
        rootRequester -> activePanel == TvPlayerPanel.NONE
        else -> true
    }

    fun requestFocusReliably(requester: FocusRequester) {
        pendingFocusJob?.cancel()
        pendingFocusJob = focusScope.launch {
            requester.requestTvFocus(canRequest = { isFocusRequestAllowed(requester) })
        }
    }

    suspend fun requestFocusNow(requester: FocusRequester): Boolean {
        pendingFocusJob?.cancel()
        pendingFocusJob = null
        return requester.requestTvFocus(canRequest = { isFocusRequestAllowed(requester) })
    }

    fun requestControlFocus(requester: FocusRequester = progressRequester) {
        if (latestEpisodeSwitching.value) return
        hiddenSeekProgressVisible = false
        val targetRequester = if (!controlsVisible && playbackError == null) progressRequester else requester
        focusedPrompt = TvPlayerPromptTarget.NONE
        controlsVisible = true
        controlFocusHandoffPending = true
        noteInteraction()
        pendingFocusJob?.cancel()
        pendingFocusJob = focusScope.launch {
            val focused = targetRequester.requestTvFocus(canRequest = { isFocusRequestAllowed(targetRequester) })
            if (controlsVisible) controlFocusHandoffPending = !focused
        }
    }

    fun hideControls() {
        pendingFocusJob?.cancel()
        pendingFocusJob = null
        restorePanelFocus = null
        focusedPrompt = TvPlayerPromptTarget.NONE
        controlFocusHandoffPending = false
        controlsVisible = false
        // Root stays attached while chrome is visible, so focus can leave the
        // outgoing controls immediately without selecting the first top action.
        val focused = runCatching { rootRequester.requestFocus() }.getOrDefault(false)
        if (!focused) requestFocusReliably(rootRequester)
    }

    fun commitPendingSeek() {
        seekHoldActive = false
        seekCommitJob[0]?.cancel()
        seekCommitJob[0] = null
        hiddenSeekProgressVisible = false
        val target = pendingSeekPositionMs ?: return
        player.seekTo(target)
        positionMs = target
        seekAnchorClearJob[0]?.cancel()
        seekAnchorClearJob[0] = focusScope.launch {
            delay(650L)
            if (pendingSeekPositionMs == target) {
                pendingSeekPositionMs = null
                seekMotionDirect = false
            }
        }
    }

    fun clearPendingSeek() {
        seekHoldActive = false
        seekCommitJob[0]?.cancel()
        seekCommitJob[0] = null
        hiddenSeekProgressVisible = false
        seekAnchorClearJob[0]?.cancel()
        seekAnchorClearJob[0] = null
        pendingSeekPositionMs = null
        seekMotionDirect = false
    }

    fun seekImmediateBy(deltaMs: Long) {
        val max = player.duration.takeIf { it > 0L && it != C.TIME_UNSET }
        val base = player.currentPosition.coerceAtLeast(0L)
        val target = if (max != null) {
            (base + deltaMs).coerceIn(0L, max)
        } else {
            (base + deltaMs).coerceAtLeast(0L)
        }
        clearPendingSeek()
        seekMotionDirect = true
        player.seekTo(target)
        positionMs = target
        seekAnchorClearJob[0] = focusScope.launch {
            delay(650L)
            seekMotionDirect = false
        }
        noteInteraction()
    }

    fun seekBy(deltaMs: Long) {
        val max = player.duration.takeIf { it > 0L && it != C.TIME_UNSET }
        val base = pendingSeekPositionMs ?: player.currentPosition.coerceAtLeast(0L)
        val target = if (max != null) {
            (base + deltaMs).coerceIn(0L, max)
        } else {
            (base + deltaMs).coerceAtLeast(0L)
        }
        seekAnchorClearJob[0]?.cancel()
        seekAnchorClearJob[0] = null
        hiddenSeekProgressVisible = !controlsVisible
        pendingSeekPositionMs = target
        seekHoldActive = true
        seekMotionDirect = true
        positionMs = target
        seekCommitJob[0]?.cancel()
        seekCommitJob[0] = focusScope.launch {
            // Held-key repeats only preview the target and commit on release.
            // The first KeyDown is handled separately as an immediate single-step
            // seek so taps stay responsive in both visible and hidden controls.
            delay(1_200L)
            commitPendingSeek()
        }
        noteInteraction()
    }

    fun togglePlayback() {
        if (player.playWhenReady) player.pause() else player.play()
        playing = player.isPlaying
        if (!controlsVisible && activePanel == TvPlayerPanel.NONE) {
            playbackFeedbackPaused = !player.playWhenReady
            playbackFeedbackToken++
        }
        noteInteraction()
    }

    fun saveProgress(backgroundLibrary: Boolean = false) {
        val duration = player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L
        val position = if (autoNextCompletedCurrent && duration > 0L) duration
            else player.currentPosition.coerceAtLeast(0L)

        // Capture before dispatch so Back -> reopen can resolve the newest cursor
        // immediately. The event stamp also makes older IO harmless if it finishes
        // after a newer rewind or episode interaction.
        val playbackSnapshot = runtime.playbackStore.capturePosition(
            mediaKey = mediaKey,
            positionMs = position,
            durationMs = duration,
        )
        val persistProgress = {
            runtime.playbackStore.persistSnapshot(playbackSnapshot)
            runtime.libraryStore.recordPlayback(
                media = media,
                videoId = bundle.videoId,
                episodeTitle = episode?.title,
                season = episode?.season,
                episode = episode?.episode,
                positionMs = position,
                durationMs = duration,
                lastWatchedEpochMs = playbackSnapshot.updatedAtEpochMs,
            )
        }
        val notifyPersisted = {
            libraryProgressRevision += 1
            onLibraryChanged()
        }

        if (backgroundLibrary) {
            enqueueTvPlayerPersistence(
                block = persistProgress,
                afterPersist = notifyPersisted,
            )
        } else {
            persistProgress()
            notifyPersisted()
        }
    }

    fun queueEpisodeHandoffProgress(markCompleted: Boolean) {
        if (episodeHandoffPersistenceQueued) return
        episodeHandoffPersistenceQueued = true

        if (markCompleted) {
            autoNextCompletedCurrent = true
            // STATE_ENDED already queued the exact completion snapshot. Reusing it
            // avoids serializing PlaybackStore + LibraryStore a second time when
            // the user immediately presses Play Next. During credits, no ended
            // callback exists yet, so queue the completion once here.
            if (completionPersistenceQueued) return
            completionPersistenceQueued = true
        }
        saveProgress(backgroundLibrary = true)
    }

    fun closePanel(restoreFocus: Boolean = true) {
        val closingPanel = activePanel
        activePanel = TvPlayerPanel.NONE
        controlFocusHandoffPending = restoreFocus
        noteInteraction()
        restorePanelFocus = closingPanel.takeIf { restoreFocus && it != TvPlayerPanel.NONE }
    }

    fun exitPlayer() {
        if (exitingPlayer) return
        exitingPlayer = true
        // Silence playback before any persistence/navigation work. ExoPlayer can
        // otherwise keep audio alive while Compose disposes the Player route.
        player.volume = 0f
        player.pause()
        saveProgress(backgroundLibrary = true)
        onBack()
    }

    fun handleSourceFailure(message: String) {
        if (recoveryInProgress) return

        sourceRecoverySession.markFailed(activeSource.toSourceCandidateForPlayer())
        val latestSources = latestPlayableSources.value
        val alternateCandidate = if (settings.autoSourceRecoveryEnabled()) {
            sourceRecoverySession.next(
                rankedSources = latestSources.map { it.toSourceCandidateForPlayer() },
                originalLanguage = media.originalLanguage,
            )
        } else {
            null
        }
        val alternateKey = alternateCandidate?.let(SourceSelector::identityKey)
        val alternate = alternateKey?.let { key ->
            latestSources.firstOrNull {
                SourceSelector.identityKey(it.toSourceCandidateForPlayer()) == key
            }
        }

        if (alternate != null) {
            resumeTargetMs = player.currentPosition.coerceAtLeast(positionMs).coerceAtLeast(0L)
            saveProgress(backgroundLibrary = true)
            recoveryInProgress = true
            hasRenderedFirstFrame = false
            isBuffering = false
            playbackError = null
            activeSource = alternate
            requestControlFocus(progressRequester)
        } else {
            val failedCount = sourceRecoverySession.failedSourceCount()
            playbackError = if (failedCount > 1) {
                "$failedCount ranked sources failed. Choose Sources to try one manually."
            } else {
                "$message No other suitable automatic source was available."
            }
            requestControlFocus(progressRequester)
        }
    }

    fun handlePlayerBack() {
        when {
            pauseBackdropVisible -> noteInteraction()
            activePanel != TvPlayerPanel.NONE -> closePanel()
            controlsVisible || nextCountdown > 0 -> {
                if (ended || player.playbackState == Player.STATE_ENDED || nextCountdown > 0) {
                    endedControlsDismissed = true
                }
                // One Back dismisses both the countdown card and player chrome.
                // A workspace keeps its own Back-to-player behavior above.
                if (nextCountdown > 0) {
                    autoNextCancelled = true
                    nextCountdown = 0
                }
                hideControls()
            }
            else -> exitPlayer()
        }
    }

    BackHandler { handlePlayerBack() }

    LaunchedEffect(activeSource.url, activeSource.headers, bundle.videoId) {
        val url = activeSource.url ?: return@LaunchedEffect
        videoDecoderSession.beginSource(url)
        sourceRecoverySession.begin(activeSource.toSourceCandidateForPlayer())
        recoveryInProgress = false
        hasRenderedFirstFrame = false
        startupAudioMuted = true
        player.volume = 0f
        isBuffering = false
        httpFactory.setUserAgent(
            activeSource.headers.entries.firstOrNull {
                it.key.equals("User-Agent", ignoreCase = true) && it.value.isNotBlank()
            }?.value ?: "VUEO-TV"
        )
        httpFactory.setDefaultRequestProperties(activeSource.headers)
        playbackError = null
        textTracks = emptyList()
        audioTracks = emptyList()

        val primaryLanguage = settings.lastSubtitleSelection()
            ?.takeIf { it.startsWith(TV_SUBTITLE_LANGUAGE_PREFIX) }
            ?.removePrefix(TV_SUBTITLE_LANGUAGE_PREFIX)
            ?: settings.preferredSubtitleLanguage().languageCode
        val secondaryLanguage = settings.secondarySubtitleLanguage().languageCode
        val languages = listOfNotNull(primaryLanguage, secondaryLanguage).distinct()

        player.setMediaItem(
            buildMediaItem(
                mediaMimeType = com.vueo.shared.core.player.PlaybackMediaPolicy.resolve(activeSource.mimeType, activeSource.url, activeSource.name, activeSource.serverName),
                sourceUrl = url,
                subtitles = liveSubtitles,
                preferredLanguages = languages,
                subtitlesOnByDefault = !subtitlesDisabled,
                autoSelectPreferred = settings.autoSelectPreferredSubtitle(),
                preferEmbedded = settings.embeddedSubtitlePriority(),
            ),
            resumeTargetMs.coerceAtLeast(0L),
        )
        var params = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .setTrackTypeDisabled(
                C.TRACK_TYPE_TEXT,
                subtitlesDisabled || pendingSubtitleSelectionId != null,
            )
        if (settings.autoSelectPreferredSubtitle() && languages.isNotEmpty()) {
            params = params.setPreferredTextLanguages(*languages.toTypedArray())
        }
        PlayerSourcePolicy.canonicalLanguageCode(media.originalLanguage)?.let { originalLanguage ->
            params = params.setPreferredAudioLanguages(originalLanguage)
        }
        player.trackSelectionParameters = params.build()
        player.setPlaybackSpeed(playbackSpeed)
        player.prepare()
        player.playWhenReady = true
        appliedSubtitleUrls = PlayerSubtitleUpdatePolicy.sourceKeys(LiveSmartSubs.videoSubtitles(liveSubtitles))
    }

    // Keep newly discovered external subtitles visible in the workspace immediately,
    // even before Media3 has published the matching text TrackGroups. This mirrors
    // Mobile's late-subtitle behavior and prevents an episode switch from showing
    // only "Off" while subtitle registration is still catching up.
    LaunchedEffect(player, liveSubtitles) {
        val playerChoices = tvPlayerTrackChoices(
            tracks = LiveSmartSubs.mergedTracks(player),
            trackType = C.TRACK_TYPE_TEXT,
            externalSubtitles = externalSubtitlesBySelectionId,
        )
        textTracks = tvMergeDiscoveredSubtitleChoices(
            playerChoices = playerChoices,
            discoveredSubtitles = liveSubtitles,
        )
    }

    LaunchedEffect(player, activeSource.url, liveSubtitles) {
        val url = activeSource.url ?: return@LaunchedEffect
        val latestSubtitleUrls = PlayerSubtitleUpdatePolicy.sourceKeys(LiveSmartSubs.videoSubtitles(liveSubtitles))
        if (latestSubtitleUrls == appliedSubtitleUrls) return@LaunchedEffect
        // A prefetched episode can keep resolving subtitles after its video source
        // is already committed. Do not rebuild Media3's playing item while the new
        // decoder is still producing its first frame. Workspace choices remain
        // visible immediately; registration is batched once startup settles.
        var startupWaits = 0
        while ((latestEpisodeSwitching.value || !hasRenderedFirstFrame) && startupWaits < 30) {
            delay(100L)
            startupWaits += 1
        }
        delay(if (startupWaits > 0) 500L else 350L)
        if (player.currentMediaItem?.localConfiguration?.uri?.toString() != url ||
            latestSubtitleUrls == appliedSubtitleUrls
        ) return@LaunchedEffect
        val currentPosition = PlayerSubtitleUpdatePolicy.stableResumePositionMs(
            currentPositionMs = player.currentPosition,
            lastKnownPositionMs = positionMs,
        )
        val primaryLanguage = settings.lastSubtitleSelection()
            ?.takeIf { it.startsWith(TV_SUBTITLE_LANGUAGE_PREFIX) }
            ?.removePrefix(TV_SUBTITLE_LANGUAGE_PREFIX)
            ?: settings.preferredSubtitleLanguage().languageCode
        val secondaryLanguage = settings.secondarySubtitleLanguage().languageCode
        val languages = listOfNotNull(primaryLanguage, secondaryLanguage).distinct()
        audioPreferenceRestored = false
        subtitlePreferenceRestored = false
        if (pendingSubtitleSelectionId == null) {
            pendingSubtitleSelectionId = rememberedExternalSubtitle()
        }
        val updatedMediaItem = buildMediaItem(
                mediaMimeType = com.vueo.shared.core.player.PlaybackMediaPolicy.resolve(activeSource.mimeType, activeSource.url, activeSource.name, activeSource.serverName),
                sourceUrl = url,
                subtitles = liveSubtitles,
                preferredLanguages = languages,
                subtitlesOnByDefault = !subtitlesDisabled,
                autoSelectPreferred = settings.autoSelectPreferredSubtitle(),
                preferEmbedded = settings.embeddedSubtitlePriority(),
            )
        val currentIndex = player.currentMediaItemIndex
            .takeIf { it in 0 until player.mediaItemCount }
            ?: 0
        subtitleTrackRefreshInProgress = true
        var params = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .setTrackTypeDisabled(
                C.TRACK_TYPE_TEXT,
                subtitlesDisabled || LiveSmartSubs.ownsCues(player) || pendingSubtitleSelectionId != null,
            )
        if (settings.autoSelectPreferredSubtitle() && languages.isNotEmpty()) params = params.setPreferredTextLanguages(*languages.toTypedArray())
        PlayerSourcePolicy.canonicalLanguageCode(media.originalLanguage)?.let { params = params.setPreferredAudioLanguages(it) }
        player.trackSelectionParameters = params.build()
        // Apply the text-track lock before replacing the playing item so
        // Media3 cannot race the readiness probe to the external URL.
        // AI captions are owned by LiveSmartSubs and never reach this path.
        player.replaceMediaItem(currentIndex, updatedMediaItem)
        com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlayerEvent(
            "TV", "SUBTITLE_MEDIA_UPDATE", "rebuild=false aiOverlay=true",
        )
        appliedSubtitleUrls = latestSubtitleUrls
        com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlayerEvent("TV", "SUBTITLES_REGISTERED",
            "episode=${episode?.episode ?: 0} tracks=${liveSubtitles.size} positionMs=$currentPosition")

        // Media3 may briefly publish an empty/intermediate text-track snapshot after
        // replaceMediaItem(). Reconcile until every late external subtitle has a real
        // TrackGroup, while keeping provisional discovered choices visible meanwhile.
        val expectedExternalSelectionIds = liveSubtitles
            .map(::tvExternalSubtitleSelectionId)
            .toSet()
        var refreshAttempts = 0
        while (refreshAttempts < TV_LATE_SUBTITLE_TRACK_REFRESH_ATTEMPTS) {
            val latestSubtitles = latestLiveSubtitles.value
            val latestMap = latestSubtitles.associateBy(::tvExternalSubtitleSelectionId)
            val refreshedPlayerChoices = tvPlayerTrackChoices(
                tracks = LiveSmartSubs.mergedTracks(player),
                trackType = C.TRACK_TYPE_TEXT,
                externalSubtitles = latestMap,
            )
            textTracks = tvMergeDiscoveredSubtitleChoices(
                playerChoices = refreshedPlayerChoices,
                discoveredSubtitles = latestSubtitles,
            )
            val visibleExternalSelectionIds = refreshedPlayerChoices
                .asSequence()
                .filter { it.externalSubtitle != null }
                .map { it.selectionId }
                .toSet()
            if (expectedExternalSelectionIds.isEmpty() ||
                expectedExternalSelectionIds.all(visibleExternalSelectionIds::contains)
            ) {
                break
            }
            delay(TV_LATE_SUBTITLE_TRACK_REFRESH_INTERVAL_MS)
            refreshAttempts += 1
        }
        subtitleTrackRefreshInProgress = false
        val finalSubtitles = latestLiveSubtitles.value
        val finalPlayerChoices = tvPlayerTrackChoices(
            tracks = LiveSmartSubs.mergedTracks(player),
            trackType = C.TRACK_TYPE_TEXT,
            externalSubtitles = finalSubtitles.associateBy(::tvExternalSubtitleSelectionId),
        )
        textTracks = tvMergeDiscoveredSubtitleChoices(
            playerChoices = finalPlayerChoices,
            discoveredSubtitles = finalSubtitles,
        )
    }

    // Keep sampler/frame attribution on PLAYER while Details hosts this surface.
    DisposableEffect(player) {
        val screenToken = PerformanceDiagnostics.enterPlayerScreen("TV")
        onDispose { PerformanceDiagnostics.exitPlayerScreen(screenToken) }
    }

    DisposableEffect(player, mediaKey, activeSource.url) {
        val startedNs = System.nanoTime()
        var lastState = -1
        var bufferingNs = 0L
        var emitted = 0
        var firstFrameLogged = false
        fun log(event: String, details: String) {
            if (PerformanceDiagnostics.isCollecting() && emitted < 120) {
                emitted++
                com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlayerEvent(
                    "TV", event, details,
                )
            }
        }
        log(if (episode != null) "EPISODE_PLAYBACK_START" else "PLAYBACK_START", "state=${player.playbackState}")
        val diagnosticsListener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (!PerformanceDiagnostics.isCollecting() || lastState == playbackState) return
                lastState = playbackState
                val now = System.nanoTime()
                val bufferMs = if (bufferingNs > 0L) (now - bufferingNs) / 1_000_000L else 0L
                if (playbackState == Player.STATE_BUFFERING) bufferingNs = now
                val event = when (playbackState) {
                    Player.STATE_BUFFERING -> "BUFFERING"
                    Player.STATE_READY -> "READY"
                    Player.STATE_ENDED -> "ENDED"
                    else -> "IDLE"
                }
                log(event, "elapsed=${(now - startedNs) / 1_000_000L}ms buffer=${bufferMs}ms")
                if (playbackState != Player.STATE_BUFFERING) bufferingNs = 0L
            }
            override fun onRenderedFirstFrame() {
                if (PerformanceDiagnostics.isCollecting() && !firstFrameLogged) {
                    firstFrameLogged = true
                    log("FIRST_FRAME", "elapsed=${(System.nanoTime() - startedNs) / 1_000_000L}ms")
                } else if (firstFrameLogged) {
                    log("VIDEO_FIRST_FRAME_AGAIN", "elapsed=${(System.nanoTime() - startedNs) / 1_000_000L}ms positionMs=${player.currentPosition}")
                }
            }
            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int,
            ) {
                log("POSITION_DISCONTINUITY", "reason=$reason fromMs=${oldPosition.positionMs} toMs=${newPosition.positionMs}")
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (PerformanceDiagnostics.isCollecting()) {
                    log(if (isPlaying) "PLAYING" else "NOT_PLAYING", "state=${player.playbackState}")
                }
            }
        }
        player.addListener(diagnosticsListener)
        diagnosticsListener.onPlaybackStateChanged(player.playbackState)
        onDispose {
            player.removeListener(diagnosticsListener)
            log("PLAYBACK_STOP", "elapsed=${(System.nanoTime() - startedNs) / 1_000_000L}ms")
        }
    }

    val decoderRecovery = remember(player, activeSource.url) {
        com.vueo.shared.core.player.VideoDecoderRecovery(videoDecoderSession)
    }

    DisposableEffect(player, liveSmartSubs, activeSource.url, settings.autoSourceRecoveryEnabled()) {
        val listener = object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) {
                val combinedTracks = LiveSmartSubs.mergedTracks(player, tracks)
                val currentTextTracks = tvPlayerTrackChoices(
                    tracks = combinedTracks,
                    trackType = C.TRACK_TYPE_TEXT,
                    externalSubtitles = latestExternalSubtitlesBySelectionId.value,
                )
                val keepPreviousTextTracks =
                    subtitleTrackRefreshInProgress && currentTextTracks.isEmpty()
                if (!keepPreviousTextTracks) {
                    textTracks = tvMergeDiscoveredSubtitleChoices(
                        playerChoices = currentTextTracks,
                        discoveredSubtitles = latestLiveSubtitles.value,
                    )
                }
                val effectiveTextTracks =
                    if (keepPreviousTextTracks) textTracks else currentTextTracks
                val confirmedSubtitleSelectionId = effectiveTextTracks
                    .firstOrNull { it.selected }
                    ?.selectionId
                if (
                    requestedSubtitleSelectionId != null &&
                    requestedSubtitleSelectionId == confirmedSubtitleSelectionId
                ) {
                    requestedSubtitleSelectionId = null
                }
                audioTracks = tvPlayerTrackChoices(
                    tracks = combinedTracks,
                    trackType = C.TRACK_TYPE_AUDIO,
                )
            }

            override fun onPlayerError(error: PlaybackException) {
                com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlaybackError(
                        platform = "TV", provider = activeSource.providerName,
                        server = activeSource.serverName ?: activeSource.name,
                        url = activeSource.url, mimeType = player.currentMediaItem?.localConfiguration?.mimeType,
                        errorCode = error.errorCode, errorName = error.errorCodeName,
                        positionMs = player.currentPosition, state = player.playbackState, error = error,
                    )
                val failedFormat = (error as? androidx.media3.exoplayer.ExoPlaybackException)
                    ?.rendererFormat
                if (playerForeground && !exitingPlayer &&
                    decoderRecovery.tryRecover(player, error, failedFormat, "TV", positionMs)
                ) {
                    playbackError = null
                    isBuffering = true
                    return
                }
                isBuffering = false
                handleSourceFailure(
                    decoderRecovery.failureMessage(error, failedFormat)
                        ?: (error.message ?: "Playback failed.")
                )
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                isBuffering = playbackState == Player.STATE_BUFFERING
                if (playbackState == Player.STATE_READY) {
                    if (subtitleTrackRefreshInProgress) {
                        subtitleTrackRefreshInProgress = false
                        val finalTextTracks = tvPlayerTrackChoices(
                            tracks = LiveSmartSubs.mergedTracks(player),
                            trackType = C.TRACK_TYPE_TEXT,
                            externalSubtitles = latestExternalSubtitlesBySelectionId.value,
                        )
                        textTracks = tvMergeDiscoveredSubtitleChoices(
                            playerChoices = finalTextTracks,
                            discoveredSubtitles = latestLiveSubtitles.value,
                        )
                        val confirmedSubtitleSelectionId = finalTextTracks
                            .firstOrNull { it.selected }
                            ?.selectionId
                        if (
                            requestedSubtitleSelectionId != null &&
                            requestedSubtitleSelectionId == confirmedSubtitleSelectionId
                        ) {
                            requestedSubtitleSelectionId = null
                        }
                    }
                    sourceRecoverySession.markReady()
                    recoveryInProgress = false
                    playbackError = null
                }
                if (playbackState == Player.STATE_ENDED) {
                    clearPendingSeek()
                    val finalDuration = player.duration.takeIf { it > 0L && it != C.TIME_UNSET }
                    durationMs = finalDuration ?: 0L
                    positionMs = finalDuration ?: player.currentPosition.coerceAtLeast(0L)
                    if (!completionPersistenceQueued) {
                        completionPersistenceQueued = true
                        val completedDuration = player.duration.takeIf { it > 0L && it != C.TIME_UNSET }?.coerceAtLeast(0L) ?: 0L
                        val completionSnapshot = runtime.playbackStore.capturePosition(
                            mediaKey = mediaKey,
                            positionMs = completedDuration,
                            durationMs = completedDuration,
                        )
                        enqueueTvPlayerPersistence(
                            block = {
                                runtime.playbackStore.persistSnapshot(completionSnapshot)
                                runtime.libraryStore.recordPlayback(
                                    media = media,
                                    videoId = bundle.videoId,
                                    episodeTitle = episode?.title,
                                    season = episode?.season,
                                    episode = episode?.episode,
                                    positionMs = completedDuration,
                                    durationMs = completedDuration,
                                    lastWatchedEpochMs = completionSnapshot.updatedAtEpochMs,
                                )
                            },
                            afterPersist = {
                                libraryProgressRevision += 1
                                onLibraryChanged()
                            },
                        )
                    }
                    ended = true
                    playing = false
                    if (!endedControlsDismissed &&
                        (!autoPlayNextEpisode || nextEpisode == null || autoNextCancelled)
                    ) {
                        requestControlFocus(progressRequester)
                    }
                }
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                playbackRequested = playWhenReady
                pauseBackdropVisible = false
                noteInteraction()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
                if (
                    !exitingPlayer &&
                    !isPlaying &&
                    player.playbackState != Player.STATE_ENDED &&
                    !player.playWhenReady
                ) {
                    // Buffering/seeking can transiently flip isPlaying=false while
                    // playWhenReady stays true. Do not parse/serialize the full
                    // library history for those transient state changes.
                    saveProgress(backgroundLibrary = true)
                    if (controlsVisible && activePanel == TvPlayerPanel.NONE) {
                        requestControlFocus(progressRequester)
                    }
                }
            }

            override fun onRenderedFirstFrame() {
                if (startupAudioMuted) {
                    player.volume = 1f
                    startupAudioMuted = false
                }
                if (!hasRenderedFirstFrame && episode != null) {
                    saveProgress(backgroundLibrary = true)
                }
                hasRenderedFirstFrame = true
                isBuffering = false
                sourceRecoverySession.markReady()
                recoveryInProgress = false
                playbackError = null
                latestEpisodeFrameReady.value.invoke()
            }
        }
        val overlayTracksChanged: (Boolean) -> Unit = { choicesChanged ->
            if (choicesChanged) subtitlePreferenceRestored = false
            listener.onTracksChanged(player.currentTracks)
        }
        liveSmartSubs.addTrackListener(overlayTracksChanged)
        player.addListener(listener)
        onDispose {
            liveSmartSubs.removeTrackListener(overlayTracksChanged)
            player.removeListener(listener)
        }
    }

    LaunchedEffect(activeSource.url, hasRenderedFirstFrame, playbackError, retryGeneration) {
        if (hasRenderedFirstFrame || playbackError != null) return@LaunchedEffect

        val timeoutMs = if (sourceRecoverySession.isAutomaticRecoveryActive()) {
            SOURCE_RECOVERY_SOURCE_TIMEOUT_MS
        } else {
            SOURCE_STARTUP_TIMEOUT_MS
        }
        delay(timeoutMs)
        if (!hasRenderedFirstFrame && playbackError == null && !recoveryInProgress) {
            handleSourceFailure(
                "This source did not start within ${timeoutMs / 1_000L} seconds."
            )
        }
    }

    LaunchedEffect(activeSource.url, isBuffering, hasRenderedFirstFrame, playbackError, retryGeneration) {
        if (!isBuffering || !hasRenderedFirstFrame || playbackError != null) {
            return@LaunchedEffect
        }

        delay(SOURCE_REBUFFER_TIMEOUT_MS)
        if (isBuffering && hasRenderedFirstFrame && playbackError == null && !recoveryInProgress) {
            handleSourceFailure(
                "Playback remained stuck buffering for ${SOURCE_REBUFFER_TIMEOUT_MS / 1_000L} seconds."
            )
        }
    }

    LaunchedEffect(media.id, bundle.videoId, episode?.id, runtime.pluginStore.tmdbApiKey()) {
        resolvedImdbId =
            ContentWarningRepository.extractImdbId(media.id)
                ?: ContentWarningRepository.extractImdbId(bundle.videoId)
                ?: ContentWarningRepository.extractImdbId(episode?.id)
                ?: runCatching {
                    TmdbEnhancementClient.prepareForCore(
                        item = media,
                        apiKey = runtime.pluginStore.tmdbApiKey(),
                    ).id
                }.getOrNull()?.let(ContentWarningRepository::extractImdbId)
    }

    LaunchedEffect(
        resolvedImdbId,
        episode?.season,
        episode?.episode,
        skipSegmentsEnabled,
    ) {
        skipSegments = emptyList()
        val imdbId = resolvedImdbId
        if (skipSegmentsEnabled && episode != null && imdbId != null) {
            for (attempt in 0 until 3) {
                skipSegments = PlayerSkipRepository.segments(imdbId, episode.season, episode.episode)
                if (skipSegments.isNotEmpty() || attempt == 2) break
                delay(31_000L)
            }
        }
    }

    LaunchedEffect(resolvedImdbId, contentWarningsEnabled, playerSessionId) {
        contentWarnings = emptyList()
        warningVisible = false
        warningShown = false

        val imdbId = resolvedImdbId
        if (contentWarningsEnabled && imdbId != null) {
            contentWarnings = runCatching {
                ContentWarningRepository.get(imdbId)
            }.getOrDefault(emptyList())
        }
    }

    LaunchedEffect(
        hasRenderedFirstFrame,
        contentWarnings,
        contentWarningsEnabled,
        playerSessionId,
    ) {
        if (!contentWarningsEnabled) {
            warningVisible = false
            return@LaunchedEffect
        }

        if (hasRenderedFirstFrame && contentWarnings.isNotEmpty() && !warningShown) {
            warningShown = true
            warningVisible = true
        }
    }

    LaunchedEffect(bundle.videoId, textTracks.map { it.selectionId }) {
        com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlayerEvent("TV", "SUBTITLE_TRACKS_VISIBLE",
            "episode=${episode?.episode ?: 0} tracks=${textTracks.size} external=${liveSubtitles.size}")
    }

    LaunchedEffect(player, activeSource.url, bundle.videoId) {
        if (controlsVisible && activePanel == TvPlayerPanel.NONE) {
            controlFocusHandoffPending = !requestFocusNow(progressRequester)
        }
        while (true) {
            durationMs = player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L
            val playbackEnded = player.playbackState == Player.STATE_ENDED
            val displayPosition = if (playbackEnded) {
                // With no known duration, retain the final position captured by the listener.
                if (durationMs > 0L) durationMs else positionMs
            } else {
                pendingSeekPositionMs ?: player.currentPosition.coerceAtLeast(0L)
            }
            positionMs = if (durationMs > 0L) displayPosition.coerceIn(0L, durationMs)
                else displayPosition.coerceAtLeast(0L)
            playing = player.isPlaying
            ended = playbackEnded

            if (!audioPreferenceRestored || !subtitlePreferenceRestored) {
                val currentTextTracks = tvPlayerTrackChoices(
                    tracks = LiveSmartSubs.mergedTracks(player),
                    trackType = C.TRACK_TYPE_TEXT,
                    externalSubtitles = latestExternalSubtitlesBySelectionId.value,
                )
                val currentAudioTracks = tvPlayerTrackChoices(
                    tracks = LiveSmartSubs.mergedTracks(player),
                    trackType = C.TRACK_TYPE_AUDIO,
                )
                val keepPreviousTextTracks =
                    subtitleTrackRefreshInProgress && currentTextTracks.isEmpty()
                if (!keepPreviousTextTracks) {
                    textTracks = tvMergeDiscoveredSubtitleChoices(
                        playerChoices = currentTextTracks,
                        discoveredSubtitles = latestLiveSubtitles.value,
                    )
                }
                audioTracks = currentAudioTracks

                val tracksBelongToActiveSource =
                    player.currentMediaItem?.localConfiguration?.uri?.toString() == activeSource.url

                if (tracksBelongToActiveSource && !audioPreferenceRestored && currentAudioTracks.isNotEmpty()) {
                val globalSelection = settings.lastAudioSelection()
                val savedSelection = globalSelection ?: settings.audioSelection(mediaKey)
                val savedTrack = tvFindSavedAudioTrack(currentAudioTracks, savedSelection)
                when {
                    savedSelection == TV_AUDIO_AUTO -> {
                        if (globalSelection == null) settings.setLastAudioSelection(TV_AUDIO_AUTO)
                        tvClearTrackOverride(player, C.TRACK_TYPE_AUDIO, disable = false)
                        audioAutomaticSelected = true
                    }
                    savedTrack != null -> {
                        tvApplyTrackChoice(player, C.TRACK_TYPE_AUDIO, savedTrack)
                        audioAutomaticSelected = false
                    }
                    else -> audioAutomaticSelected = true
                }
                audioPreferenceRestored = true
            }

            if (tracksBelongToActiveSource && !subtitlePreferenceRestored && currentTextTracks.isNotEmpty()) {
                val globalSelection = settings.lastSubtitleSelection()
                val savedSelection = globalSelection
                val savedLanguage = globalSelection
                    ?.takeIf { it.startsWith(TV_SUBTITLE_LANGUAGE_PREFIX) }
                    ?.removePrefix(TV_SUBTITLE_LANGUAGE_PREFIX)
                val savedTrack = savedLanguage?.let { language ->
                    currentTextTracks.firstOrNull {
                        tvCanonicalLanguage(it.language) == tvCanonicalLanguage(language)
                    }
                }

                when {
                    savedSelection == TV_SUBTITLE_OFF -> {
                        tvClearTrackOverride(player, C.TRACK_TYPE_TEXT, disable = true)
                        subtitlesDisabled = true
                        pendingSubtitleSelectionId = null
                        translatingSubtitleSelectionId = null
                        requestedSubtitleSelectionId = null
                    }

                    savedTrack?.externalSubtitle != null && savedTrack.override != null &&
                        SubtitleSessionCache.get(requireNotNull(savedTrack.externalSubtitle).url) != null -> {
                        subtitlePreparationJob?.cancel()
                        subtitlePreparationJob = null
                        pendingSubtitleSelectionId = null
                        translatingSubtitleSelectionId = null
                        requestedSubtitleSelectionId = savedTrack.selectionId
                        tvApplyTrackChoice(player, C.TRACK_TYPE_TEXT, savedTrack)
                        subtitlesDisabled = false
                    }

                    savedTrack?.externalSubtitle != null -> {
                        tvClearTrackOverride(player, C.TRACK_TYPE_TEXT, disable = true)
                        subtitlesDisabled = false
                        pendingSubtitleSelectionId = savedTrack.selectionId
                        translatingSubtitleSelectionId = if (savedTrack.externalSubtitle?.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) savedTrack.selectionId else null
                        if (savedTrack.externalSubtitle?.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                            smartSubsMessage = "Preparing Malay AI… waiting for SmartSubs."
                        }
                        subtitlePreparationJob?.cancel()
                        subtitlePreparationJob = focusScope.launch {
                            val ready = SubtitleReadinessProbe.awaitReady(
                                url = requireNotNull(savedTrack.externalSubtitle).url,
                                onWaiting = {
                                    if (pendingSubtitleSelectionId == savedTrack.selectionId) {
                                        translatingSubtitleSelectionId = savedTrack.selectionId
                                    }
                                },
                            )
                            var latestChoice: TvPlayerTrackChoice? = null
                            var trackWaitAttempts = 0
                            while (
                                ready &&
                                pendingSubtitleSelectionId == savedTrack.selectionId &&
                                latestChoice == null &&
                                trackWaitAttempts < 200
                            ) {
                                latestChoice = tvPlayerTrackChoices(
                                    tracks = LiveSmartSubs.mergedTracks(player),
                                    trackType = C.TRACK_TYPE_TEXT,
                                    externalSubtitles = latestExternalSubtitlesBySelectionId.value,
                                ).firstOrNull {
                                    it.selectionId == savedTrack.selectionId
                                }
                                if (latestChoice == null) {
                                    delay(50L)
                                    trackWaitAttempts += 1
                                }
                            }
                            if (
                                ready &&
                                pendingSubtitleSelectionId == savedTrack.selectionId &&
                                latestChoice != null
                            ) {
                                requestedSubtitleSelectionId = latestChoice.selectionId
                                val confirmed = applyAndConfirmTvSubtitleChoice(
                                    player = player,
                                    selectionId = latestChoice.selectionId,
                                    externalSubtitles = {
                                        latestExternalSubtitlesBySelectionId.value
                                    },
                                    stillRequested = {
                                        pendingSubtitleSelectionId == savedTrack.selectionId
                                    },
                                )
                                if (confirmed) {
                                    if (savedTrack.externalSubtitle?.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                                        smartSubsMessage = "Malay AI loaded and selected."
                                    }
                                    pendingSubtitleSelectionId = null
                                    translatingSubtitleSelectionId = null
                                    requestedSubtitleSelectionId = null
                                    subtitlesDisabled = false
                                }
                            }
                            if (pendingSubtitleSelectionId == savedTrack.selectionId &&
                                savedTrack.externalSubtitle?.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                                smartSubsMessage = "Malay AI not ready or could not be selected. Retry the track or open Diagnose in Gemini settings."
                            }
                            if (translatingSubtitleSelectionId == savedTrack.selectionId) {
                                translatingSubtitleSelectionId = null
                            }
                            subtitlePreparationJob = null
                        }
                    }

                    savedTrack != null -> {
                        pendingSubtitleSelectionId = null
                        translatingSubtitleSelectionId = null
                        requestedSubtitleSelectionId = savedTrack.selectionId
                        tvApplyTrackChoice(player, C.TRACK_TYPE_TEXT, savedTrack)
                        subtitlesDisabled = false
                    }
                    savedSelection == null -> {
                        subtitlesDisabled = !settings.subtitlesOnByDefault()
                    }
                }
                subtitlePreferenceRestored = true
                }
            }

            delay(400)
        }
    }

    LaunchedEffect(player, mediaKey) {
        while (true) {
            delay(10_000)
            val currentPosition = player.currentPosition.coerceAtLeast(0L)
            val currentDuration = player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L
            if (currentPosition > 0L) {
                val periodicPosition =
                    if (autoNextCompletedCurrent && currentDuration > 0L) currentDuration else currentPosition
                val periodicSnapshot = runtime.playbackStore.capturePosition(
                    mediaKey = mediaKey,
                    positionMs = periodicPosition,
                    durationMs = currentDuration,
                )
                enqueueTvPlayerPersistence(
                    block = {
                        runtime.playbackStore.persistSnapshot(periodicSnapshot)
                    },
                )
            }
        }
    }

    LaunchedEffect(activePanel, controlsVisible, restorePanelFocus) {
        if (restorePanelFocus == null) return@LaunchedEffect
        if (activePanel != TvPlayerPanel.NONE || !controlsVisible) return@LaunchedEffect
        controlFocusHandoffPending = !requestFocusNow(progressRequester)
        restorePanelFocus = null
    }

    LaunchedEffect(autoNextEligible, nextEpisode?.id) {
        val targetEpisode = nextEpisode
        if (!autoNextEligible || targetEpisode == null) {
            nextCountdown = 0
            return@LaunchedEffect
        }
        for (remaining in 8 downTo 1) {
            nextCountdown = remaining
            delay(1_000L)
            if (!latestAutoNextEligible.value) {
                nextCountdown = 0
                return@LaunchedEffect
            }
        }
        // Recheck the real player, rather than trusting the 400ms UI poll, at
        // dispatch time. A pause/seek/buffer must never advance the episode.
        val actualDuration = player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L
        val finished = player.playbackState == Player.STATE_ENDED
        val safeCredits = skipSegmentsEnabled && player.isPlaying && PlayerSkipPolicy.canStartNextDuringCredits(
            skipSegments, player.currentPosition, actualDuration,
        )
        nextCountdown = 0
        if (!latestAutoNextEligible.value || !player.playWhenReady ||
            activePanel != TvPlayerPanel.NONE || playbackError != null ||
            recoveryInProgress || pendingSeekPositionMs != null ||
            autoNextCancelled || !autoPlayNextEpisode ||
            (!finished && !safeCredits) || nextEpisodeDispatched
        ) {
            return@LaunchedEffect
        }
        nextEpisodeDispatched = true
        clearPendingSeek()
        queueEpisodeHandoffProgress(markCompleted = true)
        onPlayNextEpisode(targetEpisode, activeSource)
    }

    LaunchedEffect(episodeSwitching) {
        if (episodeSwitching) {
            activePanel = TvPlayerPanel.NONE
            hideControls()
        } else {
            // If discovery was cancelled/failed and this same Player survived,
            // allow future progress saves. A successful handoff disposes this
            // videoId and the next Player starts with fresh flags instead.
            episodeHandoffPersistenceQueued = false
            nextEpisodeDispatched = false
            requestFocusReliably(rootRequester)
        }
    }

    LaunchedEffect(playbackError) {
        val error = playbackError ?: return@LaunchedEffect
        latestEpisodePlaybackFailed.value.invoke(error)
        if (episodeSwitching) return@LaunchedEffect
        controlsVisible = true
        controlFocusHandoffPending = true
        val restored = requestFocusNow(errorRequester) || requestFocusNow(progressRequester)
        controlFocusHandoffPending = !restored
    }

    LaunchedEffect(ended, activePanel, playbackError) {
        if (!ended) {
            endedFocusAssigned = false
            endedControlsDismissed = false
            return@LaunchedEffect
        }
        if (
            episodeSwitching || endedFocusAssigned || endedControlsDismissed ||
            autoNextEligible || nextCountdown > 0 ||
            activePanel != TvPlayerPanel.NONE ||
            playbackError != null
        ) {
            return@LaunchedEffect
        }
        controlsVisible = true
        controlFocusHandoffPending = true
        endedFocusAssigned = requestFocusNow(progressRequester)
        controlFocusHandoffPending = !endedFocusAssigned
    }

    LaunchedEffect(nextCountdown > 0, activePanel, playbackError) {
        if (
            nextCountdown > 0 &&
            activePanel == TvPlayerPanel.NONE &&
            playbackError == null
        ) {
            // The next card owns focus independently of full player chrome.
            val restored = requestFocusNow(nextContextRequester)
            if (!restored) {
                if (controlsVisible) requestControlFocus(progressRequester)
                else requestFocusReliably(rootRequester)
            }
        }
    }

    LaunchedEffect(activeSkip?.key, nextCountdown > 0, activePanel, controlsVisible, playbackError, pauseBackdropVisible) {
        if (activePanel != TvPlayerPanel.NONE || playbackError != null) return@LaunchedEffect

        // When Skip is the only contextual action on a clean playback screen,
        // give it focus immediately so OK activates it without an extra D-pad move.
        // Do not steal focus when full controls or the Next Episode card are visible.
        val skipPromptVisible = activeSkip != null && !pauseBackdropVisible
        val standaloneSkip = skipPromptVisible && nextCountdown <= 0 && !controlsVisible
        if (standaloneSkip) {
            val focused = requestFocusNow(skipRequester)
            if (focused) {
                focusedPrompt = TvPlayerPromptTarget.SKIP
                controlFocusHandoffPending = false
            } else {
                requestFocusReliably(rootRequester)
            }
            return@LaunchedEffect
        }

        val removedFocusedPrompt = when (focusedPrompt) {
            TvPlayerPromptTarget.SKIP -> !skipPromptVisible
            TvPlayerPromptTarget.NEXT -> nextCountdown <= 0
            TvPlayerPromptTarget.NONE -> false
        }
        if (removedFocusedPrompt) {
            focusedPrompt = TvPlayerPromptTarget.NONE
            if (controlsVisible) {
                requestControlFocus(progressRequester)
            } else {
                controlFocusHandoffPending = false
                requestFocusReliably(rootRequester)
            }
        }
    }

    var dialogueSyncOpen by remember(player, mediaKey, activeSource.url) { mutableStateOf(false) }
    var dialogueSyncTrack by remember(player, mediaKey, activeSource.url) { mutableStateOf<SubtitleTrack?>(null) }

    val pauseBackdropEligible = !dialogueSyncOpen && !playbackRequested && !playing && hasRenderedFirstFrame &&
        player.playbackState == Player.STATE_READY && !isBuffering && !recoveryInProgress &&
        !ended && playbackError == null && !episodeSwitching && playerForeground &&
        activePanel == TvPlayerPanel.NONE && pendingSeekPositionMs == null && nextCountdown <= 0
    LaunchedEffect(player, pauseBackdropEligible, interactionToken) {
        pauseBackdropVisible = false
        if (pauseBackdropEligible) {
            delay(8_000L)
            // Recheck the player intent at dispatch; buffering is never a pause.
            if (!player.playWhenReady && player.playbackState == Player.STATE_READY) {
                hideControls()
                pauseBackdropVisible = true
            }
        }
    }

    LaunchedEffect(controlsVisible, activePanel, interactionToken, playing, nextCountdown > 0) {
        if (controlsVisible && activePanel == TvPlayerPanel.NONE && playing && nextCountdown <= 0) {
            val token = interactionToken
            delay(4_500)
            if (token == interactionToken && activePanel == TvPlayerPanel.NONE) {
                hideControls()
            }
        }
    }

    DisposableEffect(player) {
        onDispose {
            player.volume = 0f
            runCatching { player.pause() }
            if (!exitingPlayer && !episodeHandoffPersistenceQueued && !completionPersistenceQueued) {
                runCatching { saveProgress(backgroundLibrary = true) }
            }

            val episodeHandoff = episodeHandoffPersistenceQueued || latestEpisodeSwitching.value
            if (episodeHandoff) {
                // Episode-to-episode handoff stays inside the Player. Release the
                // old MediaCodec immediately so low-resource TV devices never hold
                // the old and new video decoders for an artificial extra 64 ms.
                runCatching { player.release() }
            } else {
                // Keep the one-frame defer only for actual navigation/source disposal,
                // where it lets the return surface present before codec teardown.
                tvPlayerCleanupScope.launch {
                    delay(64L)
                    runCatching { player.release() }
                }
            }
        }
    }

    DisposableEffect(player, lifecycleOwner, mediaKey) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    playerForeground = false
                    pauseBackdropVisible = false
                    resumeAfterLifecyclePause = player.playWhenReady
                    if (player.playWhenReady) player.pause()
                    runCatching { saveProgress(backgroundLibrary = true) }
                }
                Lifecycle.Event.ON_START -> {
                    playerForeground = true
                    noteInteraction()
                    if (resumeAfterLifecyclePause) {
                        resumeAfterLifecyclePause = false
                        player.play()
                    }
                }
                else -> Unit
            }
        }
        lifecycleOwner?.lifecycle?.addObserver(observer)
        onDispose { lifecycleOwner?.lifecycle?.removeObserver(observer) }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(rootRequester)
            .onFocusChanged {
                if (it.isFocused) {
                    focusedPrompt = TvPlayerPromptTarget.NONE
                    controlFocusHandoffPending = controlsVisible
                }
            }
            .onPreviewKeyEvent { event ->
                val code = event.nativeKeyEvent.keyCode
                // Own the full dismissal press, including repeats and KeyUp,
                // so it cannot seek, activate a skip prompt or exit the player.
                if (pauseBackdropCapturedKey[0] != 0 && pauseBackdropCapturedKey[0] == code) {
                    noteInteraction()
                    if (event.type == KeyEventType.KeyUp) {
                        pauseBackdropCapturedKey[0] = 0
                        if (!event.nativeKeyEvent.isCanceled && !latestEpisodeSwitching.value &&
                            playbackError == null && (code == KeyEvent.KEYCODE_DPAD_CENTER ||
                                code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER)
                        ) {
                            player.play()
                        }
                    }
                    return@onPreviewKeyEvent true
                }
                if (event.type == KeyEventType.KeyDown) {
                    val dismissingBackdrop = pauseBackdropVisible
                    noteInteraction()
                    if (dismissingBackdrop) {
                        pauseBackdropCapturedKey[0] = code
                        return@onPreviewKeyEvent true
                    }
                }
                // Capture the complete hardware Back press before focused children
                // can clear focus. Workspace Back remains owned by its handlers.
                if (code == KeyEvent.KEYCODE_BACK &&
                    (backPressCaptured[0] || activePanel == TvPlayerPanel.NONE)
                ) {
                    if (event.type == KeyEventType.KeyDown) {
                        backPressCaptured[0] = true
                    } else if (event.type == KeyEventType.KeyUp && backPressCaptured[0]) {
                        backPressCaptured[0] = false
                        if (!event.nativeKeyEvent.isCanceled) handlePlayerBack()
                    }
                    return@onPreviewKeyEvent true
                }
                // Own both halves of hidden OK so repeats cannot toggle playback
                // repeatedly or activate a child after focus changes.
                if (hiddenPlaybackActivationKey[0] != 0 && hiddenPlaybackActivationKey[0] == code) {
                    if (event.type == KeyEventType.KeyUp) {
                        hiddenPlaybackActivationKey[0] = 0
                        if (!event.nativeKeyEvent.isCanceled && !latestEpisodeSwitching.value &&
                            !controlsVisible && activePanel == TvPlayerPanel.NONE && playbackError == null
                        ) {
                            togglePlayback()
                        }
                    }
                    return@onPreviewKeyEvent true
                }
                if (event.type == KeyEventType.KeyUp && revealActivationKey[0] == code) {
                    revealActivationKey[0] = 0
                    return@onPreviewKeyEvent true
                }
                if (
                    event.type == KeyEventType.KeyUp &&
                    pendingSeekPositionMs != null &&
                    (
                        code == KeyEvent.KEYCODE_DPAD_LEFT ||
                            code == KeyEvent.KEYCODE_DPAD_RIGHT ||
                            code == KeyEvent.KEYCODE_MEDIA_REWIND ||
                            code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
                    )
                ) {
                    // Commit the previewed seek once on release for both hidden
                    // and visible controls. The scheduled job is only a fallback.
                    if (seekCommitJob[0] != null) commitPendingSeek()
                    return@onPreviewKeyEvent true
                }
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                if (
                    controlsVisible || activePanel != TvPlayerPanel.NONE
                ) {
                    when (code) {
                        KeyEvent.KEYCODE_DPAD_UP,
                        KeyEvent.KEYCODE_DPAD_DOWN,
                        KeyEvent.KEYCODE_DPAD_LEFT,
                        KeyEvent.KEYCODE_DPAD_RIGHT,
                        KeyEvent.KEYCODE_DPAD_CENTER,
                        KeyEvent.KEYCODE_ENTER -> noteInteraction()
                    }
                }

                when (code) {
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        togglePlayback()
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_PLAY -> {
                        player.play()
                        playing = true
                        noteInteraction()
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                        player.pause()
                        playing = false
                        noteInteraction()
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_REWIND -> {
                        val repeatCount = event.nativeKeyEvent.repeatCount
                        val delta = tvLongPressSeekDeltaMs(
                            direction = -1,
                            heldDurationMs = if (repeatCount == 0) 0L else
                                (event.nativeKeyEvent.eventTime - event.nativeKeyEvent.downTime).coerceAtLeast(0L),
                        )
                        if (repeatCount == 0) seekImmediateBy(delta) else seekBy(delta)
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                        val repeatCount = event.nativeKeyEvent.repeatCount
                        val delta = tvLongPressSeekDeltaMs(
                            direction = 1,
                            heldDurationMs = if (repeatCount == 0) 0L else
                                (event.nativeKeyEvent.eventTime - event.nativeKeyEvent.downTime).coerceAtLeast(0L),
                        )
                        if (repeatCount == 0) seekImmediateBy(delta) else seekBy(delta)
                        true
                    }
                    else -> {
                        if (
                            activePanel != TvPlayerPanel.NONE ||
                            (controlsVisible && !controlFocusHandoffPending) ||
                            (((focusedPrompt == TvPlayerPromptTarget.NEXT && nextCountdown > 0) ||
                                (focusedPrompt == TvPlayerPromptTarget.SKIP && activeSkip != null)) &&
                                (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER ||
                                    code == KeyEvent.KEYCODE_NUMPAD_ENTER))
                        ) {
                            false
                        } else {
                            when (code) {
                                KeyEvent.KEYCODE_DPAD_CENTER,
                                KeyEvent.KEYCODE_ENTER,
                                KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                                    if (!controlsVisible && playbackError == null && !latestEpisodeSwitching.value) {
                                        hiddenPlaybackActivationKey[0] = code
                                    } else {
                                        revealActivationKey[0] = code
                                        requestControlFocus(
                                            if (playbackError != null) errorRequester else progressRequester
                                        )
                                    }
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_LEFT -> {
                                    if (controlsVisible) requestControlFocus(progressRequester)
                                    val repeatCount = event.nativeKeyEvent.repeatCount
                                    val delta = tvLongPressSeekDeltaMs(
                                        direction = -1,
                                        heldDurationMs = if (repeatCount == 0) 0L else
                                            (event.nativeKeyEvent.eventTime - event.nativeKeyEvent.downTime).coerceAtLeast(0L),
                                    )
                                    if (repeatCount == 0) seekImmediateBy(delta) else seekBy(delta)
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                    if (controlsVisible) requestControlFocus(progressRequester)
                                    val repeatCount = event.nativeKeyEvent.repeatCount
                                    val delta = tvLongPressSeekDeltaMs(
                                        direction = 1,
                                        heldDurationMs = if (repeatCount == 0) 0L else
                                            (event.nativeKeyEvent.eventTime - event.nativeKeyEvent.downTime).coerceAtLeast(0L),
                                    )
                                    if (repeatCount == 0) seekImmediateBy(delta) else seekBy(delta)
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_UP -> {
                                    when {
                                        playbackError != null -> requestControlFocus(errorRequester)
                                        activeSkip != null -> requestControlFocus(skipRequester)
                                        nextCountdown > 0 && nextEpisode != null -> requestControlFocus(nextContextRequester)
                                        else -> requestControlFocus(restartRequester)
                                    }
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_DOWN -> {
                                    val bottomRequester = when {
                                        hasSubtitleControl -> subtitlesRequester
                                        hasAudioControl -> audioRequester
                                        hasSourcesControl -> sourcesRequester
                                        hasEpisodesControl -> episodesRequester
                                        else -> progressRequester
                                    }
                                    requestControlFocus(bottomRequester)
                                    true
                                }
                                else -> false
                            }
                        }
                    }
                }
            }
            .focusable(enabled = activePanel == TvPlayerPanel.NONE),
    ) {
        val exoPlayer = player
        // Capture one immutable value for this AndroidView update. Never pair
        // a live state read with a separately remembered caption payload.
        val subtitlePresentation = subtitleStyle
        val resizeMode = when (videoFit) {
            PlayerVideoFit.FIT -> AspectRatioFrameLayout.RESIZE_MODE_FIT
            // A TV-style Fill should crop while preserving the source aspect ratio.
            // Media3 RESIZE_MODE_FILL stretches the picture, so use ZOOM instead.
            PlayerVideoFit.FILL -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            PlayerVideoFit.ZOOM -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        }
        val baseSubtitleBottomPaddingFraction = subtitlePresentation.bottomPaddingPercent / 100f
        val subtitleBottomPaddingFraction = if (controlsVisible && activePanel == TvPlayerPanel.NONE) {
            maxOf(baseSubtitleBottomPaddingFraction, 0.18f)
        } else {
            baseSubtitleBottomPaddingFraction
        }

        AndroidView(
            factory = { viewContext ->
                TvSubtitlePlayerView(viewContext).apply {
                    useController = false
                    isFocusable = false
                    isFocusableInTouchMode = false
                    keepScreenOn = true
                    bindPlayer(exoPlayer, "$mediaKey:${activeSource.url}")
                    setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                    this.resizeMode = resizeMode
                    applySubtitlePresentation(subtitlePresentation, subtitleBottomPaddingFraction)
                }
            },
            update = {
                it.bindPlayer(exoPlayer, "$mediaKey:${activeSource.url}")
                it.isFocusable = false
                it.isFocusableInTouchMode = false
                it.keepScreenOn = true
                it.resizeMode = resizeMode
                it.applySubtitlePresentation(subtitlePresentation, subtitleBottomPaddingFraction)
            },
            modifier = Modifier.fillMaxSize(),
        )

        val orderedEpisodes = remember(media.episodes) {
            media.episodes.sortedWith(compareBy<EpisodeItem> { it.season }.thenBy { it.episode })
        }
        var savedEpisodeProgress by remember(media.id, media.type) {
            mutableStateOf<Map<Pair<Int, Int>, TvEpisodeProgress>>(emptyMap())
        }
        LaunchedEffect(media.id, media.type, libraryProgressRevision) {
            savedEpisodeProgress = kotlinx.coroutines.withContext(Dispatchers.IO) {
                val result = linkedMapOf<Pair<Int, Int>, TvEpisodeProgress>()
                runtime.libraryStore.history()
                    .asSequence()
                    .filter { entry ->
                        entry.media.id == media.id &&
                            entry.media.type == media.type &&
                            entry.season != null &&
                            entry.episode != null
                    }
                    .forEach { entry ->
                        val key = entry.season!! to entry.episode!!
                        if (key !in result) {
                            result[key] = TvEpisodeProgress(
                                positionMs = entry.positionMs,
                                durationMs = entry.durationMs,
                            )
                        }
                    }
                result
            }
        }
        val episodeProgress = remember(
            savedEpisodeProgress,
            episode?.season,
            episode?.episode,
            positionMs,
            durationMs,
        ) {
            val result = savedEpisodeProgress.toMutableMap()
            episode?.let { current ->
                val key = current.season to current.episode
                val saved = result[key]
                val liveDuration = durationMs.takeIf { it > 0L } ?: (saved?.durationMs ?: 0L)
                val livePosition = if (positionMs > 0L || liveDuration > 0L) positionMs else (saved?.positionMs ?: 0L)
                if (livePosition > 0L || liveDuration > 0L) {
                    result[key] = TvEpisodeProgress(livePosition, liveDuration)
                }
            }
            result
        }
        val watchedEpisodeKeys = remember(episodeProgress) {
            episodeProgress.filterValues { it.completed }.keys
        }
        val panelOptions = when (activePanel) {
            TvPlayerPanel.SUBTITLES, TvPlayerPanel.AUDIO -> emptyList()
            TvPlayerPanel.SOURCES -> playableSources.map { item ->
                TvPlayerOption(
                    key = item.url.orEmpty(),
                    title = PlayerSourceDisplay.groupTitle(item),
                    meta = PlayerSourceDisplay.groupedDetails(item),
                    providerName = item.providerName,
                    qualityLabel = com.vueo.shared.core.player.PlayerSourcePolicy.assess(item).quality.label,
                    selected = item.url == activeSource.url,
                    playbackFailed = item.url in sourceRecoverySession.failedSourceUrls() ||
                        (item.url == activeSource.url && playbackError != null),
                )
            }
            TvPlayerPanel.EPISODES -> orderedEpisodes.map { item ->
                TvPlayerOption(
                    key = item.id,
                    title = item.title.ifBlank { "Episode ${item.episode}" },
                    meta = "S${item.season}E${item.episode}" + item.released?.takeIf { it.isNotBlank() }?.let { "  •  $it" }.orEmpty(),
                    selected = episode?.let { current ->
                        current.id == item.id || (current.season == item.season && current.episode == item.episode)
                    } == true,
                )
            }
            TvPlayerPanel.MORE -> emptyList()
            TvPlayerPanel.NONE -> emptyList()
        }

        VueoPlayerPresentation(
            media = media,
            episode = episode,
            activeSource = activeSource,
            controlsVisible = controlsVisible,
            hiddenSeekProgressVisible = hiddenSeekProgressVisible,
            activePanel = activePanel,
            playing = playing,
            playbackRequested = playbackRequested,
            isBuffering = isBuffering,
            playbackFeedbackToken = playbackFeedbackToken,
            playbackFeedbackPaused = playbackFeedbackPaused,
            translatingSubtitles = translatingSubtitleSelectionId != null,
            statusIndicatorsEnabled = !episodeSwitching && !pauseBackdropVisible,
            positionMs = positionMs,
            durationMs = durationMs,
            seekMotionDirect = seekMotionDirect,
            seekHoldActive = seekHoldActive,
            nextEpisode = nextEpisode,
            activeSkip = activeSkip.takeUnless { pauseBackdropVisible },
            nextCountdown = nextCountdown,
            contentWarnings = contentWarnings,
            warningVisible = warningVisible,
            onWarningComplete = { warningVisible = false },
            playbackError = playbackError,
            panelOptions = panelOptions,
            episodes = orderedEpisodes,
            watchedEpisodeKeys = watchedEpisodeKeys,
            episodeProgress = episodeProgress,
            hasSubtitles = hasSubtitleControl,
            hasAudio = hasAudioControl,
            hasSources = hasSourcesControl,
            sourcesSearching = sourcesSearching,
            pluginsStopped = pluginsStopped,
            onRefreshSources = onRefreshSources,
            sourcesStopped = sourcesStopped,
            onStopSources = onStopSources,
            hasEpisodes = hasEpisodesControl,
            restartRequester = restartRequester,
            progressRequester = progressRequester,
            nextRequester = nextRequester,
            subtitlesRequester = subtitlesRequester,
            audioRequester = audioRequester,
            sourcesRequester = sourcesRequester,
            episodesRequester = episodesRequester,
            moreRequester = moreRequester,
            skipRequester = skipRequester,
            nextContextRequester = nextContextRequester,
            errorRequester = errorRequester,
            onInteraction = ::noteInteraction,
            onChromeInteraction = {
                focusedPrompt = TvPlayerPromptTarget.NONE
                noteInteraction()
            },
            onPromptFocused = { focusedPrompt = it },
            onPromptNavigateUp = { requestControlFocus(restartRequester) },
            onPromptNavigateDown = { requestControlFocus(progressRequester) },
            onPlayPause = ::togglePlayback,
            onRetryPlayback = {
                saveProgress()
                sourceRecoverySession.allowRetry(activeSource.toSourceCandidateForPlayer())
                resumeTargetMs = player.currentPosition.coerceAtLeast(positionMs).coerceAtLeast(0L)
                playbackError = null
                recoveryInProgress = false
                hasRenderedFirstFrame = false
                startupAudioMuted = true
                player.volume = 0f
                isBuffering = false
                retryGeneration += 1
                decoderRecovery.reset()
                player.stop()
                player.seekTo(resumeTargetMs)
                player.prepare()
                player.play()
                requestControlFocus(progressRequester)
            },
            onRestart = {
                clearPendingSeek()
                autoNextCancelled = false
                nextEpisodeDispatched = false
                autoNextCompletedCurrent = false
                completionPersistenceQueued = false
                episodeHandoffPersistenceQueued = false
                player.seekTo(0L)
                positionMs = 0L
                if (!player.isPlaying) player.play()
                playing = true
                noteInteraction()
            },
            onSeekImmediateBy = ::seekImmediateBy,
            onSeekBy = ::seekBy,
            onSeekCommit = ::commitPendingSeek,
            onNext = {
                nextEpisode?.takeUnless { nextEpisodeDispatched }?.let {
                    nextEpisodeDispatched = true
                    nextCountdown = 0
                    clearPendingSeek()
                    // The contextual Next action only appears after the episode
                    // ended or during credits that safely reach the video end.
                    // Persist the current episode as completed before switching.
                    queueEpisodeHandoffProgress(markCompleted = true)
                    onPlayNextEpisode(it, activeSource)
                }
            },
            onOpenPanel = { panel ->
                activePanel = panel
                noteInteraction()
            },
            onDismissPanel = { closePanel() },
            onSkip = { segment ->
                val actualDuration = player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L
                PlayerSkipPolicy.skipTargetMs(segment, actualDuration)?.let { target ->
                    clearPendingSeek()
                    player.seekTo(target)
                    positionMs = target
                    requestControlFocus(progressRequester)
                }
            },
            onPlayEpisode = { target ->
                val isCurrent = episode?.let { current ->
                    current.id == target.id || (current.season == target.season && current.episode == target.episode)
                } == true
                if (isCurrent) closePanel()
                else if (!nextEpisodeDispatched) {
                    nextEpisodeDispatched = true
                    nextCountdown = 0
                    clearPendingSeek()
                    queueEpisodeHandoffProgress(markCompleted = false)
                    onPlayNextEpisode(target, activeSource)
                }
            },
            onPanelSelected = { option ->
                when (activePanel) {
                    TvPlayerPanel.SUBTITLES, TvPlayerPanel.AUDIO -> Unit
                    TvPlayerPanel.SOURCES -> {
                        val target = playableSources.firstOrNull { it.url == option.key }
                        if (target != null) {
                            if (target.url != activeSource.url) {
                                resumeTargetMs = player.currentPosition.coerceAtLeast(0L)
                                saveProgress()
                                sourceRecoverySession.allowRetry(target.toSourceCandidateForPlayer())
                                activeSource = target
                            }
                            closePanel()
                        }
                    }
                    TvPlayerPanel.EPISODES -> {
                        val target = orderedEpisodes.firstOrNull { it.id == option.key }
                        if (target != null) {
                            val isCurrent = episode?.let { current ->
                                current.id == target.id || (current.season == target.season && current.episode == target.episode)
                            } == true
                            if (isCurrent) closePanel()
                            else {
                                queueEpisodeHandoffProgress(markCompleted = false)
                                onPlayNextEpisode(target, activeSource)
                            }
                        }
                    }
                    TvPlayerPanel.MORE -> Unit
                    TvPlayerPanel.NONE -> Unit
                }
            },
        )

        if (dialogueSyncOpen) {
            TvSubtitleDialogueSyncDialog(
                player = player,
                track = dialogueSyncTrack,
                headers = activeSource.headers,
                delayMs = subtitleDelayMs,
                onApply = { updated ->
                    subtitleDelayMs = updated
                    settings.setSubtitleDelayMs(mediaKey, updated)
                },
                onDismiss = { dialogueSyncOpen = false; runCatching { rootRequester.requestFocus() } },
            )
        }

        VueoPlayerPauseBackdrop(
            visible = pauseBackdropVisible && pauseBackdropEligible,
            media = media,
            episode = episode,
            positionMs = positionMs,
            durationMs = durationMs,
            playbackSpeed = playbackSpeed,
        )

        fun requestSubtitleRefresh() {
            if (subtitleDiscoveryRefreshing) return
            subtitleDiscoveryRefreshing = true
            subtitleRefreshMessage = null
            focusScope.launch {
                try {
                    val added = onRefreshSubtitles()
                    smartSubsRefreshGeneration += 1
                    subtitleRefreshMessage =
                        if (added > 0) {
                            "Subtitles refreshed • +$added new"
                        } else {
                            "No new subtitles found"
                        }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Throwable) {
                    subtitleRefreshMessage = "Subtitle refresh failed • existing tracks kept"
                } finally {
                    subtitleDiscoveryRefreshing = false
                }
            }
        }

        fun requestSubtitleChoice(choice: TvPlayerTrackChoice) {
            val sameRequestInFlight =
                pendingSubtitleSelectionId == choice.selectionId &&
                    subtitlePreparationJob?.isActive == true
            if (sameRequestInFlight) {
                requestedSubtitleSelectionId = choice.selectionId
                return
            }

            val forceNetworkRetry =
                requestedSubtitleSelectionId == choice.selectionId ||
                    (!subtitlesDisabled && choice.selected)
            requestedSubtitleSelectionId = choice.selectionId
            fun commitSelection(selected: TvPlayerTrackChoice) {
                tvApplyTrackChoice(player, C.TRACK_TYPE_TEXT, selected)
                subtitlesDisabled = false
                settings.setLastSubtitleSelection(
                    PlayerTrackPolicy.subtitleLanguageSelectionId(selected.language)
                )
            }

            subtitlePreparationJob?.cancel()
            val externalSubtitle = choice.externalSubtitle
            smartSubsMessage = null
            val cachedChoice = if (externalSubtitle != null && !forceNetworkRetry &&
                SubtitleSessionCache.get(externalSubtitle.url) != null
            ) {
                tvPlayerTrackChoices(
                    tracks = LiveSmartSubs.mergedTracks(player),
                    trackType = C.TRACK_TYPE_TEXT,
                    externalSubtitles = latestExternalSubtitlesBySelectionId.value,
                ).firstOrNull { it.selectionId == choice.selectionId && it.override != null }
            } else null
            if (cachedChoice != null) {
                // Apply in this input callback; confirmation must not gate the track change.
                subtitlePreparationJob = null
                pendingSubtitleSelectionId = null
                translatingSubtitleSelectionId = null
                if (externalSubtitle?.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                    smartSubsMessage = "Malay AI loaded from session cache."
                }
                commitSelection(cachedChoice)
                return
            }
            if (externalSubtitle == null) {
                subtitlePreparationJob = null
                pendingSubtitleSelectionId = null
                translatingSubtitleSelectionId = null
                commitSelection(choice)
            } else {
                pendingSubtitleSelectionId = choice.selectionId
                translatingSubtitleSelectionId = if (externalSubtitle.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) choice.selectionId else null
                if (externalSubtitle.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                    smartSubsMessage = "Preparing Malay AI… waiting for SmartSubs."
                } else smartSubsMessage = null
                // Keep the current subtitle visible while the requested
                // external track is prepared, then replace it only after the
                // player confirms the new selection.
                subtitlePreparationJob = focusScope.launch {
                    val ready = SubtitleReadinessProbe.awaitReady(
                        url = externalSubtitle.url,
                        forceNetwork = forceNetworkRetry,
                        onWaiting = {
                            if (pendingSubtitleSelectionId == choice.selectionId) {
                                translatingSubtitleSelectionId = choice.selectionId
                            }
                        },
                    )
                    var latestChoice: TvPlayerTrackChoice? = null
                    var trackWaitAttempts = 0
                    while (
                        ready &&
                        pendingSubtitleSelectionId == choice.selectionId &&
                        latestChoice == null &&
                        trackWaitAttempts < TV_SUBTITLE_TRACK_ATTACH_WAIT_ATTEMPTS
                    ) {
                        latestChoice = tvPlayerTrackChoices(
                            tracks = LiveSmartSubs.mergedTracks(player),
                            trackType = C.TRACK_TYPE_TEXT,
                            externalSubtitles = latestExternalSubtitlesBySelectionId.value,
                        ).firstOrNull {
                            it.selectionId == choice.selectionId
                        }
                        if (latestChoice == null) {
                            delay(50L)
                            trackWaitAttempts += 1
                        }
                    }
                    var selectionConfirmed = false
                    val preparedChoice = latestChoice
                    if (
                        ready &&
                        pendingSubtitleSelectionId == choice.selectionId &&
                        preparedChoice != null
                    ) {
                        if (forceNetworkRetry && preparedChoice.selected) {
                            // Reselecting the same external subtitle is a deliberate
                            // delivery retry: force the text renderer to reopen the
                            // freshly warmed subtitle session instead of toggling Off.
                            tvClearTrackOverride(player, C.TRACK_TYPE_TEXT, disable = true)
                            delay(50L)
                        }
                        val confirmed = applyAndConfirmTvSubtitleChoice(
                            player = player,
                            selectionId = preparedChoice.selectionId,
                            externalSubtitles = {
                                latestExternalSubtitlesBySelectionId.value
                            },
                            stillRequested = {
                                pendingSubtitleSelectionId == choice.selectionId
                            },
                        )
                        selectionConfirmed = confirmed
                        if (confirmed) {
                            if (externalSubtitle.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                                smartSubsMessage = "Malay AI loaded and selected."
                            }
                            subtitlesDisabled = false
                            settings.setLastSubtitleSelection(
                                PlayerTrackPolicy.subtitleLanguageSelectionId(preparedChoice.language)
                            )
                            pendingSubtitleSelectionId = null
                            translatingSubtitleSelectionId = null
                            requestedSubtitleSelectionId = null
                        }
                    }
                    if (
                        pendingSubtitleSelectionId == choice.selectionId &&
                        !selectionConfirmed
                    ) {
                        if (externalSubtitle.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                            smartSubsMessage = "Malay AI not ready or could not be selected. Retry the track or open Diagnose in Gemini settings."
                        }
                        // Preserve the user's requested selection after a slow/late
                        // delivery. Reselecting the same row explicitly retries it.
                        pendingSubtitleSelectionId = null
                    }
                    if (translatingSubtitleSelectionId == choice.selectionId) {
                        translatingSubtitleSelectionId = null
                    }
                    subtitlePreparationJob = null
                }
            }
        }

        AnimatedVisibility(
            visible = activePanel == TvPlayerPanel.SUBTITLES,
            enter = tvPlayerWorkspaceFadeIn(),
            exit = tvPlayerWorkspaceFadeOut(),
        ) {
            VueoPlayerSubtitleWorkspace(
                refreshing = subtitleDiscoveryRefreshing,
                refreshMessage = smartSubsMessage ?: if (smartSubsRefreshing) "Preparing SmartSubs choices…" else subtitleRefreshMessage,
                onRefresh = ::requestSubtitleRefresh,
                panelModifier = Modifier.animateEnterExit(
                    enter = tvPlayerSidePanelEnter(),
                    exit = tvPlayerSidePanelExit(),
                ),
                onSyncByDialogue = {
                    val selected = textTracks.firstOrNull { it.selected }
                    dialogueSyncTrack = if (!subtitlesDisabled && pendingSubtitleSelectionId == null && translatingSubtitleSelectionId == null) {
                        selected?.externalSubtitle ?: selected?.selectionId?.let { externalSubtitlesBySelectionId[it] }
                    } else null
                    closePanel(restoreFocus = false)
                    hideControls()
                    dialogueSyncOpen = true
                },
                tracks = textTracks,
                subtitlesDisabled = subtitlesDisabled,
                pendingSelectionId = pendingSubtitleSelectionId,
                translatingSelectionId = translatingSubtitleSelectionId,
                requestedSelectionId = requestedSubtitleSelectionId,
                entryFocusRequester = subtitleWorkspaceRequester,
                preferredLanguageCode = settings.preferredSubtitleLanguage().languageCode,
                secondaryLanguageCode = settings.secondarySubtitleLanguage().languageCode,
                preferredLanguageOnly =
                    settings.subtitleVisibility() == SubtitleVisibility.PREFERRED_ONLY,
                subtitleDelayMs = subtitleDelayMs,
                style = subtitleStyle,
                onInteraction = ::noteInteraction,
                onDismissFloat = {
                    closePanel(restoreFocus = false)
                    hideControls()
                },
                onDisable = {
                    smartSubsMessage = null
                    subtitlePreparationJob?.cancel()
                    subtitlePreparationJob = null
                    pendingSubtitleSelectionId = null
                    translatingSubtitleSelectionId = null
                    requestedSubtitleSelectionId = null
                    tvClearTrackOverride(player, C.TRACK_TYPE_TEXT, disable = true)
                    subtitlesDisabled = true
                    settings.setLastSubtitleSelection(TV_SUBTITLE_OFF)
                },
                onSelect = { choice ->
                    requestSubtitleChoice(choice)
                },
                onSubtitleDelayChange = { updated ->
                    subtitleDelayMs = updated.coerceIn(-60_000, 60_000)
                    settings.setSubtitleDelayMs(mediaKey, subtitleDelayMs)
                },
                onStyleChange = { transform ->
                    val updated = transform(subtitleStyle)
                    subtitleStyle = updated
                    settings.setSubtitleFontSizeSp(updated.fontSizeSp)
                    settings.setSubtitleCommentaryFontSizeSp(updated.commentaryFontSizeSp)
                    settings.setSubtitleFontFamily(updated.fontFamily)
                    settings.setSubtitleBold(updated.bold)
                    settings.setTvSubtitleCommentaryEnabled(updated.showCommentary)
                    settings.setSubtitleTextColor(updated.textColor)
                    settings.setSubtitleTextOpacityPercent(alphaPercent(updated.textColor))
                    settings.setSubtitleOutlineEnabled(updated.outlineEnabled)
                    settings.setSubtitleOutlineColor(updated.outlineColor)
                    settings.setSubtitleBackgroundEnabled(updated.backgroundEnabled)
                    settings.setSubtitleBackgroundColor(updated.backgroundColor)
                    settings.setSubtitleBackgroundOpacityPercent(
                        updated.backgroundOpacityPercent
                    )
                    settings.setSubtitleBottomPaddingPercent(updated.bottomPaddingPercent)
                },
            )
        }

        AnimatedVisibility(
            visible = activePanel == TvPlayerPanel.AUDIO,
            enter = tvPlayerWorkspaceFadeIn(),
            exit = tvPlayerWorkspaceFadeOut(),
        ) {
            VueoPlayerAudioWorkspace(
                panelModifier = Modifier.animateEnterExit(
                    enter = tvPlayerSidePanelEnter(),
                    exit = tvPlayerSidePanelExit(),
                ),
                tracks = audioTracks,
                automaticSelected = audioAutomaticSelected,
                activeSourceLabel = activeSource.audio,
                onInteraction = ::noteInteraction,
                onAutomatic = {
                    tvClearTrackOverride(player, C.TRACK_TYPE_AUDIO, disable = false)
                    audioAutomaticSelected = true
                    settings.setAudioSelection(mediaKey, TV_AUDIO_AUTO)
                    settings.setLastAudioSelection(TV_AUDIO_AUTO)
                    closePanel()
                },
                onSelect = { choice ->
                    tvApplyTrackChoice(player, C.TRACK_TYPE_AUDIO, choice)
                    audioAutomaticSelected = false
                    settings.setAudioSelection(mediaKey, choice.selectionId)
                    settings.setLastAudioSelection(choice.selectionId)
                    closePanel()
                },
            )
        }


        AnimatedVisibility(
            visible = activePanel == TvPlayerPanel.MORE,
            enter = tvPanelEnter(),
            exit = tvPanelExit(),
        ) {
            VueoPlayerMoreWorkspace(
                playbackSpeed = playbackSpeed,
                videoFit = videoFit,
                autoPlayNextEpisode = autoPlayNextEpisode,
                skipSegmentsEnabled = skipSegmentsEnabled,
                contentWarningsEnabled = contentWarningsEnabled,
                onInteraction = ::noteInteraction,
                onPlaybackSpeedChange = { speed ->
                    playbackSpeed = speed
                    player.setPlaybackSpeed(speed)
                    settings.setPlayerPlaybackSpeed(speed)
                },
                onVideoFitChange = { fit ->
                    videoFit = fit
                    settings.setPlayerVideoFit(fit)
                },
                onAutoPlayNextEpisodeChange = { enabled ->
                    autoPlayNextEpisode = enabled
                    settings.setAutoPlayNextEpisodeEnabled(enabled)
                    if (!enabled) nextCountdown = 0
                    noteInteraction()
                },
                onSkipSegmentsChange = { enabled ->
                    skipSegmentsEnabled = enabled
                    settings.setSkipSegmentsEnabled(enabled)
                    noteInteraction()
                },
                onContentWarningsChange = { enabled ->
                    contentWarningsEnabled = enabled
                    settings.setContentWarningsEnabled(enabled)
                    if (!enabled) warningVisible = false
                    noteInteraction()
                },
                onReset = {
                    playbackSpeed = 1f
                    player.setPlaybackSpeed(1f)
                    settings.setPlayerPlaybackSpeed(1f)
                    videoFit = PlayerVideoFit.FIT
                    settings.setPlayerVideoFit(PlayerVideoFit.FIT)
                    autoPlayNextEpisode = true
                    settings.setAutoPlayNextEpisodeEnabled(true)
                    autoNextCancelled = false
                    skipSegmentsEnabled = true
                    settings.setSkipSegmentsEnabled(true)
                    contentWarningsEnabled = true
                    settings.setContentWarningsEnabled(true)
                    noteInteraction()
                },
            )
        }
    }
}


private fun StreamSource.toSourceCandidateForPlayer(): SourceCandidate =
    SourceCandidate(
        id = buildString {
            append(providerId)
            append(':')
            append(url ?: infoHash ?: name)
            fileIndex?.let {
                append(':')
                append(it)
            }
        },
        name = name,
        url = url,
        infoHash = infoHash,
        fileIndex = fileIndex,
        quality = quality,
        codec = codec,
        hdr = hdr,
        audio = audio,
        language = language,
        sizeBytes = sizeBytes,
        headers = headers,
        rankBoost = rankBoost,
        providerId = providerId,
        providerName = providerName,
        serverName = serverName,
        mimeType = mimeType,
    )

private suspend fun applyAndConfirmTvSubtitleChoice(
    player: ExoPlayer,
    selectionId: String,
    externalSubtitles: () -> Map<String, SubtitleTrack>,
    stillRequested: () -> Boolean,
): Boolean {
    var attempt = 0
    while (
        attempt < TV_SUBTITLE_SELECTION_CONFIRM_ATTEMPTS &&
        stillRequested()
    ) {
        val currentChoice = tvPlayerTrackChoices(
            tracks = LiveSmartSubs.mergedTracks(player),
            trackType = C.TRACK_TYPE_TEXT,
            externalSubtitles = externalSubtitles(),
        ).firstOrNull { it.selectionId == selectionId }

        if (currentChoice?.selected == true) return true

        if (
            currentChoice != null &&
            attempt in TV_SUBTITLE_SELECTION_REAPPLY_ATTEMPTS
        ) {
            tvApplyTrackChoice(
                player = player,
                trackType = C.TRACK_TYPE_TEXT,
                choice = currentChoice,
            )
        }

        delay(TV_SUBTITLE_SELECTION_CONFIRM_INTERVAL_MS)
        attempt += 1
    }

    return tvPlayerTrackChoices(
        tracks = LiveSmartSubs.mergedTracks(player),
        trackType = C.TRACK_TYPE_TEXT,
        externalSubtitles = externalSubtitles(),
    ).any { it.selectionId == selectionId && it.selected }
}

private const val TV_SUBTITLE_SELECTION_CONFIRM_ATTEMPTS = 60
private const val TV_SUBTITLE_SELECTION_CONFIRM_INTERVAL_MS = 50L
private const val TV_SUBTITLE_TRACK_ATTACH_WAIT_ATTEMPTS = 1_200
private const val TV_LATE_SUBTITLE_TRACK_REFRESH_ATTEMPTS = 60
private const val TV_LATE_SUBTITLE_TRACK_REFRESH_INTERVAL_MS = 100L
private val TV_SUBTITLE_SELECTION_REAPPLY_ATTEMPTS = setOf(0, 6, 18, 36)

private fun buildMediaItem(
    sourceUrl: String,
    mediaMimeType: String? = null,
    subtitles: List<SubtitleTrack>,
    preferredLanguages: List<String>,
    subtitlesOnByDefault: Boolean,
    autoSelectPreferred: Boolean,
    preferEmbedded: Boolean,
): MediaItem {
    val normalizedPreferredLanguages = preferredLanguages
        .map(::tvCanonicalLanguage)
        .distinct()

    val ordered = subtitles
        .filter { it.url.startsWith("https://") }
        .distinctBy { it.url }
        .sortedBy { subtitle ->
            normalizedPreferredLanguages.indexOf(tvCanonicalLanguage(subtitle.language))
                .let { if (it < 0) Int.MAX_VALUE else it }
        }

    val configurations = LiveSmartSubs.videoSubtitles(ordered).mapIndexed { index, subtitle ->
        val selectionId = tvExternalSubtitleSelectionId(subtitle)
        MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitle.url))
            .setId(selectionId)
            .setLanguage(tvCanonicalLanguage(subtitle.language).takeUnless { it == "und" })
            .setLabel(tvExternalSubtitleLabel(subtitle))
            .setMimeType(subtitleMimeType(subtitle.url, subtitle.mimeType))
            .setSelectionFlags(
                if (subtitlesOnByDefault && autoSelectPreferred && !preferEmbedded && (
                    normalizedPreferredLanguages.indexOf(tvCanonicalLanguage(subtitle.language)) == 0 ||
                        (normalizedPreferredLanguages.isEmpty() && index == 0)
                )) C.SELECTION_FLAG_DEFAULT else 0
            )
            .build()
    }

    SubtitleFlowDiagnostics.handoff("TV", sourceUrl, subtitles, configurations.map { it.uri.toString() })

    return MediaItem.Builder()
        .setUri(Uri.parse(sourceUrl))
        .setMimeType(mediaMimeType)
        .setSubtitleConfigurations(configurations)
        .build()
}

private fun nextEpisode(episodes: List<EpisodeItem>, current: EpisodeItem?): EpisodeItem? {
    current ?: return null
    val ordered = episodes.sortedWith(compareBy<EpisodeItem> { it.season }.thenBy { it.episode })
    val index = ordered.indexOfFirst { it.id == current.id || (it.season == current.season && it.episode == current.episode) }
    return if (index >= 0) ordered.getOrNull(index + 1) else null
}

private fun withAlpha(argb: Int, percent: Int): Int {
    val alpha = (255 * percent.coerceIn(0, 100) / 100) shl 24
    return (argb and 0x00FFFFFF) or alpha
}

private fun alphaPercent(argb: Int): Int =
    (((argb ushr 24) * 100) + 127) / 255

private fun subtitleMimeType(url: String, declaredMimeType: String? = null): String =
    when (SubtitleFormatPolicy.detect(url, declaredMimeType)) {
        SubtitleFormat.WEBVTT -> MimeTypes.TEXT_VTT
        SubtitleFormat.SSA -> MimeTypes.TEXT_SSA
        SubtitleFormat.TTML -> MimeTypes.APPLICATION_TTML
        SubtitleFormat.SUBRIP -> MimeTypes.APPLICATION_SUBRIP
    }

private fun playbackTitle(media: VueoMediaItem, episode: EpisodeItem?): String =
    if (episode == null) media.name
    else "${media.name}  •  S${episode.season}E${episode.episode}  •  ${episode.title}"

private fun formatSpeed(speed: Float): String =
    if (speed % 1f == 0f) speed.toInt().toString() else speed.toString().trimEnd('0').trimEnd('.')

private fun androidx.compose.ui.input.key.KeyEvent.isTvActivationKey(): Boolean =
    nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
        nativeKeyEvent.keyCode == KeyEvent.KEYCODE_ENTER ||
        nativeKeyEvent.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
