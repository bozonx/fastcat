import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { sanitizeFps } from '~/utils/monitor-time';
import { syncMonitorAudioLevels } from './useMonitorPlayback.audioLevels';
import { syncMonitorTimecodeText } from './useMonitorPlayback.timecode';

import type { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { useTimelineStore } from '~/stores/timeline.store';

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
  } = options;

  const timelineStore = useTimelineStore();

  const STORE_TIME_SYNC_MS = 100;
  const AUDIO_LEVELS_SYNC_MS = 120; // Avoid excessive store churn (can stress DevTools)
  const PLAYBACK_SEEK_EPSILON_US = 25_000;
  const SCRUB_PREVIEW_MIN_DELTA_US = 1_000;
  const SCRUB_PREVIEW_MAX_DELTA_US = 250_000;
  const SCRUB_PREVIEW_THROTTLE_MS = 35;
  const SCRUB_PREVIEW_DURATION_US = 75_000;

  let playbackLoopId = 0;
  let lastFrameTimeMs = 0;
  let lastScrubPreviewAtMs = 0;
  let localCurrentTimeUs = 0;
  const uiCurrentTimeUs = ref(0);
  let renderAccumulatorMs = 0;
  let storeSyncAccumulatorMs = 0;
  let audioLevelsAccumulatorMs = 0;
  let isUnmounted = false;
  let suppressStoreSeekWatch = false;
  let timecodeEl: HTMLElement | null = null;
  let visibilityHandler: (() => void) | null = null;

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
    if (isUnmounted || isPlaying.value || isLoading.value || loadError.value) {
      return false;
    }

    const deltaUs = toUs - fromUs;
    if (deltaUs < SCRUB_PREVIEW_MIN_DELTA_US || deltaUs > SCRUB_PREVIEW_MAX_DELTA_US) {
      return false;
    }

    const now = performance.now();
    if (now - lastScrubPreviewAtMs < SCRUB_PREVIEW_THROTTLE_MS) {
      return false;
    }

    lastScrubPreviewAtMs = now;
    return true;
  }

  function updatePlayback(timestamp: number) {
    if (!isPlaying.value) return;
    if (isUnmounted) return;

    const deltaMsRaw = timestamp - lastFrameTimeMs;
    const deltaMs = Number.isFinite(deltaMsRaw) && deltaMsRaw > 0 ? deltaMsRaw : 0;
    lastFrameTimeMs = timestamp;
    renderAccumulatorMs += deltaMs;
    storeSyncAccumulatorMs += deltaMs;
    audioLevelsAccumulatorMs += deltaMs;

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

    if (storeSyncAccumulatorMs >= STORE_TIME_SYNC_MS) {
      storeSyncAccumulatorMs = 0;
      uiCurrentTimeUs.value = newTimeUs;
      updateStoreTime(newTimeUs);
    }

    if (audioLevelsAccumulatorMs >= AUDIO_LEVELS_SYNC_MS) {
      audioLevelsAccumulatorMs = 0;
      updateAudioLevels();
    }

    const fps = sanitizeFps(getFps());
    const frameIntervalMs = 1000 / fps;

    if (renderAccumulatorMs >= frameIntervalMs) {
      renderAccumulatorMs %= frameIntervalMs;
      scheduleRender(newTimeUs);
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
        renderAccumulatorMs = 0;
        storeSyncAccumulatorMs = 0;
        audioLevelsAccumulatorMs = 0;

        audioEngine.play(localCurrentTimeUs, timelineStore.playbackSpeed);

        playbackLoopId = requestAnimationFrame((ts) => {
          lastFrameTimeMs = ts;
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
          if (canPlayScrubPreview(previousTimeUs, normalizedTimeUs)) {
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
      if (document.hidden) {
        if (isPlaying.value) {
          isPlaying.value = false;
        }
        return;
      }

      // On visibility restore, re-sync UI time and render current frame.
      if (isPlaying.value) {
        const timeUs = clampToTimeline(audioEngine.getCurrentTimeUs());
        localCurrentTimeUs = timeUs;
        uiCurrentTimeUs.value = timeUs;
        updateTimecodeUi(timeUs);
        scheduleRender(timeUs);
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
