import { ref, watch, onUnmounted, type Ref } from 'vue';
import { useUiStore } from '~/stores/ui.store';

export function useMediaPlayerPlayback(
  mediaElement: Ref<HTMLVideoElement | HTMLAudioElement | null>,
  props: { src: string; isModal?: boolean; focusPanelId?: string },
  volume: Ref<number>,
  isMuted: Ref<boolean>,
  focusStore: any,
) {
  const uiStore = useUiStore();
  const isPlaying = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const progress = ref(0);
  const playbackSpeed = ref(1);

  let reversePlaybackRaf: number | null = null;
  let reverseLastTs = 0;
  let suppressNextPause = false;

  function clearReversePlaybackTimer() {
    if (reversePlaybackRaf !== null) {
      cancelAnimationFrame(reversePlaybackRaf);
      reversePlaybackRaf = null;
    }
    reverseLastTs = 0;
  }

  function togglePlay() {
    if (!mediaElement.value) return;

    if (reversePlaybackRaf !== null) {
      clearReversePlaybackTimer();
      isPlaying.value = false;
      return;
    }

    if (isPlaying.value) {
      mediaElement.value.pause();
      return;
    }

    void mediaElement.value.play();
  }

  function pauseAndClearPlayback() {
    suppressNextPause = true;
    clearReversePlaybackTimer();
    mediaElement.value?.pause();
  }

  function setForwardPlaybackSpeed(speed: number) {
    if (!mediaElement.value) return;
    pauseAndClearPlayback();
    const nextSpeed = Number(speed);
    playbackSpeed.value = Number.isFinite(nextSpeed) ? nextSpeed : 1;
    mediaElement.value.playbackRate = Math.max(0.1, Math.abs(playbackSpeed.value));
    mediaElement.value.muted = false;
    void mediaElement.value.play();
  }

  function setBackwardPlaybackSpeed(speed: number) {
    if (!mediaElement.value) return;

    pauseAndClearPlayback();

    const nextSpeed = Number(speed);
    playbackSpeed.value = Number.isFinite(nextSpeed) ? -Math.abs(nextSpeed) : -1;
    mediaElement.value.playbackRate = 1;
    mediaElement.value.muted = true;

    const absSpeed = Math.max(0.1, Number(speed) || 1);

    function step() {
      if (!mediaElement.value) return;

      const now = performance.now();
      const dtMs = reverseLastTs > 0 ? now - reverseLastTs : 0;
      reverseLastTs = now;

      const dtSec = Math.max(0, dtMs / 1000);
      const delta = dtSec * absSpeed;

      const next = Math.max(0, mediaElement.value.currentTime - delta);
      mediaElement.value.currentTime = next;
      currentTime.value = next;

      if (duration.value > 0) {
        progress.value = (currentTime.value / duration.value) * 100;
      }

      if (next <= 0) {
        pauseAndClearPlayback();
        isPlaying.value = false;
      } else {
        reversePlaybackRaf = requestAnimationFrame(step);
      }
    }

    reversePlaybackRaf = requestAnimationFrame(step);
    isPlaying.value = true;
  }

  function onTimeUpdate(isDragging: Ref<boolean>) {
    if (!mediaElement.value || isDragging.value) return;
    currentTime.value = mediaElement.value.currentTime;
    if (duration.value > 0) {
      progress.value = (currentTime.value / duration.value) * 100;
    }
  }

  function onLoadedMetadata() {
    if (!mediaElement.value) return;
    duration.value = mediaElement.value.duration;
    playbackSpeed.value = 1;
    mediaElement.value.volume = Math.min(1, Math.max(0, volume.value));
    mediaElement.value.muted = isMuted.value;
  }

  function onPlay() {
    isPlaying.value = true;
  }

  function onPause() {
    if (suppressNextPause) {
      suppressNextPause = false;
      return;
    }
    isPlaying.value = false;
    clearReversePlaybackTimer();
  }

  function resetState() {
    isPlaying.value = false;
    currentTime.value = 0;
    progress.value = 0;
    duration.value = 0;
    playbackSpeed.value = 1;
    clearReversePlaybackTimer();
  }

  function shouldHandlePreviewPlaybackEvent() {
    // We can't easily check playerRootEl here, but we can check props
    if (props.isModal) return false;
    if (!props.focusPanelId) return focusStore.canUsePreviewHotkeys;
    return focusStore.effectiveFocus === props.focusPanelId;
  }

  watch(
    () => uiStore.previewPlaybackTrigger,
    (detail) => {
      if (!shouldHandlePreviewPlaybackEvent()) return;
      if (!detail || !detail.timestamp) return;

      if (detail.action === 'toggle') {
        togglePlay();
        return;
      }

      if (detail.action === 'toggle1') {
        if (!mediaElement.value) return;
        if (reversePlaybackRaf !== null) {
          clearReversePlaybackTimer();
        }

        if (isPlaying.value) {
          mediaElement.value.playbackRate = 1;
          playbackSpeed.value = 1;
          return;
        }

        if (!mediaElement.value) return;
        pauseAndClearPlayback();
        mediaElement.value.currentTime = 0;
        currentTime.value = 0;
      } else if (detail.action === 'toEnd') {
        if (!mediaElement.value) return;
        pauseAndClearPlayback();
        const end = Number.isFinite(mediaElement.value.duration) ? mediaElement.value.duration : 0;
        mediaElement.value.currentTime = end;
        currentTime.value = end;
      } else if (detail.action === 'set') {
        if (detail.direction === 'forward') {
          setForwardPlaybackSpeed(detail.speed ?? 1);
        } else {
          setBackwardPlaybackSpeed(detail.speed ?? 1);
        }
      }
    },
    { deep: true },
  );

  onUnmounted(() => {
    clearReversePlaybackTimer();
  });

  return {
    isPlaying,
    currentTime,
    duration,
    progress,
    playbackSpeed,
    togglePlay,
    setForwardPlaybackSpeed,
    setBackwardPlaybackSpeed,
    onTimeUpdate,
    onLoadedMetadata,
    onPlay,
    onPause,
    resetState,
    pauseAndClearPlayback,
  };
}
