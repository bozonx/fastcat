import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { sanitizeFps } from '~/utils/monitor-time';
import { syncMonitorAudioLevels } from './useMonitorPlayback.audioLevels';
import {
  advanceMonitorPlaybackLoop,
  resetMonitorPlaybackLoopState,
} from './useMonitorPlayback.loop';
import { canPlayMonitorScrubPreview } from './useMonitorPlayback.scrub';
import { syncMonitorTimecodeText } from './useMonitorPlayback.timecode';
import { syncMonitorPlaybackVisibility } from './useMonitorPlayback.visibility';

import type { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

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
  scheduleRender: (timeUs: number) => void;
  audioEngine: AudioEngine;
  isMobile: boolean;
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
    audioEngine,
    isMobile,
  } = options;

  const { t } = useI18n();
  const toast = useToast();
  const timelineStore = useTimelineStore();
  const workspaceStore = useWorkspaceStore();

  const STORE_TIME_SYNC_MS = 100;
  const AUDIO_LEVELS_SYNC_MS = 120; // Avoid excessive store churn (can stress DevTools)
  const PLAYBACK_SEEK_EPSILON_US = 25_000;
  const SCRUB_PREVIEW_MIN_DELTA_US = 1_000;
  const SCRUB_PREVIEW_MAX_DELTA_US = 250_000;
  const SCRUB_PREVIEW_THROTTLE_MS = 35;
  const SCRUB_PREVIEW_DURATION_US = 75_000;

  let playbackLoopId = 0;
  const playbackLoopState = {
    lastFrameTimeMs: 0,
    renderAccumulatorMs: 0,
    storeSyncAccumulatorMs: 0,
    audioLevelsAccumulatorMs: 0,
  };
  const scrubPreviewState = {
    lastScrubPreviewAtMs: 0,
  };
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

    const fps = sanitizeFps(getFps());
    const frameIntervalMs = 1000 / fps;

    if (playbackLoopState.renderAccumulatorMs >= frameIntervalMs) {
      playbackLoopState.renderAccumulatorMs %= frameIntervalMs;
      // Only schedule render if document is visible to save resources in background (Desktop)
      if (!document.hidden) {
        scheduleRender(newTimeUs);
      }
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
        if (safeDurationUs.value > 0 && localCurrentTimeUs >= safeDurationUs.value) {
          localCurrentTimeUs = 0;
          uiCurrentTimeUs.value = 0;
          updateTimecodeUi(0);
          internalUpdateStoreTime(0);
        }

        setLocalTimeFromStore();
        resetMonitorPlaybackLoopState(playbackLoopState);

        audioEngine.play(localCurrentTimeUs, timelineStore.playbackSpeed);

        playbackLoopId = requestAnimationFrame((ts) => {
          playbackLoopState.lastFrameTimeMs = ts;
          updatePlayback(ts);
        });
      } else {
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

        if (normalizedTimeUs > previousTimeUs) {
          if (
            workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled &&
            canPlayScrubPreview(previousTimeUs, normalizedTimeUs)
          ) {
            void audioEngine.previewScrubForward(
              previousTimeUs,
              normalizedTimeUs,
              SCRUB_PREVIEW_DURATION_US,
            );
          }
        } else {
          audioEngine.stopScrubPreview();
        }

        scheduleRender(normalizedTimeUs);
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

  onMounted(() => {
    isUnmounted = false;
    setLocalTimeFromStore();

    visibilityHandler = () => {
      const wasHidden = document.hidden;

      syncMonitorPlaybackVisibility({
        isPlaying: isPlaying.value,
        isMobile,
        clampToTimeline,
        audioEngine,
        onPauseHiddenPlayback: () => {
          isPlaying.value = false;
        },
        onRestoreVisiblePlayback: (timeUs) => {
          if (!isMobile && hiddenAtMs > 0 && isPlaying.value) {
            const elapsedMs = performance.now() - hiddenAtMs;
            const audioDeltaUs = timeUs - hiddenAtAudioUs;
            const audioDeltaMs = audioDeltaUs / 1000;

            // If audio delta is significantly less than real elapsed time, browser throttled us.
            // Check for at least 300ms gap to avoid false positives on short task switches.
            if (elapsedMs > 500 && audioDeltaMs < elapsedMs * 0.7) {
              toast.add({
                color: 'warning',
                title: t('fastcat.monitor.playbackThrottled'),
                description: t(
                  'fastcat.monitor.playbackThrottledDetail',
                  'The browser slowed down background playback. Return to this tab for smooth editing.',
                ),
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

      if (document.hidden && !isMobile && isPlaying.value) {
        hiddenAtMs = performance.now();
        hiddenAtAudioUs = audioEngine.getCurrentTimeUs();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  });

  onBeforeUnmount(() => {
    isUnmounted = true;
    audioEngine.stopScrubPreview();
    cancelAnimationFrame(playbackLoopId);
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
