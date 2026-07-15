import { TICKS_PER_SECOND, formatTimecode, normalizeTicks, sanitizeFps } from '~/utils/time';
import { createDevLogger } from '~/utils/dev-logger';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { isTauriRuntime } from '~/utils/runtime';

import type { IAudioEngine } from '~/utils/video-editor/AudioEngine';
import type { MonitorRenderScheduleOptions } from './useMonitorCore.compositor';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
const log = createDevLogger('useMonitorPlayback');

export type MonitorSyncMode = 'smooth' | 'balanced' | 'strict';

interface MonitorPlaybackLoopState {
  lastFrameTimeMs: number;
  lastRenderedFrameIndex: number;
  storeSyncAccumulatorMs: number;
  audioLevelsAccumulatorMs: number;
}

interface MonitorScrubPreviewState {
  lastScrubPreviewAtMs: number;
}

function resetMonitorPlaybackLoopState(state: MonitorPlaybackLoopState) {
  state.lastFrameTimeMs = 0;
  state.lastRenderedFrameIndex = -1;
  state.storeSyncAccumulatorMs = 0;
  state.audioLevelsAccumulatorMs = 0;
}

function advanceMonitorPlaybackLoop(params: {
  timestamp: number;
  state: MonitorPlaybackLoopState;
}) {
  const deltaMsRaw = params.timestamp - params.state.lastFrameTimeMs;
  const deltaMs = Number.isFinite(deltaMsRaw) && deltaMsRaw > 0 ? deltaMsRaw : 0;

  params.state.lastFrameTimeMs = params.timestamp;
  params.state.storeSyncAccumulatorMs += deltaMs;
  params.state.audioLevelsAccumulatorMs += deltaMs;
}

// Map a timeline time to the composition source-frame index displayed at it.
// Playback presents at the composition frame rate, so rendering exactly once per
// change of this index keeps the on-screen cadence phase-locked to the audio
// master clock and drift-free. This replaces the old accumulator gate (fire when
// >= one frame interval accumulated): that gate was sampled on the 60Hz rAF grid,
// so its firing beat against the frame interval and — because 'balanced'/'smooth'
// clamped/reset the carryover — its phase drifted frame to frame, which is exactly
// the judder we saw versus the native monitor. Mirrors the worker-side
// `computeFrameIndex` floor+epsilon so the main thread and the compositor agree on
// where a frame boundary falls.
export function computeMonitorFrameIndex(params: { timeUs: number; fps: number }): number {
  const fps = Number.isFinite(params.fps) && params.fps > 0 ? params.fps : 30;
  const timeS = Number.isFinite(params.timeUs) ? Math.max(0, params.timeUs / TICKS_PER_SECOND) : 0;
  return Math.max(0, Math.floor(timeS * fps + 1e-6));
}

function canPlayMonitorScrubPreview(params: {
  fromUs: number;
  toUs: number;
  state: MonitorScrubPreviewState;
  isUnmounted: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  hasLoadError: boolean;
  minDeltaUs: number;
  maxDeltaUs: number;
  throttleMs: number;
  nowMs?: number;
}): boolean {
  if (params.isUnmounted || params.isPlaying || params.isLoading || params.hasLoadError) {
    return false;
  }

  const deltaUs = params.toUs - params.fromUs;
  if (deltaUs < params.minDeltaUs || deltaUs > params.maxDeltaUs) {
    return false;
  }

  const now = params.nowMs ?? performance.now();
  if (now - params.state.lastScrubPreviewAtMs < params.throttleMs) {
    return false;
  }

  params.state.lastScrubPreviewAtMs = now;
  return true;
}

function approxEqual(a: number, b: number) {
  return Math.abs(a - b) <= 0.2;
}

function syncMonitorAudioLevels(params: {
  timelineStore: ReturnType<typeof useTimelineStore>;
  audioEngine: IAudioEngine;
}) {
  const prevLevels = params.timelineStore.audioLevels;
  const nextLevels = { ...prevLevels };
  const masterLevels = params.audioEngine.getLevels();
  nextLevels.master = masterLevels;

  const tracks = params.timelineStore.timelineDoc?.tracks ?? [];
  for (const track of tracks) {
    if (track.kind === 'audio' || track.kind === 'video') {
      nextLevels[track.id] = params.audioEngine.getLevels(track.id);
    }
  }

  let changed = false;
  for (const [id, levels] of Object.entries(nextLevels)) {
    const prev = prevLevels[id];
    if (!prev) {
      changed = true;
      break;
    }

    if (!approxEqual(prev.rmsDb, levels.rmsDb) || !approxEqual(prev.peakDb, levels.peakDb)) {
      changed = true;
      break;
    }
  }

  if (!changed && Object.keys(prevLevels).length === Object.keys(nextLevels).length) {
    return;
  }

  params.timelineStore.audioLevels = nextLevels;
}

function syncMonitorPlaybackVisibility(params: {
  isPlaying: boolean;
  isMobile: { readonly value: boolean };
  clampToTimeline: (timeUs: number) => number;
  audioEngine: IAudioEngine;
  onPauseHiddenPlayback: () => void;
  onRestoreVisiblePlayback: (timeUs: number) => void;
}) {
  if (document.hidden) {
    if (params.isMobile.value && params.isPlaying) {
      params.onPauseHiddenPlayback();
    }
    return;
  }

  if (!params.isPlaying) {
    return;
  }

  const timeUs = params.clampToTimeline(params.audioEngine.getCurrentTimeUs());
  params.onRestoreVisiblePlayback(timeUs);
}

export function formatMonitorTimecode(params: { timeUs: number; fps: number }): string {
  if (!Number.isFinite(params.timeUs) || params.timeUs <= 0) {
    return '00:00:00:00';
  }

  return formatTimecode(params.timeUs, params.fps);
}

export function buildMonitorTimecodeText(params: {
  currentTimeUs: number;
  durationUs: number;
  fps: number;
}): string {
  const current = formatMonitorTimecode({
    timeUs: params.currentTimeUs,
    fps: params.fps,
  });
  const total = formatMonitorTimecode({
    timeUs: normalizeTicks(params.durationUs),
    fps: params.fps,
  });

  return `${current} / ${total}`;
}

function syncMonitorTimecodeText(params: {
  element: HTMLElement | null;
  currentTimeUs: number;
  durationUs: number;
  fps: number;
}) {
  if (!params.element) {
    return;
  }

  const nextText = buildMonitorTimecodeText({
    currentTimeUs: params.currentTimeUs,
    durationUs: params.durationUs,
    fps: params.fps,
  });

  if (params.element.textContent !== nextText) {
    params.element.textContent = nextText;
  }
}

export interface UseMonitorPlaybackOptions {
  isLoading: { value: boolean };
  loadError: { value: string | null };
  isPlaying: { value: boolean };
  currentTime: { value: number };
  duration: { value: number };
  safeDurationUs: { value: number };
  getFps: () => number;
  clampToTimeline: (timeUs: number) => number;
  updateStoreTime: (timeUs: number) => void;
  scheduleRender: (timeUs: number, options?: MonitorRenderScheduleOptions) => void;
  /**
   * Opens the preview-quality settle window (see `useMonitorCore.ts`): marks the paused
   * frame as interactive so it renders at the user-selected quality instead of jumping
   * straight to `ultra`, then upgrades to `ultra` once idle settles. Optional so callers
   * without this concept (tests, alternate hosts) don't have to stub it.
   */
  beginInteractiveWindow?: () => boolean;
  audioEngine: IAudioEngine;
  isMobile: { value: boolean };
}

export function useMonitorPlayback(options: UseMonitorPlaybackOptions) {
  const {
    isLoading,
    loadError,
    isPlaying,
    currentTime,
    duration,
    safeDurationUs,
    getFps,
    clampToTimeline,
    updateStoreTime,
    scheduleRender,
    beginInteractiveWindow,
    audioEngine,
    isMobile,
  } = options;

  const { t } = useI18n();
  const toast = useToast();
  const timelineStore = useTimelineStore();
  const workspaceStore = useWorkspaceStore();

  // In Tauri the native monitor is the sole playback master clock (drives audio,
  // video and time via `monitor:time`). Running this frontend RAF loop in addition
  // would spin a second wall-clock and write `currentTime` every tick, which the
  // native bridge then echoes back as `monitor_seek` ~4-5×/s — thrashing the audio
  // ring and video decoders down to ~9fps. So here we never drive playback; we only
  // mirror the native clock into the timecode/UI. See [[monitor-playback-seek-thrash]].
  const isNativeMonitor = isTauriRuntime();

  const STORE_TIME_SYNC_MS = 100;
  const AUDIO_LEVELS_SYNC_MS = 120; // Avoid excessive store churn (can stress DevTools)
  const PLAYBACK_SEEK_EPSILON_US = TICKS_PER_SECOND / 40;
  const SCRUB_PREVIEW_MIN_DELTA_US = 1_000;
  const SCRUB_PREVIEW_MAX_DELTA_US = 250_000;
  const SCRUB_PREVIEW_THROTTLE_MS = 35;
  const SCRUB_PREVIEW_DURATION_US = (TICKS_PER_SECOND * 3) / 40;

  let playbackLoopId = 0;
  const playbackLoopState = {
    lastFrameTimeMs: 0,
    lastRenderedFrameIndex: -1,
    storeSyncAccumulatorMs: 0,
    audioLevelsAccumulatorMs: 0,
  };
  const scrubPreviewState = {
    lastScrubPreviewAtMs: 0,
  };
  let scrubPreviewRequestId = 0;
  let localCurrentTimeUs = 0;
  const uiCurrentTimeUs = ref(0);
  let isUnmounted = false;
  let suppressStoreSeekWatch = false;
  let timecodeEl: HTMLElement | null = null;
  let visibilityHandler: (() => void) | null = null;

  // Track hidden/visible stats to detect browser throttling
  let hiddenAtMs = 0;
  let hiddenAtAudioUs = 0;

  function getLocalCurrentTimeUs() {
    return localCurrentTimeUs;
  }

  function setTimecodeEl(el: HTMLElement | null) {
    timecodeEl = el;
    updateTimecodeUi(localCurrentTimeUs);
  }

  function updateTimecodeUi(timeUs: number) {
    syncMonitorTimecodeText({
      element: timecodeEl,
      currentTimeUs: timeUs,
      durationUs: duration.value,
      fps: sanitizeFps(getFps()),
    });
  }

  function internalUpdateStoreTime(timeUs: number) {
    suppressStoreSeekWatch = true;
    updateStoreTime(timeUs);
    suppressStoreSeekWatch = false;
  }

  function setLocalTimeFromStore() {
    localCurrentTimeUs = clampToTimeline(currentTime.value);
    uiCurrentTimeUs.value = localCurrentTimeUs;
    updateTimecodeUi(localCurrentTimeUs);
  }

  // After a paused seek settles, fire one prewarm-flagged render so the
  // decode-ahead stream re-anchors at the new position and pressing play starts
  // from warm frames instead of a cold-decode stutter. Debounced so an active
  // scrub doesn't queue 16-frame decode bursts ahead of its own renders (the
  // prewarm op shares the compositor's exclusive queue); mirrors the native
  // monitor's idle-settle pattern. The re-render itself is free — the worker
  // early-exits on an unchanged time.
  const PAUSED_PREWARM_SETTLE_MS = 300;
  let pausedPrewarmTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelPausedPrewarm() {
    if (pausedPrewarmTimer !== null) {
      clearTimeout(pausedPrewarmTimer);
      pausedPrewarmTimer = null;
    }
  }

  function schedulePausedPrewarm(timeUs: number) {
    cancelPausedPrewarm();
    pausedPrewarmTimer = setTimeout(() => {
      pausedPrewarmTimer = null;
      if (isUnmounted || isPlaying.value) return;
      scheduleRender(timeUs, { prewarm: true });
    }, PAUSED_PREWARM_SETTLE_MS);
  }

  function canPlayScrubPreview(fromUs: number, toUs: number) {
    return canPlayMonitorScrubPreview({
      fromUs,
      toUs,
      state: scrubPreviewState,
      isUnmounted,
      isPlaying: isPlaying.value,
      isLoading: isLoading.value,
      hasLoadError: Boolean(loadError.value),
      minDeltaUs: SCRUB_PREVIEW_MIN_DELTA_US,
      maxDeltaUs: SCRUB_PREVIEW_MAX_DELTA_US,
      throttleMs: SCRUB_PREVIEW_THROTTLE_MS,
    });
  }

  function updatePlayback(timestamp: number) {
    if (!isPlaying.value) return;
    if (isUnmounted) return;

    advanceMonitorPlaybackLoop({
      timestamp,
      state: playbackLoopState,
    });

    let newTimeUs = clampToTimeline(audioEngine.getCurrentTimeUs());

    if (newTimeUs <= 0 && timelineStore.playbackSpeed < 0) {
      newTimeUs = 0;
      isPlaying.value = false;
      localCurrentTimeUs = newTimeUs;
      uiCurrentTimeUs.value = newTimeUs;
      updateTimecodeUi(newTimeUs);
      updateStoreTime(newTimeUs);
      scheduleRender(newTimeUs);
      return;
    }

    if (safeDurationUs.value > 0 && newTimeUs >= safeDurationUs.value) {
      newTimeUs = safeDurationUs.value;
      isPlaying.value = false;
      localCurrentTimeUs = newTimeUs;
      uiCurrentTimeUs.value = newTimeUs;
      updateTimecodeUi(newTimeUs);
      updateStoreTime(newTimeUs);
      scheduleRender(newTimeUs);
      return;
    }

    localCurrentTimeUs = newTimeUs;

    // Avoid component rerenders on each RAF tick.
    updateTimecodeUi(newTimeUs);

    if (playbackLoopState.storeSyncAccumulatorMs >= STORE_TIME_SYNC_MS) {
      playbackLoopState.storeSyncAccumulatorMs = 0;
      uiCurrentTimeUs.value = newTimeUs;
      updateStoreTime(newTimeUs);
    }

    if (playbackLoopState.audioLevelsAccumulatorMs >= AUDIO_LEVELS_SYNC_MS) {
      playbackLoopState.audioLevelsAccumulatorMs = 0;
      updateAudioLevels();
    }

    // Render exactly once per composition-frame boundary, phase-locked to the audio
    // master clock. Gating on the frame index (rather than an accumulated time
    // budget) keeps the on-screen cadence drift-free and removes the beat against
    // the 60Hz rAF grid that made web playback judder. When a render overruns real
    // time the target index simply jumps past the last presented one, so slow
    // frames are dropped to stay in sync instead of piling up. Only schedule while
    // the document is visible to save resources in the background (Desktop).
    const fps = sanitizeFps(getFps());
    const targetFrameIndex = computeMonitorFrameIndex({ timeUs: newTimeUs, fps });
    if (targetFrameIndex !== playbackLoopState.lastRenderedFrameIndex && !document.hidden) {
      playbackLoopState.lastRenderedFrameIndex = targetFrameIndex;
      scheduleRender(newTimeUs, { prewarm: true });
    }

    if (isPlaying.value) {
      playbackLoopId = requestAnimationFrame(updatePlayback);
    }
  }

  function updateAudioLevels() {
    if (!isPlaying.value || isUnmounted) return;

    syncMonitorAudioLevels({
      timelineStore,
      audioEngine,
    });
  }

  watch(
    () => isPlaying.value,
    (playing) => {
      if (isLoading.value || loadError.value) {
        if (playing) isPlaying.value = false;
        return;
      }

      if (playing) {
        // The playback loop prewarms on its own cadence.
        cancelPausedPrewarm();
        if (safeDurationUs.value > 0 && localCurrentTimeUs >= safeDurationUs.value) {
          localCurrentTimeUs = 0;
          uiCurrentTimeUs.value = 0;
          updateTimecodeUi(0);
          internalUpdateStoreTime(0);
        }

        setLocalTimeFromStore();
        resetMonitorPlaybackLoopState(playbackLoopState);

        // Await the engine so the first chunk(s) under the playhead are
        // decoded and the first source nodes are armed at the kickoff time
        // before we let the render loop start ticking — this keeps audio and
        // video aligned from the very first frame.
        void audioEngine
          .play(localCurrentTimeUs, timelineStore.playbackSpeed)
          .then(() => {
            if (isUnmounted || !isPlaying.value) return;
            // Native monitor owns the clock: don't run the frontend RAF loop (it would
            // write `currentTime` each tick and get echoed back as seeks). The timecode
            // UI is mirrored from `monitor:time` in the currentTime watcher below.
            if (isNativeMonitor) return;
            playbackLoopId = requestAnimationFrame((ts) => {
              playbackLoopState.lastFrameTimeMs = ts;
              updatePlayback(ts);
            });
          })
          .catch((error) => {
            if (!isUnmounted) {
              log.error('audioEngine.play() failed:', error);
            }
          });
      } else {
        // Stopping playback is an interactive moment: show the frame at the user-selected
        // quality first, upgrade to ultra once the settle window elapses (see
        // useMonitorCore.ts's beginInteractiveWindow).
        beginInteractiveWindow?.();
        audioEngine.stopScrubPreview();
        audioEngine.stop();
        cancelAnimationFrame(playbackLoopId);
        uiCurrentTimeUs.value = clampToTimeline(localCurrentTimeUs);
        updateTimecodeUi(uiCurrentTimeUs.value);
        internalUpdateStoreTime(uiCurrentTimeUs.value);
      }
    },
  );

  watch(
    () => timelineStore.playbackSpeed,
    (speed) => {
      if (!isPlaying.value) return;
      audioEngine.setGlobalSpeed(speed);
    },
  );

  watch(
    () => currentTime.value,
    (val) => {
      if (suppressStoreSeekWatch) {
        return;
      }

      // Consume the one-shot programmatic-seek marker regardless of branch below, so
      // it can never leak into a later user scrub. A programmatic playhead move
      // (project open, tab switch, marker nav) must not trigger the audible audio
      // scrub-preview, which is meant only for a user dragging the playhead.
      const isProgrammaticSeek = timelineStore.consumeProgrammaticSeek();

      const normalizedTimeUs = clampToTimeline(val);
      if (normalizedTimeUs !== val) {
        internalUpdateStoreTime(normalizedTimeUs);
        return;
      }
      if (!isPlaying.value) {
        const previousTimeUs = localCurrentTimeUs;
        localCurrentTimeUs = normalizedTimeUs;
        uiCurrentTimeUs.value = normalizedTimeUs;
        updateTimecodeUi(normalizedTimeUs);

        if (normalizedTimeUs > previousTimeUs && !isProgrammaticSeek) {
          if (
            workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled &&
            canPlayScrubPreview(previousTimeUs, normalizedTimeUs)
          ) {
            const requestId = ++scrubPreviewRequestId;
            audioEngine.stopScrubPreview();
            void audioEngine
              .previewScrubForward(previousTimeUs, normalizedTimeUs, SCRUB_PREVIEW_DURATION_US)
              .catch((error) => {
                if (requestId !== scrubPreviewRequestId || isUnmounted) return;
                log.warn('[Monitor] Failed to preview audio scrub', error);
              });
          }
        } else {
          scrubPreviewRequestId += 1;
          audioEngine.stopScrubPreview();
        }

        // Scrubbing is interactive: render at the user-selected quality now, upgrade to
        // ultra once the settle window elapses (see useMonitorCore.ts's beginInteractiveWindow).
        beginInteractiveWindow?.();
        scheduleRender(normalizedTimeUs);
        schedulePausedPrewarm(normalizedTimeUs);
      } else if (isNativeMonitor) {
        // Native monitor is the master clock: `currentTime` advances from
        // `monitor:time` (the bridge). Mirror it into the timecode/UI without
        // echoing a seek — the native bridge owns transport, and user scrubs
        // during playback already seek the native engine through it.
        localCurrentTimeUs = normalizedTimeUs;
        uiCurrentTimeUs.value = normalizedTimeUs;
        updateTimecodeUi(normalizedTimeUs);
      } else {
        // Ignore tiny store updates produced by the local playback loop itself.
        // Only external timeline jumps should trigger an actual seek.
        if (Math.abs(normalizedTimeUs - localCurrentTimeUs) <= PLAYBACK_SEEK_EPSILON_US) {
          return;
        }
        localCurrentTimeUs = normalizedTimeUs;
        audioEngine.seek(normalizedTimeUs);
      }
    },
  );

  watch(
    () => safeDurationUs.value,
    (newDuration) => {
      if (newDuration > 0 && !isPlaying.value) {
        setLocalTimeFromStore();
        scheduleRender(localCurrentTimeUs);
      }
    },
  );

  onMounted(() => {
    isUnmounted = false;
    setLocalTimeFromStore();

    visibilityHandler = () => {
      syncMonitorPlaybackVisibility({
        isPlaying: isPlaying.value,
        isMobile,
        clampToTimeline,
        audioEngine,
        onPauseHiddenPlayback: () => {
          isPlaying.value = false;
        },
        onRestoreVisiblePlayback: (timeUs) => {
          if (!isMobile.value && hiddenAtMs > 0 && isPlaying.value) {
            const elapsedMs = performance.now() - hiddenAtMs;
            const audioDeltaUs = timeUs - hiddenAtAudioUs;
            const audioDeltaMs = audioDeltaUs / 1000;

            // If audio delta is significantly less than real elapsed time, browser throttled us.
            // Check for at least 300ms gap to avoid false positives on short task switches.
            if (elapsedMs > 500 && audioDeltaMs < elapsedMs * 0.7) {
              toast.add({
                color: 'warning',
                title: t('fastcat.monitor.playbackThrottled'),
                description: t('fastcat.monitor.playbackThrottledDetail'),
              });
            }
          }

          hiddenAtMs = 0;
          hiddenAtAudioUs = 0;

          localCurrentTimeUs = timeUs;
          uiCurrentTimeUs.value = timeUs;
          updateTimecodeUi(timeUs);

          // Force a render command immediately upon returning to the tab
          scheduleRender(timeUs);
        },
      });

      if (document.hidden && !isMobile.value && isPlaying.value) {
        hiddenAtMs = performance.now();
        hiddenAtAudioUs = audioEngine.getCurrentTimeUs();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  });

  onBeforeUnmount(() => {
    isUnmounted = true;
    scrubPreviewRequestId += 1;
    audioEngine.stopScrubPreview();
    cancelAnimationFrame(playbackLoopId);
    cancelPausedPrewarm();
    timecodeEl = null;

    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  });

  return {
    uiCurrentTimeUs,
    getLocalCurrentTimeUs,
    setTimecodeEl,
    setLocalTimeFromStore,
  };
}
