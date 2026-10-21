package com.vueo.mobile.ui

import com.vueo.shared.core.player.LiveSmartSubs
import com.vueo.shared.core.diagnostics.PerformanceDiagnostics
import com.vueo.shared.core.diagnostics.PerformanceDiagnostics.Tab
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
import androidx.compose.runtime.State
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.ui.PlayerView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
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
import com.vueo.shared.core.storage.PlaybackUpdateClock
import com.vueo.mobile.core.storage.LibraryStore
import com.vueo.mobile.core.storage.ProfileStore
import com.vueo.mobile.core.storage.VueoProfile
import com.vueo.mobile.core.storage.LibraryPlaybackEntry
import com.vueo.mobile.core.storage.PreferredQuality
import com.vueo.mobile.core.storage.PlayerOrientation
import com.vueo.mobile.core.storage.PlayerVideoFit
import com.vueo.mobile.core.storage.SettingsStore
import com.vueo.mobile.core.player.PlayerSkipRepository
import com.vueo.mobile.core.player.PlayerSkipSegment
import com.vueo.mobile.core.player.PlayerPlaybackPhase
import com.vueo.mobile.core.player.PlayerSourceAssessment
import com.vueo.mobile.core.player.PlayerSourceAudioMatch
import com.vueo.mobile.core.player.PlayerSourcePolicy
import com.vueo.shared.core.player.PlayerTrackPolicy
import com.vueo.shared.core.player.PlayerSubtitleUpdatePolicy
import com.vueo.shared.core.player.PlayerSkipPolicy
import com.vueo.shared.core.player.SubtitleReadinessProbe
import com.vueo.shared.core.player.SubtitleSessionDataSource
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.roundToInt

private fun extractPlayerImdbId(value: String?): String? =
    ContentWarningRepository.extractImdbId(value)

private fun Context.playerSubtitleDelayMs(mediaKey: String): Int =
    getSharedPreferences(
        "vueo_player_subtitles",
        Context.MODE_PRIVATE,
    ).getInt("subtitle_delay_ms:$mediaKey", 0)
        .coerceIn(-60_000, 60_000)

private fun Context.setPlayerSubtitleDelayMs(
    mediaKey: String,
    delayMs: Int,
) {
    getSharedPreferences(
        "vueo_player_subtitles",
        Context.MODE_PRIVATE,
    ).edit()
        .putInt(
            "subtitle_delay_ms:$mediaKey",
            delayMs.coerceIn(-60_000, 60_000),
        )
        .apply()
}

private const val LATE_SUBTITLE_TRACK_REFRESH_ATTEMPTS = 60
private const val LATE_SUBTITLE_TRACK_REFRESH_INTERVAL_MS = 100L

// Player persistence is serialized off the UI thread so progress/history JSON
// work cannot stall player navigation or race older snapshots over newer ones.
private val mobilePlayerPersistenceScope =
    CoroutineScope(SupervisorJob() + Dispatchers.IO)
private val mobilePlayerCleanupScope =
    CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
private val mobilePlayerPersistenceMutex = Mutex()

private fun enqueueMobilePlayerPersistence(
    block: () -> Unit,
    afterPersist: (() -> Unit)? = null,
) {
    mobilePlayerPersistenceScope.launch {
        mobilePlayerPersistenceMutex.withLock {
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
private fun PlayerContentWarningsOverlay(
    warnings: List<ContentWarning>,
    onAnimationComplete: () -> Unit,
) {
    val count = warnings.size
    val totalLineHeight = (count * 14) + ((count - 1) * 2)
    val containerAlpha = remember { Animatable(0f) }
    val lineHeightFraction = remember { Animatable(0f) }
    val itemAlphas = remember(count) {
        List(count) { Animatable(0f) }
    }

    LaunchedEffect(warnings) {
        containerAlpha.animateTo(1f, tween(300))
        lineHeightFraction.animateTo(
            1f,
            tween(400, easing = FastOutSlowInEasing),
        )

        for (index in 0 until count) {
            delay(80L)
            itemAlphas[index].animateTo(1f, tween(200))
        }

        delay(5_000L)

        for (index in (count - 1) downTo 0) {
            delay(60L)
            itemAlphas[index].animateTo(0f, tween(150))
        }

        delay(100L)
        lineHeightFraction.animateTo(
            0f,
            tween(300, easing = FastOutSlowInEasing),
        )
        delay(200L)
        containerAlpha.animateTo(0f, tween(200))
        onAnimationComplete()
    }

    if (containerAlpha.value <= 0f) {
        return
    }

    Row(
        modifier = Modifier.alpha(containerAlpha.value),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .width(3.dp)
                .height(
                    (
                        totalLineHeight *
                            lineHeightFraction.value
                    ).dp
                )
                .clip(RoundedCornerShape(50))
                .background(VueoPlayerAccent),
        )
        Column(
            modifier = Modifier.padding(start = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            warnings.forEachIndexed { index, warning ->
                Row(
                    modifier = Modifier
                        .alpha(
                            itemAlphas
                                .getOrNull(index)
                                ?.value
                                ?: 0f
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        warning.label,
                        color = Color.White.copy(alpha = .92f),
                        fontSize = 9.sp,
                        lineHeight = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        " · ${warning.severity}",
                        color = Color.White.copy(alpha = .56f),
                        fontSize = 9.sp,
                        lineHeight = 11.sp,
                    )
                }
            }
        }
    }
}

internal val VueoPlayerAccent =
    Color(0xFFB9FF3A)

@Composable
@OptIn(ExperimentalMaterial3Api::class)
internal fun PlayerScreen(
    settingsStore: SettingsStore,
    title: String,
    mediaKey: String,
    media: MediaItem,
    videoId: String,
    episode: EpisodeItem?,
    nextEpisode: EpisodeItem?,
    episodes: List<EpisodeItem>,
    source: StreamSource,
    availableSources: List<StreamSource>,
    sourceProviderOrder: List<String>,
    sourcesSearching: Boolean,
    pluginsStopped: Boolean,
    sourcesStopped: Boolean,
    onRefreshSources: () -> Unit,
    onStopSources: () -> Unit,
    onRefreshSubtitles: suspend () -> Int,
    subtitlesState: State<List<SubtitleTrack>>,
    initialPositionMs: Long,
    episodeSwitchingTo: EpisodeItem?,
    episodeSwitchFailed: Boolean,
    onEpisodeSwitchCompleted: () -> Unit,
    onEpisodeSwitchFailed: () -> Unit,
    onLibraryChanged: () -> Unit,
    onSwitchSource: (StreamSource, Long) -> Unit,
    onPrefetchNextEpisode: (EpisodeItem, StreamSource) -> Unit,
    onValidateNextEpisodePrefetch: suspend (EpisodeItem, StreamSource, Int) -> Unit,
    onActiveSourceChanged: (StreamSource) -> Unit,
    onNextEpisode: (EpisodeItem) -> Unit,
    onEpisodeSelected: (EpisodeItem) -> Unit,
    onBack: () -> Unit,
) {
    // Read the discovery state inside the active player composition. This
    // avoids AnimatedContent retaining the subtitle list that existed when
    // quick play first entered the player.
    val discoveredSubtitles by subtitlesState
    val context = LocalContext.current
    if (!com.vueo.shared.core.profile.KidsContentPolicy.allows(media.certification, com.vueo.shared.core.storage.ProfileStore(context.applicationContext).kidsAgeLimit())) {
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

    val providerSubtitles = com.vueo.shared.core.player.StreamSubtitlePolicy.forPlayback(source, discoveredSubtitles)
    val smartSubsStore = remember(context) { com.vueo.shared.core.smartsubs.SmartSubsSettingsStore(context.applicationContext) }
    var smartSubsTracks by remember(mediaKey, source.url) { mutableStateOf(emptyList<SubtitleTrack>()) }
    var smartSubsMessage by remember(mediaKey, source.url) { mutableStateOf<String?>(null) }
    var smartSubsRefreshing by remember(mediaKey) { mutableStateOf(false) }
    var smartSubsRefreshGeneration by remember(mediaKey) { mutableIntStateOf(0) }
    LaunchedEffect(mediaKey, source.url, providerSubtitles, smartSubsRefreshGeneration) {
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
                config = config, mediaType = media.type, videoId = videoId, tracks = candidates,
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            smartSubsMessage = com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.failureMessage(error)
        } finally { smartSubsRefreshing = false }
    }
    val subtitles = (providerSubtitles + smartSubsTracks).distinctBy { it.url }

    val activity = context as? Activity
    val entryConfigurationOrientation = remember {
        context.resources.configuration.orientation
    }
    val previousRequestedOrientation = remember(activity) {
        activity?.requestedOrientation
            ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    val currentConfigurationOrientation =
        LocalConfiguration.current.orientation
    val latestOnBack = rememberUpdatedState(onBack)
    val latestOnLibraryChanged = rememberUpdatedState(onLibraryChanged)
    var playerExitRequested by remember {
        mutableStateOf(false)
    }
    var playerExitCommitted by remember {
        mutableStateOf(false)
    }

    fun commitPlayerExit() {
        if (!playerExitCommitted) {
            playerExitCommitted = true
            latestOnBack.value()
        }
    }

    LaunchedEffect(
        playerExitRequested,
        currentConfigurationOrientation,
        entryConfigurationOrientation,
    ) {
        if (
            playerExitRequested &&
            !playerExitCommitted &&
            currentConfigurationOrientation ==
                entryConfigurationOrientation
        ) {
            commitPlayerExit()
        }
    }
    val latestEpisodeSwitchingTo =
        rememberUpdatedState(episodeSwitchingTo)
    val latestOnEpisodeSwitchCompleted =
        rememberUpdatedState(onEpisodeSwitchCompleted)
    val latestOnEpisodeSwitchFailed =
        rememberUpdatedState(onEpisodeSwitchFailed)
    val audioManager = remember {
        context.getSystemService(
            Context.AUDIO_SERVICE
        ) as AudioManager
    }
    val seekGestureSensitivity = remember {
        context.seekGestureSensitivity()
    }
    val playbackStore = remember {
        PlaybackStore(
            context.applicationContext
        )
    }
    val libraryStore = remember {
        LibraryStore(
            context.applicationContext
        )
    }

    val playerPluginStore = remember {
        PluginStore(
            context.applicationContext
        )
    }
    var contentWarningsEnabled by remember(settingsStore) {
        context.migrateLegacyContentWarningsToShared(settingsStore)
        mutableStateOf(settingsStore.contentWarningsEnabled())
    }

    val savedPositionMs = remember(mediaKey) {
        playbackStore.positionMs(mediaKey)
    }
    // A cursor captured during this app process is newer than a Details snapshot
    // that may still be waiting for async persistence. It is position-agnostic:
    // a newer rewind must beat an older larger position too.
    val liveSessionSnapshot =
        playbackStore.sessionSnapshot(mediaKey)
    val resumePlaybackEnabled = remember(mediaKey) {
        settingsStore.resumePlaybackEnabled()
    }
    val minimumResumePositionMs = if (episode != null) 0L else 5_000L
    val sourceSwitchPosition = initialPositionMs
        .coerceAtLeast(0L)
    val liveSessionPosition =
        liveSessionSnapshot
            ?.resumePositionMs
            ?.coerceAtLeast(0L)
    val effectiveIncomingPosition =
        liveSessionPosition
            ?: sourceSwitchPosition
    val shouldPromptResume =
        liveSessionSnapshot == null &&
            effectiveIncomingPosition <= minimumResumePositionMs &&
            resumePlaybackEnabled &&
            savedPositionMs > minimumResumePositionMs
    val initialPlaybackPositionMs =
        if (liveSessionSnapshot != null) {
            liveSessionPosition ?: 0L
        } else if (effectiveIncomingPosition > minimumResumePositionMs) {
            effectiveIncomingPosition
        } else if (!shouldPromptResume && resumePlaybackEnabled) {
            savedPositionMs
        } else {
            0L
        }

    var resumePromptVisible by remember(
        mediaKey,
    ) {
        mutableStateOf(shouldPromptResume)
    }
    var playbackError by remember {
        mutableStateOf<String?>(null)
    }
    var playbackPhase by remember(mediaKey) {
        mutableStateOf(PlayerPlaybackPhase.LOADING)
    }
    var hasRenderedFirstFrame by remember(mediaKey) {
        mutableStateOf(false)
    }
    var recoveryInProgress by remember(mediaKey) {
        mutableStateOf(false)
    }
    var retryGeneration by remember(mediaKey) {
        mutableIntStateOf(0)
    }
    val sourceRecoverySession = remember(mediaKey) {
        PlayerSourceRecoverySession()
    }
    var failedSourceUrls by remember(mediaKey) {
        mutableStateOf<Set<String>>(emptySet())
    }
    var isBuffering by remember {
        mutableStateOf(false)
    }
    var isPlaying by remember {
        mutableStateOf(false)
    }
    var playbackEnded by remember(mediaKey) {
        mutableStateOf(false)
    }
    // Prevent STATE_ENDED, Play Next, and Player disposal from serializing the
    // same completion/progress snapshot multiple times during one handoff.
    var completionPersistenceQueued by remember(mediaKey) {
        mutableStateOf(false)
    }
    var episodeHandoffPersistenceQueued by remember(mediaKey) {
        mutableStateOf(false)
    }
    LaunchedEffect(episodeSwitchingTo?.id, mediaKey) {
        if (episodeSwitchingTo == null) {
            // Failed/cancelled discovery can leave this same Player alive. A
            // successful switch changes mediaKey, so only surviving Players are
            // re-armed for normal progress persistence here.
            episodeHandoffPersistenceQueued = false
        }
    }
    var episodeHistoryRevision by remember(media.id, media.type) {
        mutableIntStateOf(0)
    }
    var currentPositionMs by remember {
        mutableStateOf(initialPlaybackPositionMs)
    }
    var lastValidPlaybackPositionMs by remember(mediaKey) {
        mutableStateOf(
            maxOf(
                initialPlaybackPositionMs,
                savedPositionMs,
            ).takeIf { it > minimumResumePositionMs } ?: 0L
        )
    }
    var durationMs by remember {
        mutableStateOf(0L)
    }
    var controlsVisible by remember {
        mutableStateOf(true)
    }
    var controlsLocked by remember {
        mutableStateOf(false)
    }
    var videoFit by remember {
        mutableStateOf(
            settingsStore.playerVideoFit()
        )
    }
    var gestureMessage by remember {
        mutableStateOf<String?>(null)
    }
    var gestureActive by remember {
        mutableStateOf(false)
    }
    var gestureSeekPositionMs by remember {
        mutableStateOf<Long?>(null)
    }
    var audioTracks by remember {
        mutableStateOf<List<PlayerTrackChoice>>(
            emptyList()
        )
    }
    var textTracks by remember {
        mutableStateOf<List<PlayerTrackChoice>>(
            emptyList()
        )
    }
    var subtitleStyle by remember {
        mutableStateOf(
            PlayerSubtitleStyleState(
                fontSizeSp = settingsStore.subtitleFontSizeSp(),
                commentaryFontSizeSp = settingsStore.subtitleCommentaryFontSizeSp(),
                fontFamily = settingsStore.subtitleFontFamily(),
                bold = settingsStore.subtitleBold(),
                showCommentary = settingsStore.subtitleCommentaryEnabled(),
                textColor = settingsStore.subtitleTextColor(),
                outlineEnabled = settingsStore.subtitleOutlineEnabled(),
                outlineColor = settingsStore.subtitleOutlineColor(),
                backgroundEnabled = settingsStore.subtitleBackgroundEnabled(),
                backgroundColor = settingsStore.subtitleBackgroundColor(),
                backgroundOpacityPercent =
                    settingsStore.subtitleBackgroundOpacityPercent(),
                bottomPaddingPercent =
                    settingsStore.subtitleBottomPaddingPercent(),
            )
        )
    }
    var subtitleDelayMs by remember(mediaKey) {
        mutableIntStateOf(
            context.playerSubtitleDelayMs(mediaKey)
        )
    }
    val latestSubtitleDelayMs =
        rememberUpdatedState(subtitleDelayMs)
    var subtitlesDisabled by remember(mediaKey) {
        mutableStateOf(
            !playerSubtitlesEnabledAtStart(settingsStore)
        )
    }
    var selectedSubtitleIsExternal by remember(mediaKey) {
        mutableStateOf(false)
    }
    val subtitleSelectionScope = rememberCoroutineScope()
    var subtitleDiscoveryRefreshing by remember(mediaKey) { mutableStateOf(false) }
    var subtitleRefreshMessage by remember(mediaKey) { mutableStateOf<String?>(null) }
    val latestSubtitles = rememberUpdatedState(subtitles)
    var pendingSubtitleSelectionId by remember(mediaKey) {
        val contentSelection = settingsStore.subtitleSelection(mediaKey)
        val globalSelection = settingsStore.lastSubtitleSelection()
        val savedLanguage = globalSelection
            ?.takeIf { it.startsWith(PLAYER_SUBTITLE_LANGUAGE_PREFIX) }
            ?.removePrefix(PLAYER_SUBTITLE_LANGUAGE_PREFIX)
        mutableStateOf(
            contentSelection
                ?.takeIf {
                    globalSelection != PLAYER_SUBTITLE_OFF &&
                        it.startsWith("external:")
                }
                ?: if (
                    contentSelection == null &&
                    globalSelection != PLAYER_SUBTITLE_OFF &&
                    savedLanguage != null
                ) {
                    PlayerTrackPolicy.preferredSubtitle(
                        tracks = subtitles, language = savedLanguage,
                        providerId = settingsStore.lastSubtitleProviderId(),
                        languageOf = { it.language }, providerOf = { it.providerId },
                    )?.let(PlayerTrackPolicy::externalSubtitleSelectionId)
                } else {
                    null
                }
        )
    }
    var translatingSubtitleSelectionId by remember(mediaKey) {
        mutableStateOf<String?>(null)
    }
    var requestedSubtitleSelectionId by remember(mediaKey) {
        mutableStateOf<String?>(null)
    }
    var subtitlePreparationJob by remember(mediaKey) {
        mutableStateOf<kotlinx.coroutines.Job?>(null)
    }
    val latestSelectedSubtitleIsExternal =
        rememberUpdatedState(selectedSubtitleIsExternal)
    var showAudioDialog by remember {
        mutableStateOf(false)
    }
    var showSubtitleDialog by remember {
        mutableStateOf(false)
    }
    var showSubtitleStyleOverlay by remember {
        mutableStateOf(false)
    }
    var showSourceDialog by remember {
        mutableStateOf(false)
    }
    var switchingSourceUrl by remember(mediaKey) {
        mutableStateOf<String?>(null)
    }
    var showEpisodeDialog by remember {
        mutableStateOf(false)
    }
    var showMoreDialog by remember {
        mutableStateOf(false)
    }
    var dialogueSyncOpen by remember(mediaKey, source.url) { mutableStateOf(false) }
    var dialogueSyncTrack by remember(mediaKey, source.url) { mutableStateOf<SubtitleTrack?>(null) }
    val playerPanelVisible =
        dialogueSyncOpen || showAudioDialog ||
            showSubtitleDialog ||
            showSubtitleStyleOverlay ||
            showSourceDialog ||
            showEpisodeDialog ||
            showMoreDialog
    var playbackSpeed by remember {
        mutableStateOf(
            settingsStore.playerPlaybackSpeed()
        )
    }
    var nextEpisodeCountdown by remember {
        mutableStateOf<Int?>(null)
    }
    var nextEpisodeCardSwitchTarget by remember {
        mutableStateOf<EpisodeItem?>(null)
    }
    var nextEpisodeSwitching by remember(mediaKey) {
        mutableStateOf(false)
    }
    var showNextEpisodeCard by remember(mediaKey) {
        mutableStateOf(false)
    }
    var nextEpisodeCardDismissed by remember(mediaKey) {
        mutableStateOf(false)
    }
    val nextEpisodeCardVisible =
        showNextEpisodeCard ||
            nextEpisodeCardSwitchTarget != null
    var autoPlayNextEpisode by remember {
        mutableStateOf(
            settingsStore.autoPlayNextEpisodeEnabled()
        )
    }
    var contentWarnings by remember(mediaKey) {
        mutableStateOf<List<ContentWarning>>(emptyList())
    }
    var showContentWarnings by remember(mediaKey) {
        mutableStateOf(false)
    }
    var contentWarningsShown by remember(mediaKey) {
        mutableStateOf(false)
    }
    var skipSegmentsEnabled by remember(mediaKey) {
        mutableStateOf(settingsStore.skipSegmentsEnabled())
    }
    var skipSegments by remember(mediaKey) {
        mutableStateOf<List<PlayerSkipSegment>>(emptyList())
    }
    var dismissedSkipSegmentKey by remember(mediaKey) {
        mutableStateOf<String?>(null)
    }

    val playableSources = remember(
        availableSources,
        source.url,
        media.originalLanguage,
    ) {
        (listOf(source) + availableSources)
            .filter {
                it.isDirectPlayable
            }
            .distinctBy {
                it.url
            }
            .sortedWith(
                SourceRanker.comparator(
                    settingsStore
                        .preferredQuality()
                        .rankKey,
                    originalLanguage = media.originalLanguage,
                )
            )
    }

    val startupAudioMuted = remember(
        source.url,
        source.headers,
        mediaKey,
        initialPositionMs,
    ) {
        mutableStateOf(true)
    }

    val lifecycleOwner = context as? LifecycleOwner
    val lifecycleState = remember(
        lifecycleOwner, source.url, source.headers, mediaKey, initialPositionMs,
    ) {
        MobilePlayerLifecycleState(
            initiallyForeground = lifecycleOwner?.lifecycle?.currentState
                ?.isAtLeast(Lifecycle.State.STARTED) ?: true,
            initiallyPlayWhenReady = !resumePromptVisible,
        )
    }
    var playerForeground by remember(lifecycleState) { mutableStateOf(lifecycleState.foreground) }

    val videoDecoderSession = remember(source.url, source.headers, mediaKey, initialPositionMs) {
        com.vueo.shared.core.player.VideoDecoderSession("Mobile").apply { beginSource(source.url) }
    }

    val player = remember(
        source.url,
        source.headers,
        mediaKey,
        initialPositionMs,
    ) {
        val httpFactory =
            DefaultHttpDataSource.Factory()
                .setUserAgent(
                    source.headers.entries.firstOrNull {
                        it.key.equals("User-Agent", ignoreCase = true) && it.value.isNotBlank()
                    }?.value ?: "VUEO/${BuildConfig.VERSION_NAME}"
                )
                .setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(
                    source.headers
                )

        val mediaSourceFactory =
            DefaultMediaSourceFactory(context)
                .setDataSourceFactory(SubtitleSessionDataSource.Factory(
                    com.vueo.shared.core.player.PlaybackHttpTraceDataSource.Factory(
                        httpFactory, "Mobile", { source.headers }, { source.url },
                    )
                ))

        ExoPlayer.Builder(
            context,
            VueoSubtitleOffsetRenderersFactory(
                context = context,
                decoderSession = videoDecoderSession,
                subtitleDelayUsProvider = {
                    latestSubtitleDelayMs.value.toLong() * 1_000L
                },
                shouldNormalizeCuePositionProvider = {
                    latestSelectedSubtitleIsExternal.value
                },
            ),
        )
            .setMediaSourceFactory(
                mediaSourceFactory
            )
            .build()
            .apply {
                setAudioAttributes(
                    AudioAttributes.DEFAULT,
                    true,
                )
                // Register the audio gate before prepare(), so even an unusually
                // fast first frame cannot be missed by the Compose listener added
                // later in this composition. Retry re-arms the same gate.
                addListener(
                    object : Player.Listener {
                        override fun onRenderedFirstFrame() {
                            if (
                                startupAudioMuted.value &&
                                !playerExitRequested
                            ) {
                                volume = 1f
                                startupAudioMuted.value = false
                            }
                        }
                    }
                )

                val playerMediaItem =
                    buildPlayerMediaItem(
                        mediaMimeType = com.vueo.shared.core.player.PlaybackMediaPolicy.resolve(source.mimeType, source.url, source.name, source.serverName),
                        sourceUrl =
                            requireNotNull(
                                source.url
                            ),
                        subtitles = subtitles,
                        preferredLanguageCode =
                            playerPreferredSubtitleLanguageCode(
                                settingsStore
                            ),
                        secondaryLanguageCode =
                            settingsStore
                                .secondarySubtitleLanguage()
                                .languageCode,
                        subtitlesOnByDefault =
                            playerSubtitlesEnabledAtStart(
                                settingsStore
                            ),
                        autoSelectPreferred =
                            settingsStore
                                .autoSelectPreferredSubtitle(),
                        embeddedPriority =
                            settingsStore
                                .embeddedSubtitlePriority(),
                    )

                setMediaItem(
                    playerMediaItem,
                    initialPlaybackPositionMs,
                )

                val initialTrackParameters =
                    trackSelectionParameters
                        .buildUpon()
                        .setTrackTypeDisabled(
                            C.TRACK_TYPE_TEXT,
                            subtitlesDisabled ||
                                pendingSubtitleSelectionId != null,
                        )
                if (settingsStore.autoSelectPreferredSubtitle()) {
                    val preferredTextLanguages = listOfNotNull(
                        playerPreferredSubtitleLanguageCode(settingsStore),
                        settingsStore.secondarySubtitleLanguage().languageCode,
                    ).mapNotNull(com.vueo.shared.core.language.LanguagePolicy::canonicalCode)
                        .distinct()
                    if (preferredTextLanguages.isNotEmpty()) {
                        initialTrackParameters.setPreferredTextLanguages(
                            *preferredTextLanguages.toTypedArray()
                        )
                    }
                }
                PlayerSourcePolicy
                    .canonicalLanguageCode(media.originalLanguage)
                    ?.let {
                        initialTrackParameters
                            .setPreferredAudioLanguages(it)
                    }
                trackSelectionParameters =
                    initialTrackParameters.build()

                // Do not let audio run ahead of the first decoded video frame.
                volume = 0f
                prepare()
                playWhenReady =
                    !resumePromptVisible && lifecycleState.foreground
            }
    }

    val liveSmartSubs = remember(player, mediaKey, source.url) {
        LiveSmartSubs(player, "Mobile") { latestSubtitleDelayMs.value.toLong() }
    }
    DisposableEffect(liveSmartSubs) { onDispose { liveSmartSubs.close() } }
    LaunchedEffect(liveSmartSubs, subtitles) { liveSmartSubs.update(subtitles) }

    fun enqueuePlaybackProgress(
        positionMs: Long,
        durationMs: Long,
        clearPlaybackPosition: Boolean = false,
        notifyLibrary: Boolean = false,
    ) {
        // Capture on the caller thread before dispatch. This immediately publishes
        // the newest cursor for a rapid Back -> reopen, while persistence remains
        // off Main. Completion naturally normalizes resumePositionMs to 0.
        val playbackSnapshot =
            if (clearPlaybackPosition) {
                playbackStore.capturePosition(
                    mediaKey = mediaKey,
                    positionMs = durationMs.coerceAtLeast(positionMs),
                    durationMs = durationMs,
                )
            } else {
                playbackStore.capturePosition(
                    mediaKey = mediaKey,
                    positionMs = positionMs,
                    durationMs = durationMs,
                )
            }

        enqueueMobilePlayerPersistence(
            block = {
                playbackStore.persistSnapshot(playbackSnapshot)
                libraryStore.recordPlayback(
                    media = media,
                    videoId = videoId,
                    episodeTitle = episode?.title,
                    season = episode?.season,
                    episode = episode?.episode,
                    positionMs = positionMs,
                    durationMs = durationMs,
                    lastWatchedEpochMs = playbackSnapshot.updatedAtEpochMs,
                )
            },
            afterPersist = if (notifyLibrary) {
                {
                    episodeHistoryRevision += 1
                    latestOnLibraryChanged.value()
                }
            } else {
                null
            },
        )
    }

    // Async subtitle/recovery work may finish while this composition is retained.
    // Playback requests must never start background audio.
    fun requestForegroundPlayback() {
        if (lifecycleState.foreground && !playerExitRequested) player.play()
    }

    var deferredSourceFailure by remember(player) { mutableStateOf<String?>(null) }
    val latestLifecycleResumeAllowed = rememberUpdatedState(
        !resumePromptVisible && !playerExitRequested && !completionPersistenceQueued &&
            !episodeHandoffPersistenceQueued && latestEpisodeSwitchingTo.value == null &&
            !nextEpisodeSwitching && playbackError == null && deferredSourceFailure == null,
    )
    val latestSaveLifecycleProgress = rememberUpdatedState<() -> Unit>({
        if (!playerExitRequested && !episodeHandoffPersistenceQueued && !completionPersistenceQueued) {
            val livePosition = player.currentPosition.coerceAtLeast(0L)
            val liveDuration = player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L
            if (livePosition > minimumResumePositionMs) lastValidPlaybackPositionMs = livePosition
            val stablePosition = if (livePosition > minimumResumePositionMs) livePosition else lastValidPlaybackPositionMs
            if (stablePosition > minimumResumePositionMs) {
                enqueuePlaybackProgress(stablePosition, liveDuration, notifyLibrary = true)
            }
        }
    })

    DisposableEffect(player, lifecycleOwner, lifecycleState) {
        fun stopForBackground() {
            if (lifecycleState.stop(player.playWhenReady)) {
                playerForeground = false
                player.pause()
                latestSaveLifecycleProgress.value()
            }
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> stopForBackground()
                Lifecycle.Event.ON_START -> {
                    val resume = lifecycleState.start(
                        latestLifecycleResumeAllowed.value && player.playbackState != Player.STATE_ENDED,
                    )
                    playerForeground = lifecycleState.foreground
                    if (resume) player.play()
                }
                else -> Unit
            }
        }
        val backgroundGuard = object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (playWhenReady && !lifecycleState.foreground) player.pause()
            }
        }
        player.addListener(backgroundGuard)
        lifecycleOwner?.lifecycle?.addObserver(observer)
        // addObserver catches up to a started owner. A player created while
        // stopped is initially paused and carries its initial intent until start.
        if (!lifecycleState.foreground && player.playWhenReady) player.pause()
        onDispose {
            lifecycleOwner?.lifecycle?.removeObserver(observer)
            player.removeListener(backgroundGuard)
        }
    }

    fun requestPlayerExit() {
        if (playerExitRequested) return

        playerExitRequested = true

        // Silence/pause immediately. Orientation restoration and JSON persistence
        // must never leave audio running while the return route is being prepared.
        player.volume = 0f
        runCatching { player.pause() }

        val livePositionMs = player.currentPosition.coerceAtLeast(0L)
        val liveDurationMs = player.duration.coerceAtLeast(0L)
        if (livePositionMs > minimumResumePositionMs) {
            lastValidPlaybackPositionMs = livePositionMs
        }
        val stablePositionMs =
            if (livePositionMs > minimumResumePositionMs) {
                livePositionMs
            } else {
                lastValidPlaybackPositionMs
            }
        if (stablePositionMs > minimumResumePositionMs) {
            enqueuePlaybackProgress(
                positionMs = stablePositionMs,
                durationMs = liveDurationMs,
                notifyLibrary = true,
            )
        }

        activity?.requestedOrientation =
            when (previousRequestedOrientation) {
                ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED ->
                    when (entryConfigurationOrientation) {
                        android.content.res.Configuration
                            .ORIENTATION_LANDSCAPE ->
                            ActivityInfo
                                .SCREEN_ORIENTATION_SENSOR_LANDSCAPE

                        else ->
                            ActivityInfo
                                .SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    }

                else -> previousRequestedOrientation
            }

        if (
            activity == null ||
            currentConfigurationOrientation ==
                entryConfigurationOrientation
        ) {
            commitPlayerExit()
        }
    }

    BackHandler {
        when {
            showAudioDialog ->
                showAudioDialog = false

            showSubtitleStyleOverlay -> {
                showSubtitleStyleOverlay = false
                controlsVisible = true
            }

            showSubtitleDialog -> {
                showSubtitleDialog = false
                controlsVisible = true
            }

            showSourceDialog -> {
                showSourceDialog = false
                switchingSourceUrl = null
            }

            showEpisodeDialog ->
                showEpisodeDialog = false

            showMoreDialog ->
                showMoreDialog = false

            controlsLocked ->
                controlsLocked = false

            else -> requestPlayerExit()
        }
    }

    var appliedSubtitleUrls by remember(player) {
        mutableStateOf(
            PlayerSubtitleUpdatePolicy.sourceKeys(LiveSmartSubs.videoSubtitles(subtitles))
        )
    }
    var subtitleTrackRefreshInProgress by remember(player) {
        mutableStateOf(false)
    }
    var subtitlePreferenceRestored by remember(player) {
        mutableStateOf(false)
    }
    var audioPreferenceRestored by remember(player) {
        mutableStateOf(false)
    }
    var audioAutomaticSelected by remember(player) {
        mutableStateOf(true)
    }

    // The subtitle workspace is a discovery UI, not an ExoPlayer track
    // inspector. Publish newly discovered external choices immediately;
    // ExoPlayer may expose their TrackGroups a little later.
    LaunchedEffect(player, subtitles) {
        val discoveredBySelectionId =
            subtitles.associateBy(
                PlayerTrackPolicy::externalSubtitleSelectionId
            )
        val availablePlayerChoices = playerTrackChoices(
            tracks = LiveSmartSubs.mergedTracks(player),
            trackType = C.TRACK_TYPE_TEXT,
            externalSubtitles = discoveredBySelectionId,
        )
        textTracks = mergeDiscoveredSubtitleChoices(
            playerChoices = availablePlayerChoices,
            discoveredSubtitles = subtitles,
        )
    }

    LaunchedEffect(
        player,
        subtitles,
    ) {
        val latestSubtitleUrls =
            PlayerSubtitleUpdatePolicy.sourceKeys(LiveSmartSubs.videoSubtitles(subtitles))

        if (latestSubtitleUrls != appliedSubtitleUrls) {
            // Prefetch subtitle results may arrive while the next episode decoder
            // is still starting. Keep them visible in the workspace immediately,
            // but batch MediaItem replacement until the first frame/handoff settles.
            var startupWaits = 0
            while ((latestEpisodeSwitchingTo.value != null || !hasRenderedFirstFrame) && startupWaits < 30) {
                delay(100L)
                startupWaits += 1
            }
            delay(if (startupWaits > 0) 500L else 350L)
            if (player.currentMediaItem?.localConfiguration?.uri?.toString() != source.url ||
                latestSubtitleUrls == appliedSubtitleUrls
            ) return@LaunchedEffect
            audioPreferenceRestored = false
            subtitlePreferenceRestored = false

            if (pendingSubtitleSelectionId == null) {
                val contentSelection = settingsStore.subtitleSelection(mediaKey)
                val globalSelection = settingsStore.lastSubtitleSelection()
                val savedLanguage = globalSelection
                    ?.takeIf { it.startsWith(PLAYER_SUBTITLE_LANGUAGE_PREFIX) }
                    ?.removePrefix(PLAYER_SUBTITLE_LANGUAGE_PREFIX)
                pendingSubtitleSelectionId = contentSelection
                    ?.takeIf {
                        globalSelection != PLAYER_SUBTITLE_OFF &&
                            it.startsWith("external:")
                    }
                    ?: if (
                        contentSelection == null &&
                        globalSelection != PLAYER_SUBTITLE_OFF &&
                        savedLanguage != null
                    ) {
                        PlayerTrackPolicy.preferredSubtitle(
                            tracks = subtitles, language = savedLanguage,
                            providerId = settingsStore.lastSubtitleProviderId(),
                            languageOf = { it.language }, providerOf = { it.providerId },
                        )?.let(PlayerTrackPolicy::externalSubtitleSelectionId)
                    } else {
                        null
                    }
            }

            val updatedMediaItem = buildPlayerMediaItem(
                        mediaMimeType = com.vueo.shared.core.player.PlaybackMediaPolicy.resolve(source.mimeType, source.url, source.name, source.serverName),
                    sourceUrl = requireNotNull(source.url),
                    subtitles = subtitles,
                    preferredLanguageCode =
                        playerPreferredSubtitleLanguageCode(
                            settingsStore
                        ),
                    secondaryLanguageCode =
                        settingsStore
                            .secondarySubtitleLanguage()
                            .languageCode,
                    subtitlesOnByDefault =
                        !subtitlesDisabled,
                    autoSelectPreferred =
                        settingsStore
                            .autoSelectPreferredSubtitle(),
                    embeddedPriority =
                        settingsStore
                            .embeddedSubtitlePriority(),
                )
            val currentIndex = player.currentMediaItemIndex
                .takeIf { it in 0 until player.mediaItemCount }
                ?: 0
            subtitleTrackRefreshInProgress = true
            // Lock text selection before replacing the playing item. Doing it
            // afterwards leaves a small window where Media3 can request a slow
            // external subtitle while the readiness probe requests it too.
            player.trackSelectionParameters =
                player.trackSelectionParameters
                    .buildUpon()
                    .setTrackTypeDisabled(
                        C.TRACK_TYPE_TEXT,
                        subtitlesDisabled || LiveSmartSubs.ownsCues(player) ||
                            pendingSubtitleSelectionId != null,
                    )
                    .build()
            // AI captions are owned by LiveSmartSubs and never reach this path.
            player.replaceMediaItem(currentIndex, updatedMediaItem)
            com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlayerEvent(
                "Mobile", "SUBTITLE_MEDIA_UPDATE", "rebuild=false aiOverlay=true",
            )
            appliedSubtitleUrls = latestSubtitleUrls

            // ExoPlayer can publish an empty/intermediate track snapshot when
            // external subtitles are added to the currently playing item.
            // onTracksChanged is therefore not sufficient on its own: keep
            // reconciling the workspace until every late subtitle is visible,
            // while the video continues from the preserved position above.
            val expectedExternalSelectionIds =
                subtitles
                    .map(PlayerTrackPolicy::externalSubtitleSelectionId)
                    .toSet()
            var refreshAttempts = 0
            while (refreshAttempts < LATE_SUBTITLE_TRACK_REFRESH_ATTEMPTS) {
                val latestExternalSubtitles =
                    latestSubtitles.value
                        .associateBy(PlayerTrackPolicy::externalSubtitleSelectionId)
                val refreshedTextTracks = playerTrackChoices(
                    tracks = LiveSmartSubs.mergedTracks(player),
                    trackType = C.TRACK_TYPE_TEXT,
                    externalSubtitles = latestExternalSubtitles,
                )

                textTracks = mergeDiscoveredSubtitleChoices(
                    playerChoices = refreshedTextTracks,
                    discoveredSubtitles = latestSubtitles.value,
                )

                val visibleExternalSelectionIds =
                    refreshedTextTracks
                        .asSequence()
                        .filter { it.externalSubtitle != null }
                        .map { it.selectionId }
                        .toSet()
                if (
                    expectedExternalSelectionIds.isEmpty() ||
                    expectedExternalSelectionIds.all(visibleExternalSelectionIds::contains)
                ) {
                    break
                }

                delay(LATE_SUBTITLE_TRACK_REFRESH_INTERVAL_MS)
                refreshAttempts += 1
            }

            subtitleTrackRefreshInProgress = false

            // One final read covers devices that publish their last Tracks
            // snapshot on the same frame as the final polling interval.
            val finalExternalSubtitles =
                latestSubtitles.value
                    .associateBy(PlayerTrackPolicy::externalSubtitleSelectionId)
            val finalTextTracks = playerTrackChoices(
                tracks = LiveSmartSubs.mergedTracks(player),
                trackType = C.TRACK_TYPE_TEXT,
                externalSubtitles = finalExternalSubtitles,
            )
            textTracks = mergeDiscoveredSubtitleChoices(
                playerChoices = finalTextTracks,
                discoveredSubtitles = latestSubtitles.value,
            )
        }
    }

    fun stablePlaybackSnapshot(): Pair<Long, Long> {
        val livePositionMs =
            player.currentPosition.coerceAtLeast(0L)
        val liveDurationMs =
            player.duration.coerceAtLeast(0L)

        if (livePositionMs > minimumResumePositionMs) {
            lastValidPlaybackPositionMs = livePositionMs
        }

        val stablePositionMs =
            if (livePositionMs > minimumResumePositionMs) {
                livePositionMs
            } else {
                lastValidPlaybackPositionMs
            }

        return stablePositionMs to liveDurationMs
    }

    fun savePosition() {
        val (positionMs, durationMs) =
            stablePlaybackSnapshot()

        // Pause/exit/dispose can briefly report 0 ms. Never let that
        // transient value clear an already-valid resume point. Persistence is
        // serialized off Main so JSON history work cannot hitch the player UI.
        if (positionMs <= minimumResumePositionMs) {
            return
        }

        enqueuePlaybackProgress(
            positionMs = positionMs,
            durationMs = durationMs,
        )
    }

    fun markCurrentEpisodeCompletedForNext() {
        episodeHandoffPersistenceQueued = true
        if (completionPersistenceQueued) return
        completionPersistenceQueued = true

        val completedDuration = player.duration
            .takeIf { it > 0L && it != C.TIME_UNSET }
            ?.coerceAtLeast(0L)
            ?: durationMs.coerceAtLeast(0L)
        if (completedDuration <= 0L) {
            savePosition()
            return
        }
        enqueuePlaybackProgress(
            positionMs = completedDuration,
            durationMs = completedDuration,
            clearPlaybackPosition = true,
            notifyLibrary = true,
        )
    }

    fun saveCurrentForEpisodeHandoff() {
        if (episodeHandoffPersistenceQueued) return
        episodeHandoffPersistenceQueued = true
        savePosition()
    }

    fun startNextEpisode() {
        val next = nextEpisode ?: return
        if (nextEpisodeSwitching) {
            return
        }
        nextEpisodeSwitching = true
        nextEpisodeCardSwitchTarget = next
        nextEpisodeCountdown = null
        showNextEpisodeCard = false
        controlsVisible = false
        // The Next card is only exposed after playback ended or during credits
        // that safely run to the end of the video. Treat advancing from here as
        // completion so Episodes can immediately show the watched marker.
        markCurrentEpisodeCompletedForNext()
        onNextEpisode(next)
    }

    fun handleSourceFailure(
        message: String,
    ) {
        if (!lifecycleState.foreground) {
            deferredSourceFailure = message
            return
        }
        if (recoveryInProgress) {
            return
        }

        sourceRecoverySession.markFailed(source)
        failedSourceUrls =
            sourceRecoverySession.failedSourceUrls()

        val alternate = if (
            settingsStore.autoSourceRecoveryEnabled()
        ) {
            sourceRecoverySession.next(
                rankedSources = playableSources,
                originalLanguage = media.originalLanguage,
            )
        } else {
            null
        }

        if (alternate != null) {
            recoveryInProgress = true
            playbackPhase = PlayerPlaybackPhase.RECOVERING
            playbackError = null
            controlsVisible = true
            gestureMessage = "Trying next source"
            val position = player.currentPosition
                .coerceAtLeast(currentPositionMs)
                .coerceAtLeast(0L)
            savePosition()
            if (showSourceDialog) {
                switchingSourceUrl = alternate.url
            }
            hasRenderedFirstFrame = false
            onSwitchSource(alternate, position)
        } else {
            playbackPhase = PlayerPlaybackPhase.FAILED
            val failedCount =
                sourceRecoverySession.failedSourceCount()
            playbackError =
                if (failedCount > 1) {
                    "$failedCount ranked sources failed to start. " +
                        "Choose Source to try one manually."
                } else {
                    "$message No other suitable automatic source " +
                        "was available."
                }
            controlsVisible = true
            if (
                latestEpisodeSwitchingTo
                    .value
                    ?.id == episode?.id
            ) {
                latestOnEpisodeSwitchFailed
                    .value
                    .invoke()
            }
        }
    }

    LaunchedEffect(player, playerForeground, deferredSourceFailure) {
        val failure = deferredSourceFailure
        if (lifecycleState.foreground && failure != null) {
            deferredSourceFailure = null
            handleSourceFailure(failure)
        }
    }

    fun refreshTrackChoices(
        tracks: Tracks = player.currentTracks,
        acceptEmptyTextTracks: Boolean = !subtitleTrackRefreshInProgress,
    ) {
        val combinedTracks = LiveSmartSubs.mergedTracks(player, tracks)
        val externalSubtitles =
            latestSubtitles.value
                .associateBy(PlayerTrackPolicy::externalSubtitleSelectionId)
        audioTracks = playerTrackChoices(
            tracks = combinedTracks,
            trackType = C.TRACK_TYPE_AUDIO,
        )
        val refreshedTextTracks = playerTrackChoices(
            tracks = combinedTracks,
            trackType = C.TRACK_TYPE_TEXT,
            externalSubtitles = externalSubtitles,
        )
        val workspaceTextTracks = mergeDiscoveredSubtitleChoices(
            playerChoices = refreshedTextTracks,
            discoveredSubtitles = latestSubtitles.value,
        )
        if (workspaceTextTracks.isNotEmpty() || acceptEmptyTextTracks) {
            textTracks = workspaceTextTracks
        }
        val effectiveTextTracks =
            if (refreshedTextTracks.isEmpty() && !acceptEmptyTextTracks) {
                textTracks
            } else {
                refreshedTextTracks
            }
        val confirmedSubtitleSelectionId = effectiveTextTracks
            .firstOrNull { it.selected }
            ?.selectionId
        if (
            requestedSubtitleSelectionId != null &&
            requestedSubtitleSelectionId == confirmedSubtitleSelectionId
        ) {
            requestedSubtitleSelectionId = null
        }
        selectedSubtitleIsExternal =
            !subtitlesDisabled &&
            effectiveTextTracks
                .firstOrNull { it.selected }
                ?.selectionId
                ?.startsWith("external:") == true

        if (!audioPreferenceRestored && audioTracks.isNotEmpty()) {
            val globalSelection =
                settingsStore.lastAudioSelection()
            val savedSelection = globalSelection
                ?: settingsStore.audioSelection(media.id)
            val savedTrack = findSavedAudioTrack(
                tracks = audioTracks,
                savedSelection = savedSelection,
            )

            when {
                savedSelection == PLAYER_AUDIO_AUTO -> {
                    if (globalSelection == null) {
                        settingsStore.setLastAudioSelection(
                            PLAYER_AUDIO_AUTO
                        )
                    }
                    audioPreferenceRestored = true
                    audioAutomaticSelected = true
                    clearTrackOverride(
                        player = player,
                        trackType = C.TRACK_TYPE_AUDIO,
                        disable = false,
                    )
                }

                savedTrack != null -> {
                    if (globalSelection == null && savedSelection != null) {
                        settingsStore.setLastAudioSelection(
                            savedSelection
                        )
                    }
                    audioPreferenceRestored = true
                    audioAutomaticSelected = false
                    applyTrackChoice(
                        player = player,
                        trackType = C.TRACK_TYPE_AUDIO,
                        choice = savedTrack,
                    )
                }

                else -> {
                    audioPreferenceRestored = true
                    audioAutomaticSelected = true
                }
            }
        }

        if (!subtitlePreferenceRestored && refreshedTextTracks.isNotEmpty()) {
            val globalSelection =
                settingsStore.lastSubtitleSelection()
            val contentSelection =
                settingsStore.subtitleSelection(mediaKey)
            val savedSelection =
                PlayerTrackPolicy.resolvedSubtitleSelection(
                    globalSelection = globalSelection,
                    contentSelection = contentSelection,
                )
            val savedLanguage =
                (globalSelection ?: contentSelection)
                ?.takeIf {
                    it.startsWith(
                        PLAYER_SUBTITLE_LANGUAGE_PREFIX
                    )
                }
                ?.removePrefix(
                    PLAYER_SUBTITLE_LANGUAGE_PREFIX
                )
            val savedTrack =
                contentSelection
                    ?.let { selectionId ->
                        textTracks.firstOrNull {
                            it.selectionId == selectionId
                        }
                    }
                    ?: savedLanguage?.let { language ->
                        PlayerTrackPolicy.preferredSubtitle(
                            tracks = textTracks, language = language,
                            providerId = settingsStore.lastSubtitleProviderId(),
                            languageOf = { it.language }, providerOf = { it.externalSubtitle?.providerId },
                        )
                    }
                    ?: textTracks.firstOrNull {
                        it.selectionId == savedSelection
                    }

            when {
                savedSelection == PLAYER_SUBTITLE_OFF -> {
                    if (globalSelection == null) {
                        settingsStore.setLastSubtitleSelection(
                            PLAYER_SUBTITLE_OFF
                        )
                    }
                    subtitlePreferenceRestored = true
                    clearTrackOverride(
                        player = player,
                        trackType = C.TRACK_TYPE_TEXT,
                        disable = true,
                    )
                    subtitlesDisabled = true
                    selectedSubtitleIsExternal = false
                    pendingSubtitleSelectionId = null
                    translatingSubtitleSelectionId = null
                    requestedSubtitleSelectionId = null
                }

                savedTrack?.externalSubtitle != null -> {
                    subtitlePreferenceRestored = true
                    clearTrackOverride(
                        player = player,
                        trackType = C.TRACK_TYPE_TEXT,
                        disable = true,
                    )
                    subtitlesDisabled = false
                    pendingSubtitleSelectionId = savedTrack.selectionId
                    translatingSubtitleSelectionId = if (savedTrack.externalSubtitle?.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) savedTrack.selectionId else null
                    if (savedTrack.externalSubtitle?.providerId == com.vueo.shared.core.smartsubs.SmartSubsPlaybackBridge.PROVIDER_ID) {
                        smartSubsMessage = "Preparing Malay AI… waiting for SmartSubs."
                    }
                    subtitlePreparationJob?.cancel()
                    subtitlePreparationJob = subtitleSelectionScope.launch {
                        val ready = SubtitleReadinessProbe.awaitReady(
                            url = requireNotNull(savedTrack.externalSubtitle).url,
                            onWaiting = {
                                if (pendingSubtitleSelectionId == savedTrack.selectionId) {
                                    translatingSubtitleSelectionId = savedTrack.selectionId
                                }
                            },
                        )
                        var refreshWaitAttempts = 0
                        while (
                            ready &&
                            subtitleTrackRefreshInProgress &&
                            refreshWaitAttempts < 200
                        ) {
                            delay(50L)
                            refreshWaitAttempts += 1
                        }
                        var latestChoice: PlayerTrackChoice? = null
                        var trackWaitAttempts = 0
                        while (
                            ready &&
                            pendingSubtitleSelectionId == savedTrack.selectionId &&
                            latestChoice == null &&
                            trackWaitAttempts < 200
                        ) {
                            val latestExternalSubtitles = latestSubtitles.value
                                .associateBy(PlayerTrackPolicy::externalSubtitleSelectionId)
                            latestChoice = playerTrackChoices(
                                tracks = LiveSmartSubs.mergedTracks(player),
                                trackType = C.TRACK_TYPE_TEXT,
                                externalSubtitles = latestExternalSubtitles,
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
                            val confirmed = applyAndConfirmMobileSubtitleChoice(
                                player = player,
                                selectionId = latestChoice.selectionId,
                                externalSubtitles = {
                                    latestSubtitles.value.associateBy(
                                        PlayerTrackPolicy::externalSubtitleSelectionId
                                    )
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
                                selectedSubtitleIsExternal = true
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
                    if (globalSelection == null) {
                        settingsStore.setLastSubtitleSelection(
                            PlayerTrackPolicy.subtitleLanguageSelectionId(
                                savedTrack.language
                            )
                        )
                    }
                    subtitlePreferenceRestored = true
                    pendingSubtitleSelectionId = null
                    translatingSubtitleSelectionId = null
                    requestedSubtitleSelectionId = savedTrack.selectionId
                    applyTrackChoice(
                        player = player,
                        trackType = C.TRACK_TYPE_TEXT,
                        choice = savedTrack,
                    )
                    subtitlesDisabled = false
                    selectedSubtitleIsExternal =
                        savedTrack.selectionId
                            .startsWith("external:")
                }

                savedSelection == null -> {
                    subtitlePreferenceRestored = true
                }

                subtitles.isNotEmpty() -> {
                    subtitlePreferenceRestored = true
                }
            }
        }
    }

    LaunchedEffect(mediaKey) {
        // Opening the player is a real playback interaction, but the timestamp
        // belongs to this interaction, not to whichever background IO finishes
        // last. If a resume prompt is visible, keep its saved cursor intact.
        val startupEpochMs = PlaybackUpdateClock.next()
        val startupPositionMs =
            if (resumePromptVisible) {
                savedPositionMs
            } else {
                initialPlaybackPositionMs
            }
        enqueueMobilePlayerPersistence(
            block = {
                val initialDurationMs =
                    playbackStore.durationMs(mediaKey)
                libraryStore.recordPlayback(
                    media = media,
                    videoId = videoId,
                    episodeTitle = episode?.title,
                    season = episode?.season,
                    episode = episode?.episode,
                    positionMs = startupPositionMs,
                    durationMs = initialDurationMs,
                    lastWatchedEpochMs = startupEpochMs,
                )
            },
        )
    }

    LaunchedEffect(
        media.id,
        videoId,
        episode?.id,
        contentWarningsEnabled,
    ) {
        contentWarnings = emptyList()
        showContentWarnings = false
        contentWarningsShown = false

        if (!contentWarningsEnabled) {
            return@LaunchedEffect
        }

        val directImdbId =
            extractPlayerImdbId(media.id)
                ?: extractPlayerImdbId(videoId)
                ?: extractPlayerImdbId(episode?.id)
        val imdbId = directImdbId ?: runCatching {
            TmdbEnhancementClient.prepareForCore(
                item = media,
                apiKey = playerPluginStore.tmdbApiKey(),
            ).id
        }.getOrNull()?.let(::extractPlayerImdbId)

        if (imdbId != null) {
            contentWarnings =
                ContentWarningRepository.get(imdbId)
        }
    }

    LaunchedEffect(
        media.id,
        videoId,
        episode?.id,
        episode?.season,
        episode?.episode,
        skipSegmentsEnabled,
    ) {
        skipSegments = emptyList()
        dismissedSkipSegmentKey = null
        val currentEpisode = episode
        if (!skipSegmentsEnabled || currentEpisode == null) {
            return@LaunchedEffect
        }

        val directImdbId =
            extractPlayerImdbId(media.id)
                ?: extractPlayerImdbId(videoId)
                ?: extractPlayerImdbId(currentEpisode.id)
        val imdbId = directImdbId ?: runCatching {
            TmdbEnhancementClient.prepareForCore(
                item = media,
                apiKey = playerPluginStore.tmdbApiKey(),
            ).id
        }.getOrNull()?.let(::extractPlayerImdbId)

        if (imdbId != null) {
            skipSegments = PlayerSkipRepository.segments(
                imdbId = imdbId,
                season = currentEpisode.season,
                episode = currentEpisode.episode,
            )
        }
    }

    LaunchedEffect(
        isPlaying,
        contentWarnings,
        contentWarningsEnabled,
    ) {
        if (!isPlaying || !contentWarningsEnabled) {
            showContentWarnings = false
            return@LaunchedEffect
        }

        if (
            contentWarnings.isNotEmpty() &&
            !contentWarningsShown
        ) {
            contentWarningsShown = true
            showContentWarnings = true
        }
    }

    // Keep sampler/frame attribution on PLAYER while Details hosts this surface.
    val traktPlaybackContext = context
    val traktPlayback = remember(player, mediaKey) {
        com.vueo.shared.core.trakt.TraktPlaybackSession(traktPlaybackContext, media, episode?.season, episode?.episode)
    }
    DisposableEffect(player, traktPlayback) {
        fun publish() {
            traktPlayback.update(
                playing = player.playWhenReady && player.playbackState == Player.STATE_READY,
                buffering = player.playbackState == Player.STATE_BUFFERING || player.playbackState == Player.STATE_IDLE,
                ended = player.playbackState == Player.STATE_ENDED,
                positionMs = player.currentPosition,
                durationMs = player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L,
            )
        }
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) { publish() }
        }
        player.addListener(listener)
        publish()
        onDispose {
            runCatching {
                traktPlayback.stop(player.currentPosition, player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L)
            }
            runCatching { player.removeListener(listener) }
        }
    }

    DisposableEffect(player) {
        val cloudSync = com.vueo.shared.core.sync.VueoSyncService.get(context)
        cloudSync.setPlayerActive(true)
        val screenToken = PerformanceDiagnostics.enterPlayerScreen("Mobile")
        onDispose { cloudSync.setPlayerActive(false); PerformanceDiagnostics.exitPlayerScreen(screenToken) }
    }

    DisposableEffect(player, mediaKey, source.url) {
        val startedNs = System.nanoTime()
        var lastState = -1
        var bufferingNs = 0L
        var emitted = 0
        var firstFrameLogged = false
        fun log(event: String, details: String) {
            if (PerformanceDiagnostics.isCollecting() && emitted < 120) {
                emitted++
                com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlayerEvent(
                    "Mobile", event, details,
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

    val decoderRecovery = remember(player, source.url) {
        com.vueo.shared.core.player.VideoDecoderRecovery(videoDecoderSession)
    }

    DisposableEffect(
        player,
        liveSmartSubs,
        mediaKey,
        source.url,
    ) {
        val listener =
            object : Player.Listener {
                override fun onPlayerError(
                    error: PlaybackException,
                ) {
                    com.vueo.shared.core.diagnostics.RuntimeDiagnostics.recordPlaybackError(
                        platform = "Mobile", provider = source.providerName,
                        server = source.serverName ?: source.name,
                        url = source.url, mimeType = player.currentMediaItem?.localConfiguration?.mimeType,
                        errorCode = error.errorCode, errorName = error.errorCodeName,
                        positionMs = player.currentPosition, state = player.playbackState, error = error,
                    )
                    val failedFormat = (error as? androidx.media3.exoplayer.ExoPlaybackException)
                        ?.rendererFormat
                    if (lifecycleState.foreground && !playerExitRequested &&
                        decoderRecovery.tryRecover(player, error, failedFormat, "Mobile", currentPositionMs)
                    ) {
                        playbackError = null
                        isBuffering = true
                        return
                    }
                    isBuffering = false
                    handleSourceFailure(
                        decoderRecovery.failureMessage(error, failedFormat)
                            ?: friendlyPlaybackError(error)
                    )
                }

                override fun onTracksChanged(
                    tracks: Tracks,
                ) {
                    refreshTrackChoices(tracks)
                }

                override fun onPlaybackStateChanged(
                    playbackState: Int,
                ) {
                    playbackEnded =
                        playbackState == Player.STATE_ENDED
                    isBuffering =
                        playbackState ==
                            Player.STATE_BUFFERING

                    if (
                        playbackState == Player.STATE_BUFFERING
                    ) {
                        playbackPhase =
                            if (hasRenderedFirstFrame) {
                                PlayerPlaybackPhase.BUFFERING
                            } else {
                                PlayerPlaybackPhase.LOADING
                            }
                    }

                    if (
                        playbackState ==
                            Player.STATE_READY
                    ) {
                        if (subtitleTrackRefreshInProgress) {
                            subtitleTrackRefreshInProgress = false
                            refreshTrackChoices(
                                tracks = LiveSmartSubs.mergedTracks(player),
                                acceptEmptyTextTracks = true,
                            )
                        }
                        sourceRecoverySession.markReady()
                        playbackError = null
                        playbackPhase = PlayerPlaybackPhase.READY
                        recoveryInProgress = false
                    }

                    if (
                        playbackState ==
                            Player.STATE_ENDED
                    ) {
                        if (!completionPersistenceQueued) {
                            completionPersistenceQueued = true
                            val completedDurationMs =
                                player.duration.coerceAtLeast(0L)
                            enqueuePlaybackProgress(
                                positionMs = completedDurationMs,
                                durationMs = completedDurationMs,
                                clearPlaybackPosition = true,
                                notifyLibrary = true,
                            )
                        }
                        if (
                            nextEpisode != null &&
                            !nextEpisodeCardDismissed
                        ) {
                            showNextEpisodeCard = true
                            controlsVisible = true
                        }
                    }
                }

                override fun onIsPlayingChanged(
                    playing: Boolean,
                ) {
                    isPlaying = playing
                    if (!playing) {
                        controlsVisible = true
                        if (
                            !playerExitRequested &&
                            player.playbackState != Player.STATE_ENDED &&
                            !player.playWhenReady
                        ) {
                            // Ignore transient isPlaying=false during buffering/seek.
                            savePosition()
                        }
                    }
                }

                override fun onRenderedFirstFrame() {
                    hasRenderedFirstFrame = true
                    playbackPhase = PlayerPlaybackPhase.READY
                    playbackError = null
                    recoveryInProgress = false
                    if (
                        latestEpisodeSwitchingTo
                            .value
                            ?.id == episode?.id
                    ) {
                        if (
                            nextEpisodeCardSwitchTarget
                                ?.id == episode?.id
                        ) {
                            nextEpisodeCardSwitchTarget = null
                        }
                        showEpisodeDialog = false
                        latestOnEpisodeSwitchCompleted
                            .value
                            .invoke()
                    }
                }
            }

        val overlayTracksChanged: (Boolean) -> Unit = { choicesChanged ->
            if (choicesChanged) subtitlePreferenceRestored = false
            refreshTrackChoices()
        }
        liveSmartSubs.addTrackListener(overlayTracksChanged)
        player.addListener(listener)
        refreshTrackChoices()

        onDispose {
            liveSmartSubs.removeTrackListener(overlayTracksChanged)
            player.removeListener(listener)
        }
    }

    DisposableEffect(player) {
        val resources = MobilePlayerResourceLease(PerformanceDiagnostics::captureRuntimeEvent)
        onDispose {
            resources.disposalStarted()
            // Snapshot before any release; the deferred task must not query a released player.
            val exitPositionMs = runCatching { player.currentPosition.coerceAtLeast(0L) }.getOrDefault(0L)
            val exitDurationMs = runCatching {
                player.duration.takeIf { it > 0L && it != C.TIME_UNSET } ?: 0L
            }.getOrDefault(0L)
            try {
                runCatching { player.volume = 0f }
                runCatching { player.pause() }
                if (!playerExitRequested && !episodeHandoffPersistenceQueued && !completionPersistenceQueued) {
                    if (exitPositionMs > minimumResumePositionMs) lastValidPlaybackPositionMs = exitPositionMs
                    val stablePositionMs = if (exitPositionMs > minimumResumePositionMs) {
                        exitPositionMs
                    } else lastValidPlaybackPositionMs
                    if (stablePositionMs > minimumResumePositionMs) {
                        enqueuePlaybackProgress(
                            positionMs = stablePositionMs,
                            durationMs = exitDurationMs,
                            notifyLibrary = true,
                        )
                    }
                }
            } catch (error: Exception) {
                PerformanceDiagnostics.captureRuntimeEvent(
                    "PLAYER_RESOURCE platform=Mobile event=progress_cleanup_failed error=${error.javaClass.simpleName}",
                )
            } finally {
                // Clear the video output immediately. AndroidView also unbinds its
                // PlayerView in onRelease, including subtitle observers and cues.
                runCatching { player.clearVideoSurface() }
                val releaseResources = {
                    resources.release(
                        beforeRelease = { traktPlayback.stop(exitPositionMs, exitDurationMs) },
                        releasePlayer = { player.release() },
                    )
                }
                val episodeHandoff = episodeHandoffPersistenceQueued || latestEpisodeSwitchingTo.value != null
                if (episodeHandoff) {
                    releaseResources()
                } else {
                    // Retain the existing short defer for View disposal, on the
                    // player's application thread. Always release after cleanup.
                    mobilePlayerCleanupScope.launch {
                        delay(64L)
                        releaseResources()
                    }
                }
            }
        }
    }

    LaunchedEffect(
        source.url,
    ) {
        sourceRecoverySession.begin(source)
        playbackPhase = PlayerPlaybackPhase.LOADING
        playbackError = null
        isBuffering = false
        hasRenderedFirstFrame = false
        recoveryInProgress = false
    }

    LaunchedEffect(
        showSourceDialog,
        source.url,
        hasRenderedFirstFrame,
        switchingSourceUrl,
    ) {
        val pendingUrl = switchingSourceUrl
        if (
            showSourceDialog &&
            pendingUrl != null &&
            source.url == pendingUrl &&
            hasRenderedFirstFrame
        ) {
            showSourceDialog = false
            switchingSourceUrl = null
            controlsVisible = true
        }
    }

    LaunchedEffect(
        player,
        retryGeneration,
        resumePromptVisible,
        hasRenderedFirstFrame,
        playerForeground,
    ) {
        if (
            !playerForeground ||
            resumePromptVisible ||
            hasRenderedFirstFrame ||
            playbackError != null
        ) {
            return@LaunchedEffect
        }

        val startupTimeoutMs =
            if (sourceRecoverySession.isAutomaticRecoveryActive()) {
                PLAYER_RECOVERY_SOURCE_TIMEOUT_MS
            } else {
                PLAYER_STARTUP_TIMEOUT_MS
            }
        delay(startupTimeoutMs)
        if (
            lifecycleState.foreground &&
            !hasRenderedFirstFrame &&
            playbackError == null &&
            !recoveryInProgress
        ) {
            handleSourceFailure(
                "This source did not start within " +
                    "${startupTimeoutMs / 1_000L} seconds."
            )
        }
    }

    LaunchedEffect(
        player,
        isBuffering,
        hasRenderedFirstFrame,
        retryGeneration,
        playerForeground,
    ) {
        if (
            !playerForeground ||
            !isBuffering ||
            !hasRenderedFirstFrame ||
            playbackError != null
        ) {
            return@LaunchedEffect
        }

        delay(PLAYER_REBUFFER_TIMEOUT_MS)
        if (
            lifecycleState.foreground &&
            isBuffering &&
            hasRenderedFirstFrame &&
            playbackError == null &&
            !recoveryInProgress
        ) {
            handleSourceFailure(
                "Playback remained stuck buffering for 25 seconds."
            )
        }
    }

    LaunchedEffect(
        player,
        playbackSpeed,
    ) {
        player.setPlaybackSpeed(playbackSpeed)
    }

    LaunchedEffect(
        player,
        mediaKey,
        playerForeground,
    ) {
        if (!playerForeground) return@LaunchedEffect
        var librarySaveTicks = 0
        while (lifecycleState.foreground) {
            val sampledPositionMs =
                player.currentPosition
                    .coerceAtLeast(0L)
            val sampledDurationMs =
                player.duration
                    .coerceAtLeast(0L)

            currentPositionMs = sampledPositionMs
            durationMs = sampledDurationMs

            if (sampledPositionMs > minimumResumePositionMs) {
                lastValidPlaybackPositionMs =
                    sampledPositionMs
            }

            librarySaveTicks++
            if (librarySaveTicks >= 20) {
                val stablePositionMs =
                    if (sampledPositionMs > minimumResumePositionMs) {
                        sampledPositionMs
                    } else {
                        lastValidPlaybackPositionMs
                    }

                if (stablePositionMs > minimumResumePositionMs) {
                    val playbackSnapshot =
                        playbackStore.capturePosition(
                            mediaKey = mediaKey,
                            positionMs = stablePositionMs,
                            durationMs = sampledDurationMs,
                        )
                    enqueueMobilePlayerPersistence(
                        block = {
                            playbackStore.persistSnapshot(playbackSnapshot)
                        },
                    )
                }
                librarySaveTicks = 0
            }
            delay(500L)
        }
    }

    LaunchedEffect(
        controlsVisible,
        isPlaying,
        controlsLocked,
        gestureActive,
        playerPanelVisible,
        nextEpisodeCardVisible,
        playerForeground,
    ) {
        if (
            playerForeground &&
            controlsVisible &&
            isPlaying &&
            !controlsLocked &&
            !gestureActive &&
            !playerPanelVisible &&
            !nextEpisodeCardVisible
        ) {
            delay(3_000L)
            if (lifecycleState.foreground) controlsVisible = false
        }
    }

    LaunchedEffect(source.url) {
        onActiveSourceChanged(source)
    }

    var nextEpisodePrefetchDispatched by remember(videoId, source.url) {
        mutableStateOf(false)
    }
    var nextEpisodeThreeMinuteCheckDispatched by remember(videoId, source.url) {
        mutableStateOf(false)
    }
    var nextEpisodeOneMinuteCheckDispatched by remember(videoId, source.url) {
        mutableStateOf(false)
    }
    val nextEpisodePrefetchBaseEligible =
        playerForeground && isPlaying &&
            episodeSwitchingTo == null &&
            nextEpisode != null &&
            durationMs > 0L
    val nextEpisodePrefetchEligible =
        nextEpisodePrefetchBaseEligible &&
            currentPositionMs >=
                (durationMs - 300_000L).coerceAtLeast(0L)
    val nextEpisodeThreeMinuteCheckEligible =
        nextEpisodePrefetchBaseEligible &&
            currentPositionMs >=
                (durationMs - 180_000L).coerceAtLeast(0L)
    val nextEpisodeOneMinuteCheckEligible =
        nextEpisodePrefetchBaseEligible &&
            currentPositionMs >=
                (durationMs - 60_000L).coerceAtLeast(0L)

    LaunchedEffect(
        nextEpisodePrefetchEligible,
        nextEpisode?.id,
        source.url,
    ) {
        if (nextEpisodePrefetchEligible && !nextEpisodePrefetchDispatched) {
            nextEpisodePrefetchDispatched = true
            nextEpisode?.let { target ->
                onPrefetchNextEpisode(target, source)
            }
        }
    }

    LaunchedEffect(
        nextEpisodeThreeMinuteCheckEligible,
        nextEpisode?.id,
        source.url,
    ) {
        if (
            nextEpisodeThreeMinuteCheckEligible &&
            !nextEpisodeThreeMinuteCheckDispatched
        ) {
            nextEpisodeThreeMinuteCheckDispatched = true
            nextEpisode?.let { target ->
                // Ensure the same T-5 pipeline owns the standby object before
                // validating it. Existing matching prefetches return immediately.
                onPrefetchNextEpisode(target, source)
                onValidateNextEpisodePrefetch(target, source, 180)
            }
        }
    }

    LaunchedEffect(
        nextEpisodeOneMinuteCheckEligible,
        nextEpisode?.id,
        source.url,
    ) {
        if (
            nextEpisodeOneMinuteCheckEligible &&
            !nextEpisodeOneMinuteCheckDispatched
        ) {
            nextEpisodeOneMinuteCheckDispatched = true
            nextEpisode?.let { target ->
                onPrefetchNextEpisode(target, source)
                onValidateNextEpisodePrefetch(target, source, 60)
            }
        }
    }

    val earlyNextEligible =
        skipSegmentsEnabled &&
            durationMs > 0L &&
            PlayerSkipPolicy.canStartNextDuringCredits(
                skipSegments,
                currentPositionMs,
                durationMs,
            )

    val autoNextEligible =
        playerForeground && !nextEpisodeSwitching &&
            !nextEpisodeCardDismissed &&
            autoPlayNextEpisode &&
            nextEpisode != null &&
            !playerPanelVisible &&
            playbackError == null &&
            !recoveryInProgress &&
            gestureSeekPositionMs == null &&
            !gestureActive &&
            player.playWhenReady &&
            (
                playbackEnded ||
                    (
                        earlyNextEligible &&
                            isPlaying &&
                            !isBuffering &&
                            hasRenderedFirstFrame
                        )
                )
    val latestAutoNextEligible =
        rememberUpdatedState(autoNextEligible)

    LaunchedEffect(
        playbackEnded,
        earlyNextEligible,
        nextEpisode?.id,
        nextEpisodeCardDismissed,
        nextEpisodeCardSwitchTarget?.id,
    ) {
        val shouldShow =
            nextEpisode != null &&
                !nextEpisodeCardDismissed &&
                (playbackEnded || earlyNextEligible)

        if (shouldShow) {
            showNextEpisodeCard = true
            controlsVisible = true
        } else if (nextEpisodeCardSwitchTarget == null) {
            showNextEpisodeCard = false
            nextEpisodeCountdown = null
        }
    }

    LaunchedEffect(autoNextEligible, nextEpisode?.id) {
        val targetEpisode = nextEpisode
        if (!autoNextEligible || targetEpisode == null) {
            nextEpisodeCountdown = null
            return@LaunchedEffect
        }

        for (remaining in 8 downTo 1) {
            nextEpisodeCountdown = remaining
            delay(1_000L)
            if (!lifecycleState.foreground || !latestAutoNextEligible.value) {
                nextEpisodeCountdown = null
                return@LaunchedEffect
            }
        }

        // Recheck the real player at dispatch time. A seek, pause, buffer,
        // open workspace, recovery or unsafe post-credit interval must not
        // advance the episode just because the UI poll was briefly eligible.
        val actualDurationMs =
            player.duration
                .takeIf { it > 0L && it != C.TIME_UNSET }
                ?: 0L
        val finished =
            player.playbackState == Player.STATE_ENDED
        val safeCredits =
            skipSegmentsEnabled &&
                player.isPlaying &&
                PlayerSkipPolicy.canStartNextDuringCredits(
                    skipSegments,
                    player.currentPosition,
                    actualDurationMs,
                )

        nextEpisodeCountdown = null
        if (
            !lifecycleState.foreground ||
            !latestAutoNextEligible.value ||
            !player.playWhenReady ||
            playerPanelVisible ||
            playbackError != null ||
            recoveryInProgress ||
            gestureSeekPositionMs != null ||
            gestureActive ||
            nextEpisodeCardDismissed ||
            !autoPlayNextEpisode ||
            (!finished && !safeCredits) ||
            nextEpisodeSwitching
        ) {
            return@LaunchedEffect
        }

        startNextEpisode()
    }

    LaunchedEffect(
        gestureMessage,
        gestureActive,
    ) {
        val message = gestureMessage
        if (message != null && !gestureActive) {
            delay(700L)
            if (
                gestureMessage == message &&
                !gestureActive
            ) {
                gestureMessage = null
            }
        }
    }

    PlayerFullscreenEffect(
        context = context,
        orientation =
            settingsStore.playerOrientation(),
    )

    if (resumePromptVisible) {
        PlayerResumePrompt(
            positionLabel =
                formatPlaybackTime(savedPositionMs),
            onResume = {
                player.seekTo(savedPositionMs)
                player.playWhenReady = lifecycleState.foreground
                resumePromptVisible = false
            },
            onStartOver = {
                playbackStore.clearPosition(mediaKey)
                lastValidPlaybackPositionMs = 0L
                player.seekTo(0L)
                player.playWhenReady = lifecycleState.foreground
                resumePromptVisible = false
            },
            onDismiss = {
                requestPlayerExit()
            },
        )
    }

    PlayerAudioWorkspace(
            visible = showAudioDialog,
            tracks = audioTracks,
            automaticSelected = audioAutomaticSelected,
            onAutomatic = {
                clearTrackOverride(
                    player = player,
                    trackType = C.TRACK_TYPE_AUDIO,
                    disable = false,
                )
                audioAutomaticSelected = true
                settingsStore.setLastAudioSelection(
                    PLAYER_AUDIO_AUTO
                )
                showAudioDialog = false
            },
            onSelect = { choice ->
                applyTrackChoice(
                    player = player,
                    trackType = C.TRACK_TYPE_AUDIO,
                    choice = choice,
                )
                audioAutomaticSelected = false
                settingsStore.setLastAudioSelection(
                    choice.selectionId
                )
                showAudioDialog = false
            },
            onDismiss = {
                showAudioDialog = false
            },
        )

    fun requestSubtitleChoice(choice: PlayerTrackChoice) {
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
        fun commitSelection(selected: PlayerTrackChoice) {
            applyTrackChoice(
                player = player,
                trackType = C.TRACK_TYPE_TEXT,
                choice = selected,
            )
            subtitlesDisabled = false
            selectedSubtitleIsExternal =
                selected.selectionId.startsWith("external:")
            settingsStore.setSubtitleSelection(
                contentId = mediaKey,
                selectionId = selected.selectionId,
            )
            settingsStore.rememberSubtitlePreference(
                language = selected.language,
                providerId = selected.externalSubtitle?.providerId,
            )
        }

        subtitlePreparationJob?.cancel()
        val externalSubtitle = choice.externalSubtitle
        smartSubsMessage = null
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
            // Keep the currently selected subtitle active while the requested
            // external track is being prepared. The readiness probe does not
            // select the new track, so Media3 keeps rendering the old one until
            // the prepared choice is applied and confirmed below.
            subtitlePreparationJob = subtitleSelectionScope.launch {
                val ready = SubtitleReadinessProbe.awaitReady(
                    url = externalSubtitle.url,
                    forceNetwork = forceNetworkRetry,
                    onWaiting = {
                        if (pendingSubtitleSelectionId == choice.selectionId) {
                            translatingSubtitleSelectionId = choice.selectionId
                        }
                    },
                )
                var refreshWaitAttempts = 0
                while (
                    ready &&
                    subtitleTrackRefreshInProgress &&
                    refreshWaitAttempts < 200
                ) {
                    delay(50L)
                    refreshWaitAttempts += 1
                }
                var latestChoice: PlayerTrackChoice? = null
                var trackWaitAttempts = 0
                while (
                    ready &&
                    pendingSubtitleSelectionId == choice.selectionId &&
                    latestChoice == null &&
                    trackWaitAttempts < SUBTITLE_TRACK_ATTACH_WAIT_ATTEMPTS
                ) {
                    val latestExternalSubtitles = latestSubtitles.value
                        .associateBy(PlayerTrackPolicy::externalSubtitleSelectionId)
                    latestChoice = playerTrackChoices(
                        tracks = LiveSmartSubs.mergedTracks(player),
                        trackType = C.TRACK_TYPE_TEXT,
                        externalSubtitles = latestExternalSubtitles,
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
                        // Explicitly reselecting the active external track is a manual
                        // delivery retry. Re-open the text renderer after the forced
                        // readiness GET has refreshed the session cache.
                        clearTrackOverride(
                            player = player,
                            trackType = C.TRACK_TYPE_TEXT,
                            disable = true,
                        )
                        delay(50L)
                    }
                    val confirmed = applyAndConfirmMobileSubtitleChoice(
                        player = player,
                        selectionId = preparedChoice.selectionId,
                        externalSubtitles = {
                            latestSubtitles.value.associateBy(
                                PlayerTrackPolicy::externalSubtitleSelectionId
                            )
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
                        selectedSubtitleIsExternal = true
                        settingsStore.setSubtitleSelection(
                            contentId = mediaKey,
                            selectionId = preparedChoice.selectionId,
                        )
                        settingsStore.rememberSubtitlePreference(
                            language = preparedChoice.language,
                            providerId = preparedChoice.externalSubtitle?.providerId,
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
                    // Keep the user's requested track as the visible intent. A slow
                    // generated subtitle can be retried by tapping the same selected
                    // row again instead of bouncing back to the previous selection.
                    pendingSubtitleSelectionId = null
                }
                if (translatingSubtitleSelectionId == choice.selectionId) {
                    translatingSubtitleSelectionId = null
                }
                subtitlePreparationJob = null
            }
        }
    }

    fun requestSubtitleRefresh() {
        if (subtitleDiscoveryRefreshing) return
        subtitleDiscoveryRefreshing = true
        subtitleRefreshMessage = null
        subtitleSelectionScope.launch {
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

    if (dialogueSyncOpen) {
        SubtitleDialogueSyncDialog(
            player = player,
            track = dialogueSyncTrack,
            headers = source.headers,
            delayMs = subtitleDelayMs,
            onApply = { updated ->
                subtitleDelayMs = updated
                context.setPlayerSubtitleDelayMs(mediaKey = mediaKey, delayMs = updated)
            },
            onDismiss = { dialogueSyncOpen = false },
        )
    }

    PlayerSubtitleWorkspace(
            visible = showSubtitleDialog,
            refreshing = subtitleDiscoveryRefreshing,
            refreshMessage = smartSubsMessage ?: if (smartSubsRefreshing) "Preparing SmartSubs choices…" else subtitleRefreshMessage,
            onRefresh = ::requestSubtitleRefresh,
            onSyncByDialogue = {
                val selected = textTracks.firstOrNull { it.selected }
                dialogueSyncTrack = if (!subtitlesDisabled && pendingSubtitleSelectionId == null && translatingSubtitleSelectionId == null) {
                    selected?.externalSubtitle ?: latestSubtitles.value.firstOrNull {
                        PlayerTrackPolicy.externalSubtitleSelectionId(it) == selected?.selectionId
                    }
                } else null
                showSubtitleDialog = false
                controlsVisible = false
                dialogueSyncOpen = true
            },
            tracks = textTracks,
            subtitlesDisabled = subtitlesDisabled,
            pendingSelectionId = pendingSubtitleSelectionId,
            translatingSelectionId = translatingSubtitleSelectionId,
            requestedSelectionId = requestedSubtitleSelectionId,
            secondaryLanguageCode = settingsStore
                .secondarySubtitleLanguage()
                .languageCode,
            visibilityPreferredLanguageCode = settingsStore
                .preferredSubtitleLanguage()
                .languageCode,
            preferredLanguageOnly =
                settingsStore.subtitleVisibility() ==
                    com.vueo.shared.core.storage.SubtitleVisibility.PREFERRED_ONLY,
            subtitleDelayMs = subtitleDelayMs,
            style = subtitleStyle,
            onDisable = {
                smartSubsMessage = null
                subtitlePreparationJob?.cancel()
                subtitlePreparationJob = null
                pendingSubtitleSelectionId = null
                translatingSubtitleSelectionId = null
                requestedSubtitleSelectionId = null
                clearTrackOverride(
                    player = player,
                    trackType = C.TRACK_TYPE_TEXT,
                    disable = true,
                )
                subtitlesDisabled = true
                selectedSubtitleIsExternal = false
                settingsStore.setSubtitleSelection(
                    contentId = mediaKey,
                    selectionId = PLAYER_SUBTITLE_OFF,
                )
                settingsStore.setLastSubtitleSelection(
                    PLAYER_SUBTITLE_OFF
                )
            },
            onSelect = { choice ->
                requestSubtitleChoice(choice)
            },
            onSubtitleDelayChange = { delayMs ->
                subtitleDelayMs =
                    delayMs.coerceIn(-60_000, 60_000)
                context.setPlayerSubtitleDelayMs(
                    mediaKey = mediaKey,
                    delayMs = subtitleDelayMs,
                )
            },
            onStyleChange = { updated ->
                subtitleStyle = updated
                settingsStore.setSubtitleFontSizeSp(
                    updated.fontSizeSp
                )
                settingsStore.setSubtitleCommentaryFontSizeSp(
                    updated.commentaryFontSizeSp
                )
                settingsStore.setSubtitleFontFamily(
                    updated.fontFamily
                )
                settingsStore.setSubtitleBold(
                    updated.bold
                )
                settingsStore.setSubtitleCommentaryEnabled(
                    updated.showCommentary
                )
                settingsStore.setSubtitleTextColor(
                    updated.textColor
                )
                settingsStore.setSubtitleOutlineEnabled(
                    updated.outlineEnabled
                )
                settingsStore.setSubtitleOutlineColor(
                    updated.outlineColor
                )
                settingsStore.setSubtitleBackgroundEnabled(
                    updated.backgroundEnabled
                )
                settingsStore.setSubtitleBackgroundColor(
                    updated.backgroundColor
                )
                settingsStore.setSubtitleBackgroundOpacityPercent(
                    updated.backgroundOpacityPercent
                )
                settingsStore.setSubtitleBottomPaddingPercent(
                    updated.bottomPaddingPercent
                )
            },
            onOpenStyle = {
                showSubtitleDialog = false
                showSubtitleStyleOverlay = true
                controlsVisible = false
            },
            onDismiss = {
                showSubtitleDialog = false
                controlsVisible = true
            },
        )

    if (showSubtitleStyleOverlay) {
        PlayerSubtitleStyleOverlay(
            subtitleDelayMs = subtitleDelayMs,
            style = subtitleStyle,
            onSubtitleDelayChange = { delayMs ->
                subtitleDelayMs =
                    delayMs.coerceIn(-60_000, 60_000)
                context.setPlayerSubtitleDelayMs(
                    mediaKey = mediaKey,
                    delayMs = subtitleDelayMs,
                )
            },
            onStyleChange = { updated ->
                subtitleStyle = updated
                settingsStore.setSubtitleFontSizeSp(updated.fontSizeSp)
                settingsStore.setSubtitleCommentaryFontSizeSp(updated.commentaryFontSizeSp)
                settingsStore.setSubtitleFontFamily(updated.fontFamily)
                settingsStore.setSubtitleBold(updated.bold)
                settingsStore.setSubtitleCommentaryEnabled(updated.showCommentary)
                settingsStore.setSubtitleTextColor(updated.textColor)
                settingsStore.setSubtitleOutlineEnabled(updated.outlineEnabled)
                settingsStore.setSubtitleOutlineColor(updated.outlineColor)
                settingsStore.setSubtitleBackgroundEnabled(updated.backgroundEnabled)
                settingsStore.setSubtitleBackgroundColor(updated.backgroundColor)
                settingsStore.setSubtitleBackgroundOpacityPercent(
                    updated.backgroundOpacityPercent
                )
                settingsStore.setSubtitleBottomPaddingPercent(
                    updated.bottomPaddingPercent
                )
            },
            onDismiss = {
                showSubtitleStyleOverlay = false
                controlsVisible = true
            },
        )
    }

    PlayerSourcesWorkspace(
            visible = showSourceDialog,
            title = episode?.let {
                "S${it.season} E${it.episode} • ${it.title}"
            } ?: title,
            sources = playableSources,
            currentSource = source,
            currentPlaybackFailed = playbackError != null,
            failedSourceUrls = failedSourceUrls,
            providerOrder = sourceProviderOrder,
            originalLanguage = media.originalLanguage,
            switchingSourceUrl = switchingSourceUrl,
            searching = sourcesSearching,
            pluginsStopped = pluginsStopped,
            sourcesStopped = sourcesStopped,
            onRefresh = onRefreshSources,
            onStop = onStopSources,
            onSelect = { candidate ->
                val switchPosition = player.currentPosition
                    .coerceAtLeast(0L)
                savePosition()
                switchingSourceUrl = candidate.url
                hasRenderedFirstFrame = false
                playbackPhase = PlayerPlaybackPhase.LOADING
                onSwitchSource(candidate, switchPosition)
            },
            onDismiss = {
                showSourceDialog = false
                switchingSourceUrl = null
            },
        )

    var episodeHistory by remember(
        media.id,
        media.type,
    ) {
        mutableStateOf<List<LibraryPlaybackEntry>>(emptyList())
    }
    LaunchedEffect(
        media.id,
        media.type,
        episodeHistoryRevision,
    ) {
        episodeHistory = withContext(Dispatchers.IO) {
            mobilePlayerPersistenceMutex.withLock {
                libraryStore.history()
                    .filter { entry ->
                        entry.media.type == media.type &&
                            entry.media.id == media.id
                    }
            }
        }
    }
    val progressByEpisodeId = episodes.associate { candidate ->
            val stored = episodeHistory.firstOrNull { entry ->
                entry.videoId == candidate.id ||
                    (
                        entry.season == candidate.season &&
                            entry.episode == candidate.episode
                    )
            }
            val isCurrent = candidate.id == episode?.id
            val candidateDurationMs = if (isCurrent) {
                durationMs
            } else {
                stored?.durationMs ?: 0L
            }
            val candidatePositionMs = if (isCurrent) {
                currentPositionMs
            } else {
                stored?.positionMs ?: 0L
            }
            val fraction = if (candidateDurationMs > 0L) {
                (
                    candidatePositionMs.toDouble() /
                        candidateDurationMs.toDouble()
                ).coerceIn(0.0, 1.0).toFloat()
            } else {
                0f
            }

            candidate.id to PlayerEpisodeProgress(
                fraction = fraction,
                watched = stored?.isCompleted == true,
                positionMs = candidatePositionMs,
            )
        }

    PlayerEpisodesWorkspace(
            visible = showEpisodeDialog,
            seriesTitle = media.name,
            episodes = episodes,
            currentEpisode = episode,
            progressByEpisodeId = progressByEpisodeId,
            switchingEpisodeId =
                episodeSwitchingTo?.id,
            switchingFailed =
                episodeSwitchFailed,
            onEpisodeSelected = { candidate ->
                saveCurrentForEpisodeHandoff()
                nextEpisodeCountdown = null
                showNextEpisodeCard = false
                nextEpisodeCardDismissed = true
                onEpisodeSelected(candidate)
            },
            onDismiss = { showEpisodeDialog = false },
        )

    PlayerMoreWorkspace(
            visible = showMoreDialog,
            playbackSpeed = playbackSpeed,
            videoFit = videoFit,
            autoPlayNextEpisode = autoPlayNextEpisode,
            skipSegmentsEnabled = skipSegmentsEnabled,
            contentWarningsEnabled = contentWarningsEnabled,
            onPlaybackSpeedChange = { speed ->
                playbackSpeed = speed
                settingsStore.setPlayerPlaybackSpeed(speed)
                player.setPlaybackSpeed(speed)
            },
            onVideoFitChange = { fit ->
                videoFit = fit
                settingsStore.setPlayerVideoFit(fit)
            },
            onAutoPlayNextEpisodeChange = { enabled ->
                autoPlayNextEpisode = enabled
                settingsStore.setAutoPlayNextEpisodeEnabled(enabled)
                if (!enabled) {
                    nextEpisodeCountdown = null
                }
            },
            onSkipSegmentsChange = { enabled ->
                skipSegmentsEnabled = enabled
                settingsStore.setSkipSegmentsEnabled(enabled)
            },
            onContentWarningsChange = { enabled ->
                contentWarningsEnabled = enabled
                settingsStore.setContentWarningsEnabled(enabled)
                if (!enabled) {
                    showContentWarnings = false
                }
            },
            onReset = {
                playbackSpeed = 1f
                player.setPlaybackSpeed(1f)
                settingsStore.setPlayerPlaybackSpeed(1f)
                videoFit = PlayerVideoFit.FIT
                settingsStore.setPlayerVideoFit(PlayerVideoFit.FIT)
                autoPlayNextEpisode = true
                settingsStore.setAutoPlayNextEpisodeEnabled(true)
                skipSegmentsEnabled = true
                settingsStore.setSkipSegmentsEnabled(true)
                contentWarningsEnabled = true
                settingsStore.setContentWarningsEnabled(true)
                gestureMessage = "Player controls reset"
            },
            onDismiss = { showMoreDialog = false },
        )

    val baseSubtitleBottomPaddingFraction =
        subtitleStyle.bottomPaddingPercent / 100f
    val subtitleBottomPaddingFraction =
        if (controlsVisible && !playerPanelVisible) {
            maxOf(baseSubtitleBottomPaddingFraction, 0.18f)
        } else {
            baseSubtitleBottomPaddingFraction
        }

    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(Color.Black),
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { playerContext ->
                MobileSubtitlePlayerView(playerContext).apply {
                    useController = false
                    keepScreenOn = true
                    bindPlayer(player, "$mediaKey:${source.url}")
                    applySubtitlePresentation(
                        style = subtitleStyle,
                        bottomPadding = subtitleBottomPaddingFraction,
                    )
                    resizeMode = videoFit.toMedia3ResizeMode()
                }
            },
            onRelease = { view ->
                view.releasePlayerBinding()
            },
            update = { view ->
                view.bindPlayer(player, "$mediaKey:${source.url}")
                view.useController = false
                view.applySubtitlePresentation(
                    style = subtitleStyle,
                    bottomPadding = subtitleBottomPaddingFraction,
                )
                view.resizeMode = videoFit.toMedia3ResizeMode()
            },
        )

        if (!controlsLocked) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(
                        player,
                        durationMs,
                        controlsLocked,
                    ) {
                        try {
                            awaitEachGesture {
                            val down = awaitFirstDown(
                                requireUnconsumed = false
                            )
                            var totalX = 0f
                            var totalY = 0f
                            var mode = 0
                            var zoomAmount = 1f
                            var seekPreview: Long? = null
                            val startX = down.position.x
                            val startPosition =
                                player.currentPosition
                            val startVolume =
                                audioManager
                                    .getStreamVolume(
                                        AudioManager.STREAM_MUSIC
                                    )
                            val startBrightness =
                                activity?.window
                                    ?.attributes
                                    ?.screenBrightness
                                    ?.takeIf {
                                        it >= 0f
                                    }
                                    ?: 0.5f

                            while (true) {
                                val event = awaitPointerEvent()
                                val pressed =
                                    event.changes.filter {
                                        it.pressed
                                    }

                                if (pressed.size >= 2) {
                                    if (mode != 3) {
                                        mode = 3
                                        gestureActive = true
                                        gestureSeekPositionMs = null
                                    }
                                    zoomAmount *=
                                        event.calculateZoom()

                                    if (zoomAmount > 1.06f) {
                                        videoFit = PlayerVideoFit.ZOOM
                                        settingsStore.setPlayerVideoFit(
                                            PlayerVideoFit.ZOOM
                                        )
                                        gestureMessage = "Zoom"
                                    } else if (
                                        zoomAmount < .94f
                                    ) {
                                        videoFit = PlayerVideoFit.FIT
                                        settingsStore.setPlayerVideoFit(
                                            PlayerVideoFit.FIT
                                        )
                                        gestureMessage = "Fit"
                                    }

                                    event.changes.forEach {
                                        it.consume()
                                    }
                                } else if (
                                    pressed.size == 1 &&
                                    mode != 3
                                ) {
                                    val change = pressed.first()
                                    val movement =
                                        change.positionChange()
                                    totalX += movement.x
                                    totalY += movement.y

                                    if (
                                        mode == 0 &&
                                        (
                                            kotlin.math.abs(totalX) >
                                                viewConfiguration.touchSlop ||
                                                kotlin.math.abs(totalY) >
                                                viewConfiguration.touchSlop
                                        )
                                    ) {
                                        mode =
                                            if (
                                                kotlin.math.abs(totalX) >=
                                                kotlin.math.abs(totalY)
                                            ) {
                                                1
                                            } else {
                                                2
                                            }
                                        gestureActive = true
                                    }

                                    when (mode) {
                                        1 -> {
                                            val span =
                                                durationMs
                                                    .takeIf {
                                                        it > 0L
                                                    }
                                                    ?: 60L * 60L * 1000L
                                            val seekWindowMs =
                                                minOf(
                                                    span / 4L,
                                                    seekGestureSensitivity
                                                        .maxSeekMinutes *
                                                        60L * 1000L,
                                                )
                                            val preview =
                                                (startPosition +
                                                    (
                                                        seekWindowMs *
                                                            (totalX / size.width)
                                                    ).toLong())
                                                    .coerceIn(
                                                        0L,
                                                        durationMs
                                                            .takeIf {
                                                                it > 0L
                                                            }
                                                            ?: Long.MAX_VALUE,
                                                    )
                                            seekPreview = preview
                                            gestureSeekPositionMs = preview
                                            gestureMessage =
                                                formatPlaybackTime(preview) +
                                                    " / " +
                                                    formatPlaybackTime(
                                                        durationMs
                                                    )
                                            change.consume()
                                        }

                                        2 -> {
                                            val delta =
                                                -totalY / size.height
                                            if (
                                                startX < size.width / 2f
                                            ) {
                                                val brightness =
                                                    (startBrightness + delta)
                                                        .coerceIn(
                                                            .02f,
                                                            1f,
                                                        )
                                                activity?.window?.let {
                                                    window ->
                                                    val attributes =
                                                        window.attributes
                                                    attributes.screenBrightness =
                                                        brightness
                                                    window.attributes =
                                                        attributes
                                                }
                                                gestureMessage =
                                                    "Brightness " +
                                                        "${(brightness * 100).toInt()}%"
                                            } else {
                                                val maxVolume =
                                                    audioManager
                                                        .getStreamMaxVolume(
                                                            AudioManager.STREAM_MUSIC
                                                        )
                                                val volume =
                                                    (startVolume +
                                                        delta * maxVolume)
                                                        .toInt()
                                                        .coerceIn(
                                                            0,
                                                            maxVolume,
                                                        )
                                                audioManager
                                                    .setStreamVolume(
                                                        AudioManager.STREAM_MUSIC,
                                                        volume,
                                                        0,
                                                    )
                                                gestureMessage =
                                                    "Volume " +
                                                        "${(volume * 100 / maxVolume.coerceAtLeast(1))}%"
                                            }
                                            change.consume()
                                        }
                                    }
                                }

                                if (
                                    event.changes.none {
                                        it.pressed
                                    }
                                ) {
                                    break
                                }
                            }

                            if (mode == 1) {
                                seekPreview?.let {
                                    player.seekTo(it)
                                }
                            }
                                gestureSeekPositionMs = null
                                gestureActive = false
                            }
                        } finally {
                            gestureSeekPositionMs = null
                            gestureActive = false
                        }
                    }
                    .pointerInput(
                        player,
                        controlsLocked,
                        showNextEpisodeCard,
                        nextEpisodeCardSwitchTarget,
                    ) {
                        detectTapGestures(
                            onTap = {
                                if (
                                    showNextEpisodeCard &&
                                    nextEpisodeCardSwitchTarget == null
                                ) {
                                    nextEpisodeCountdown = null
                                    showNextEpisodeCard = false
                                    nextEpisodeCardDismissed = true
                                } else {
                                    controlsVisible =
                                        !controlsVisible
                                }
                            },
                            onDoubleTap = { offset ->
                                when {
                                    offset.x <
                                        size.width * .34f -> {
                                        player.seekTo(
                                            (player.currentPosition -
                                                10_000L)
                                                .coerceAtLeast(0L)
                                        )
                                        gestureMessage = "-10 sec"
                                    }

                                    offset.x >
                                        size.width * .66f -> {
                                        player.seekTo(
                                            player.currentPosition +
                                                10_000L
                                        )
                                        gestureMessage = "+10 sec"
                                    }

                                    else -> {
                                        if (player.isPlaying) {
                                            player.pause()
                                        } else {
                                            requestForegroundPlayback()
                                        }
                                    }
                                }
                                controlsVisible = true
                            },
                        )
                    },
            )
        }

        MobileBufferingIndicator(
            buffering =
                playbackPhase == PlayerPlaybackPhase.LOADING ||
                    playbackPhase == PlayerPlaybackPhase.BUFFERING,
            enabled =
                playbackError == null &&
                    !resumePromptVisible,
            modifier = Modifier.align(Alignment.Center),
        )

        if (
            showContentWarnings &&
            contentWarnings.isNotEmpty()
        ) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(
                        start = 32.dp,
                        top = 20.dp,
                    ),
            ) {
                PlayerContentWarningsOverlay(
                    warnings = contentWarnings,
                    onAnimationComplete = {
                        showContentWarnings = false
                    },
                )
            }
        }

        val activeSkipSegment =
            if (skipSegmentsEnabled && durationMs > 0L) {
                PlayerSkipPolicy.activeSegment(
                    skipSegments,
                    currentPositionMs,
                    durationMs,
                )?.takeUnless {
                    it.key == dismissedSkipSegmentKey
                }
            } else {
                null
            }

        if (!controlsLocked) {
            PlayerSkipControl(
                segment = activeSkipSegment,
                onSkip = {
                    activeSkipSegment?.let { segment ->
                        PlayerSkipPolicy.skipTargetMs(
                            segment,
                            durationMs,
                        )?.let { targetMs ->
                            dismissedSkipSegmentKey = segment.key
                            player.seekTo(targetMs)
                        }
                    }
                },
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = 32.dp, bottom = 118.dp),
            )
        }

        AnimatedVisibility(
            visible = controlsVisible && !controlsLocked,
            enter = vueoSoftEnter(
                durationMillis = 220,
                initialScale = 0.996f,
            ),
            exit = vueoSoftExit(
                durationMillis = 150,
                targetScale = 0.998f,
            ),
        ) {
            Box(Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                Color.Black.copy(
                                    alpha = .62f
                                ),
                                Color.Transparent,
                                Color.Black.copy(
                                    alpha = .70f
                                ),
                            )
                        )
                    ),
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .padding(
                        horizontal = 18.dp,
                        vertical = 14.dp,
                    ),
                verticalAlignment =
                    Alignment.CenterVertically,
            ) {
                if (showContentWarnings) {
                    Spacer(Modifier.weight(1f))
                } else {
                    Text(
                        episode?.let {
                            "S${it.season} E${it.episode} • ${it.title}"
                        } ?: title,
                        modifier = Modifier.weight(1f),
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                if (playbackPhase == PlayerPlaybackPhase.RECOVERING) {
                    Text(
                        "TRYING NEXT SOURCE",
                        color = VueoPalette.Accent,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                if (translatingSubtitleSelectionId != null) {
                    Spacer(Modifier.width(8.dp))
                    MobileTranslationStatusPill()
                }

                if (nextEpisode != null) {
                    PlayerTopAction(
                        icon = Icons.Default.SkipNext,
                        contentDescription = "Next episode",
                        enabled = !nextEpisodeSwitching,
                        onClick = {
                            startNextEpisode()
                        },
                    )

                    Spacer(Modifier.width(8.dp))
                }

                PlayerTopAction(
                    icon = Icons.Default.Lock,
                    contentDescription =
                        "Lock controls",
                    onClick = {
                        controlsLocked = true
                        controlsVisible = false
                    },
                )

                Spacer(Modifier.width(8.dp))

                PlayerTopAction(
                    icon = Icons.Default.MoreHoriz,
                    contentDescription = "More controls",
                    onClick = {
                        showMoreDialog = true
                    },
                )

                Spacer(Modifier.width(8.dp))

                PlayerTopAction(
                    icon = Icons.Default.ArrowBack,
                    contentDescription = "Back",
                    onClick = {
                        requestPlayerExit()
                    },
                )
            }

            Row(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(12.dp),
                horizontalArrangement =
                    Arrangement.spacedBy(24.dp),
                verticalAlignment =
                    Alignment.CenterVertically,
            ) {
                PlayerRoundAction(
                    icon = Icons.Default.Replay10,
                    contentDescription =
                        "Rewind 10 seconds",
                    onClick = {
                        player.seekTo(
                            (player.currentPosition -
                                10_000L)
                                .coerceAtLeast(0L)
                        )
                    },
                )
                PlayerRoundAction(
                    icon =
                        if (isPlaying) {
                            Icons.Default.Pause
                        } else {
                            Icons.Default.PlayArrow
                        },
                    contentDescription =
                        if (isPlaying) "Pause" else "Play",
                    primary = true,
                    onClick = {
                        if (player.isPlaying) {
                            player.pause()
                        } else {
                            requestForegroundPlayback()
                        }
                        controlsVisible = true
                    },
                )
                PlayerRoundAction(
                    icon = Icons.Default.Forward10,
                    contentDescription =
                        "Forward 10 seconds",
                    onClick = {
                        player.seekTo(
                            player.currentPosition +
                                10_000L
                        )
                    },
                )
            }

            val nextEpisodeCardEpisode =
                nextEpisodeCardSwitchTarget
                    ?: nextEpisode
            AnimatedVisibility(
                visible =
                    nextEpisodeCardEpisode != null &&
                        nextEpisodeCardVisible,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(
                        end = 24.dp,
                        bottom = 126.dp,
                    ),
                enter = vueoSoftEnter(
                    durationMillis = 240,
                    initialScale = 0.975f,
                ),
                exit = vueoSoftExit(
                    durationMillis = 150,
                    targetScale = 0.99f,
                ),
            ) {
                nextEpisodeCardEpisode?.let { cardEpisode ->
                PlayerNextEpisodeCard(
                    episode = cardEpisode,
                    countdownSeconds =
                        nextEpisodeCountdown,
                    switching =
                        nextEpisodeCardSwitchTarget != null &&
                            !episodeSwitchFailed,
                    failed =
                        nextEpisodeCardSwitchTarget != null &&
                            episodeSwitchFailed,
                    onPlay = {
                        if (
                            episodeSwitchFailed &&
                            nextEpisodeCardSwitchTarget != null
                        ) {
                            nextEpisodeSwitching = true
                            nextEpisodeCountdown = null
                            saveCurrentForEpisodeHandoff()
                            onEpisodeSelected(
                                cardEpisode
                            )
                        } else {
                            startNextEpisode()
                        }
                    },
                    modifier = Modifier,
                )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .padding(
                        horizontal = 24.dp,
                        vertical = 16.dp,
                ),
                verticalArrangement =
                    Arrangement.spacedBy(2.dp),
            ) {
                playbackError?.let { error ->
                    PlayerPlaybackErrorCard(
                        error = error,
                        canChooseSource =
                            playableSources.size > 1,
                        onRetry = {
                            sourceRecoverySession
                                .allowRetry(source)
                            failedSourceUrls =
                                sourceRecoverySession
                                    .failedSourceUrls()
                            playbackError = null
                            playbackPhase =
                                PlayerPlaybackPhase.LOADING
                            recoveryInProgress = false
                            hasRenderedFirstFrame = false
                            startupAudioMuted.value = true
                            player.volume = 0f
                            retryGeneration++
                            decoderRecovery.reset()
                            val retryPosition = player.currentPosition.coerceAtLeast(currentPositionMs).coerceAtLeast(0L)
                            player.stop()
                            player.seekTo(retryPosition)
                            player.prepare()
                            requestForegroundPlayback()
                        },
                        onChooseSource = {
                            switchingSourceUrl = null
                            showSourceDialog = true
                        },
                        modifier = Modifier.align(
                            Alignment.End
                        ),
                    )
                }

                val displayedPosition =
                    gestureSeekPositionMs
                        ?: currentPositionMs
                val progressFraction =
                    if (durationMs > 0L) {
                        (
                            displayedPosition.toFloat() /
                                durationMs.toFloat()
                        ).coerceIn(0f, 1f)
                    } else {
                        0f
                    }

                Slider(
                    value = displayedPosition
                        .toFloat()
                        .coerceIn(
                            0f,
                            durationMs
                                .coerceAtLeast(1L)
                                .toFloat(),
                        ),
                    onValueChange = { value ->
                        gestureSeekPositionMs =
                            value.toLong()
                    },
                    onValueChangeFinished = {
                        gestureSeekPositionMs
                            ?.let {
                                player.seekTo(it)
                            }
                        gestureSeekPositionMs = null
                    },
                    valueRange =
                        0f..durationMs
                            .coerceAtLeast(1L)
                            .toFloat(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(16.dp),
                    thumb = {
                        Box(
                            modifier = Modifier
                                .size(12.dp)
                                .background(
                                    VueoPlayerAccent,
                                    CircleShape,
                                )
                        )
                    },
                    track = {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(3.dp)
                                .clip(RoundedCornerShape(50))
                                .background(
                                    Color.White.copy(
                                        alpha = .30f
                                    )
                                )
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(
                                        progressFraction
                                    )
                                    .fillMaxHeight()
                                    .background(
                                        VueoPlayerAccent
                                    )
                            )
                        }
                    },
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment =
                        Alignment.CenterVertically,
                ) {
                    Text(
                        formatPlaybackTime(
                            displayedPosition
                        ),
                        color = Color.White,
                        fontSize = 11.sp,
                    )
                    Spacer(Modifier.weight(1f))
                    val remainingMs =
                        (durationMs - displayedPosition)
                            .coerceAtLeast(0L)
                    Text(
                        "-${formatPlaybackTime(remainingMs)}",
                        color = Color.White.copy(
                            alpha = .72f
                        ),
                        fontSize = 11.sp,
                    )
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .offset(y = (-6).dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        modifier = Modifier.border(
                            width = 1.dp,
                            color = Color.White.copy(
                                alpha = .16f
                            ),
                            shape = RoundedCornerShape(30.dp),
                        ),
                        shape = RoundedCornerShape(30.dp),
                        color = Color(
                            0xD9161719
                        ),
                    ) {
                        Row(
                            modifier = Modifier.padding(
                                horizontal = 6.dp,
                                vertical = 3.dp,
                            ),
                            horizontalArrangement =
                                Arrangement.Center,
                            verticalAlignment =
                                Alignment.CenterVertically,
                        ) {
                            PlayerPanelAction(
                                icon = Icons.Default.ClosedCaption,
                                label = "Subs",
                                onClick = {
                                    controlsVisible = false
                                    showSubtitleStyleOverlay = false
                                    showSubtitleDialog = true
                                },
                            )
                            PlayerPanelAction(
                                icon = Icons.Default.VolumeUp,
                                label = "Audio",
                                onClick = {
                                    showAudioDialog = true
                                },
                            )
                            PlayerPanelAction(
                                icon = Icons.Default.Dns,
                                label = "Sources",
                                enabled =
                                    playableSources.isNotEmpty(),
                                onClick = {
                                    switchingSourceUrl = null
                                    showSourceDialog = true
                                },
                            )
                            if (episodes.isNotEmpty()) {
                                PlayerPanelAction(
                                    icon = Icons.Default.VideoLibrary,
                                    label = "Episodes",
                                    onClick = {
                                        showEpisodeDialog = true
                                    },
                                )
                            }
                        }
                    }
                }
            }
            }
        }

        AnimatedVisibility(
            visible = controlsLocked,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(14.dp),
            enter = vueoSoftEnter(
                durationMillis = 200,
                initialScale = 0.97f,
            ),
            exit = vueoSoftExit(
                durationMillis = 140,
                targetScale = 0.985f,
            ),
        ) {
            Surface(
                modifier = Modifier.clickable {
                    controlsLocked = false
                    controlsVisible = true
                },
                shape = RoundedCornerShape(50),
                color = Color.Black.copy(
                    alpha = .62f
                ),
            ) {
                Text(
                    "Unlock",
                    modifier = Modifier.padding(
                        horizontal = 16.dp,
                        vertical = 10.dp,
                    ),
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        AnimatedContent(
            targetState = gestureMessage,
            transitionSpec = {
                vueoPlayerFadeThrough(
                    enterDurationMillis = 170,
                    exitDurationMillis = 120,
                    enterDelayMillis = 0,
                )
            },
            modifier = Modifier.align(Alignment.Center),
            label = "VUEO player gesture feedback",
        ) { message ->
            if (message != null) {
                Surface(
                    modifier = Modifier.padding(20.dp),
                    shape = RoundedCornerShape(16.dp),
                    color = Color.Black.copy(alpha = .74f),
                ) {
                    Text(
                        message,
                        modifier = Modifier.padding(
                            horizontal = 18.dp,
                            vertical = 12.dp,
                        ),
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

private suspend fun applyAndConfirmMobileSubtitleChoice(
    player: ExoPlayer,
    selectionId: String,
    externalSubtitles: () -> Map<String, SubtitleTrack>,
    stillRequested: () -> Boolean,
): Boolean {
    var attempt = 0
    while (
        attempt < SUBTITLE_SELECTION_CONFIRM_ATTEMPTS &&
        stillRequested()
    ) {
        val currentChoice = playerTrackChoices(
            tracks = LiveSmartSubs.mergedTracks(player),
            trackType = C.TRACK_TYPE_TEXT,
            externalSubtitles = externalSubtitles(),
        ).firstOrNull { it.selectionId == selectionId }

        if (currentChoice?.selected == true) return true

        if (
            currentChoice != null &&
            attempt in SUBTITLE_SELECTION_REAPPLY_ATTEMPTS
        ) {
            applyTrackChoice(
                player = player,
                trackType = C.TRACK_TYPE_TEXT,
                choice = currentChoice,
            )
        }

        delay(SUBTITLE_SELECTION_CONFIRM_INTERVAL_MS)
        attempt += 1
    }

    return playerTrackChoices(
        tracks = LiveSmartSubs.mergedTracks(player),
        trackType = C.TRACK_TYPE_TEXT,
        externalSubtitles = externalSubtitles(),
    ).any { it.selectionId == selectionId && it.selected }
}

private const val SUBTITLE_SELECTION_CONFIRM_ATTEMPTS = 60
private const val SUBTITLE_SELECTION_CONFIRM_INTERVAL_MS = 50L
private const val SUBTITLE_TRACK_ATTACH_WAIT_ATTEMPTS = 1_200
private val SUBTITLE_SELECTION_REAPPLY_ATTEMPTS = setOf(0, 6, 18, 36)
