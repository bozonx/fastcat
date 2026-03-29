import type { Ref } from 'vue';
import {
  DEFAULT_TIMELINE_ZOOM_POSITION,
  MAX_TIMELINE_ZOOM_POSITION,
  MIN_TIMELINE_ZOOM_POSITION,
} from '~/utils/zoom';

export interface TimelinePlaybackDeps {
  currentTime: Ref<number>;
  isPlaying: Ref<boolean>;
  playbackSpeed: Ref<number>;
  timelineZoom: Ref<number>;
  audioVolume: Ref<number>;
  audioMuted: Ref<boolean>;
  duration: Ref<number>;
  playbackGestureHandler: Ref<((nextPlaying: boolean) => void) | null>;
  getDocFps: () => number;
  setCurrentTimeUs: (nextTimeUs: number) => void;
}

export interface TimelinePlaybackModule {
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
  seekFrames: (deltaFrames: number) => void;
}

export function createTimelinePlaybackModule(deps: TimelinePlaybackDeps): TimelinePlaybackModule {
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
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;

    const clamped = Math.min(
      MAX_TIMELINE_ZOOM_POSITION,
      Math.max(MIN_TIMELINE_ZOOM_POSITION, parsed),
    );

    // Snap to 100% (default zoom) when crossing into the snap zone
    const SNAP_THRESHOLD = 2.5;
    const prev = deps.timelineZoom.value;
    if (
      Math.abs(clamped - DEFAULT_TIMELINE_ZOOM_POSITION) < SNAP_THRESHOLD &&
      Math.abs(prev - DEFAULT_TIMELINE_ZOOM_POSITION) >= SNAP_THRESHOLD
    ) {
      deps.timelineZoom.value = DEFAULT_TIMELINE_ZOOM_POSITION;
    } else {
      deps.timelineZoom.value = clamped;
    }
  }

  function setAudioVolume(next: number) {
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;
    deps.audioVolume.value = Math.min(10, Math.max(0, parsed));
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

  function seekFrames(deltaFrames: number) {
    const fps = deps.getDocFps();
    const frameUs = 1_000_000 / fps;
    deps.setCurrentTimeUs(deps.currentTime.value + deltaFrames * frameUs);
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
    seekFrames,
  };
}
