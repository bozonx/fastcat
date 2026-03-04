import type { Ref } from 'vue';

export interface TimelinePlaybackDeps {
  currentTime: Ref<number>;
  isPlaying: Ref<boolean>;
  playbackSpeed: Ref<number>;
  timelineZoom: Ref<number>;
  audioVolume: Ref<number>;
  audioMuted: Ref<boolean>;
  duration: Ref<number>;
  playbackGestureHandler: Ref<((nextPlaying: boolean) => void) | null>;
}

export interface TimelinePlaybackApi {
  setPlaybackSpeed: (speed: number) => void;
  goToStart: () => void;
  goToEnd: () => void;
  setTimelineZoom: (next: number) => void;
  setAudioVolume: (next: number) => void;
  setAudioMuted: (next: boolean) => void;
  toggleAudioMuted: () => void;
  setPlaybackGestureHandler: (handler: ((nextPlaying: boolean) => void) | null) => void;
  togglePlayback: () => void;
  stopPlayback: () => void;
}

export function createTimelinePlayback(deps: TimelinePlaybackDeps): TimelinePlaybackApi {
  function setPlaybackSpeed(speed: number) {
    const parsed = Number(speed);
    if (!Number.isFinite(parsed)) return;

    const abs = Math.abs(parsed);
    const clampedAbs = Math.max(0.1, Math.min(10, abs));

    const sign = parsed < 0 ? -1 : 1;
    deps.playbackSpeed.value = clampedAbs * sign;
  }

  function goToStart() {
    deps.currentTime.value = 0;
  }

  function goToEnd() {
    const end = Number.isFinite(deps.duration.value)
      ? Math.max(0, Math.round(deps.duration.value))
      : 0;
    deps.currentTime.value = end;
  }

  function setTimelineZoom(next: number) {
    const parsed = Math.round(Number(next));
    if (!Number.isFinite(parsed)) return;
    deps.timelineZoom.value = Math.min(110, Math.max(0, parsed));
  }

  function setAudioVolume(next: number) {
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;
    deps.audioVolume.value = Math.min(2, Math.max(0, parsed));
    if (deps.audioVolume.value > 0 && deps.audioMuted.value) {
      deps.audioMuted.value = false;
    }
  }

  function setAudioMuted(next: boolean) {
    deps.audioMuted.value = Boolean(next);
  }

  function toggleAudioMuted() {
    deps.audioMuted.value = !deps.audioMuted.value;
  }

  function setPlaybackGestureHandler(handler: ((nextPlaying: boolean) => void) | null) {
    deps.playbackGestureHandler.value = handler;
  }

  function togglePlayback() {
    const nextPlaying = !deps.isPlaying.value;
    deps.playbackGestureHandler.value?.(nextPlaying);
    deps.isPlaying.value = nextPlaying;
  }

  function stopPlayback() {
    deps.playbackGestureHandler.value?.(false);
    deps.isPlaying.value = false;
    deps.currentTime.value = 0;
  }

  return {
    setPlaybackSpeed,
    goToStart,
    goToEnd,
    setTimelineZoom,
    setAudioVolume,
    setAudioMuted,
    toggleAudioMuted,
    setPlaybackGestureHandler,
    togglePlayback,
    stopPlayback,
  };
}
