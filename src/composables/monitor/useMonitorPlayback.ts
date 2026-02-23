import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { normalizeTimeUs, sanitizeFps } from '~/utils/monitor-time';

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
  } = options;

  const STORE_TIME_SYNC_MS = 100;

  let playbackLoopId = 0;
  let lastFrameTimeMs = 0;
  let localCurrentTimeUs = 0;
  const uiCurrentTimeUs = ref(0);
  let renderAccumulatorMs = 0;
  let storeSyncAccumulatorMs = 0;
  let isUnmounted = false;
  let suppressStoreSeekWatch = false;
  let timecodeEl: HTMLElement | null = null;

  function getLocalCurrentTimeUs() {
    return localCurrentTimeUs;
  }

  function setTimecodeEl(el: HTMLElement | null) {
    timecodeEl = el;
    updateTimecodeUi(localCurrentTimeUs);
  }

  function formatTime(seconds: number): string {
    if (isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateTimecodeUi(timeUs: number) {
    const el = timecodeEl;
    if (!el) return;
    const current = formatTime(timeUs / 1e6);
    const total = formatTime(normalizeTimeUs(duration.value) / 1e6);
    const nextText = `${current} / ${total}`;
    if (el.textContent !== nextText) {
      el.textContent = nextText;
    }
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

  function updatePlayback(timestamp: number) {
    if (!isPlaying.value) return;
    if (isUnmounted) return;

    const deltaMsRaw = timestamp - lastFrameTimeMs;
    const deltaMs = Number.isFinite(deltaMsRaw) && deltaMsRaw > 0 ? deltaMsRaw : 0;
    lastFrameTimeMs = timestamp;
    renderAccumulatorMs += deltaMs;
    storeSyncAccumulatorMs += deltaMs;

    let newTimeUs = clampToTimeline(localCurrentTimeUs + deltaMs * 1000);

    if (newTimeUs >= safeDurationUs.value) {
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

  watch(
    () => isPlaying.value,
    (playing) => {
      if (isLoading.value || loadError.value) {
        if (playing) isPlaying.value = false;
        return;
      }

      if (playing) {
        if (localCurrentTimeUs >= safeDurationUs.value) {
          localCurrentTimeUs = 0;
          uiCurrentTimeUs.value = 0;
          updateTimecodeUi(0);
          internalUpdateStoreTime(0);
        }

        setLocalTimeFromStore();
        renderAccumulatorMs = 0;
        storeSyncAccumulatorMs = 0;

        playbackLoopId = requestAnimationFrame((ts) => {
          lastFrameTimeMs = ts;
          updatePlayback(ts);
        });
      } else {
        cancelAnimationFrame(playbackLoopId);
        uiCurrentTimeUs.value = clampToTimeline(localCurrentTimeUs);
        updateTimecodeUi(uiCurrentTimeUs.value);
        internalUpdateStoreTime(uiCurrentTimeUs.value);
      }
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
        localCurrentTimeUs = normalizedTimeUs;
        uiCurrentTimeUs.value = normalizedTimeUs;
        updateTimecodeUi(normalizedTimeUs);
        scheduleRender(normalizedTimeUs);
      }
    },
  );

  onMounted(() => {
    isUnmounted = false;
    setLocalTimeFromStore();
  });

  onBeforeUnmount(() => {
    isUnmounted = true;
    cancelAnimationFrame(playbackLoopId);
    timecodeEl = null;
  });

  return {
    uiCurrentTimeUs,
    getLocalCurrentTimeUs,
    setTimecodeEl,
    setLocalTimeFromStore,
  };
}
