/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { useMediaPlayerPlayback } from '~/composables/preview/useMediaPlayerPlayback';

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({
    previewPlaybackTrigger: null,
  }),
}));

function makeMediaElement(overrides?: Partial<HTMLVideoElement>): HTMLVideoElement {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    currentTime: 0,
    duration: 100,
    volume: 1,
    muted: false,
    playbackRate: 1,
    readyState: 4,
    error: null,
    ...overrides,
  } as unknown as HTMLVideoElement;
}

describe('useMediaPlayerPlayback', () => {
  it('initializes with default state', () => {
    const mediaEl = ref<HTMLVideoElement | null>(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const result = useMediaPlayerPlayback(mediaEl, { src: 'test.mp4' }, volume, isMuted, focusStore);

    expect(result.isPlaying.value).toBe(false);
    expect(result.currentTime.value).toBe(0);
    expect(result.duration.value).toBe(0);
    expect(result.progress.value).toBe(0);
    expect(result.playbackSpeed.value).toBe(1);
    expect(result.playbackError.value).toBeNull();
  });

  it('togglePlay does nothing when no media element', () => {
    const mediaEl = ref<HTMLVideoElement | null>(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { togglePlay, isPlaying } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    togglePlay();
    expect(isPlaying.value).toBe(false);
  });

  it('togglePlay calls play() when not playing', () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { togglePlay } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    togglePlay();
    expect(el.play).toHaveBeenCalled();
  });

  it('togglePlay calls pause() when playing', () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { togglePlay, onPlay, isPlaying } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    onPlay();
    expect(isPlaying.value).toBe(true);
    togglePlay();
    expect(el.pause).toHaveBeenCalled();
  });

  it('onPlay sets isPlaying to true', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlay, isPlaying } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    onPlay();
    expect(isPlaying.value).toBe(true);
  });

  it('onPause sets isPlaying to false', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlay, onPause, isPlaying } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    onPlay();
    onPause();
    expect(isPlaying.value).toBe(false);
  });

  it('onPause with suppressNextPause does not set isPlaying to false', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlay, pauseAndClearPlayback, onPause, isPlaying } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    onPlay();
    pauseAndClearPlayback();
    onPause();
    expect(isPlaying.value).toBe(true);
  });

  it('onLoadedMetadata sets duration and volume', () => {
    const el = makeMediaElement({ duration: 200 });
    const mediaEl = ref(el);
    const volume = ref(0.5);
    const isMuted = ref(true);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onLoadedMetadata, duration } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    onLoadedMetadata();
    expect(duration.value).toBe(200);
    expect(el.volume).toBe(0.5);
    expect(el.muted).toBe(true);
  });

  it('onTimeUpdate updates currentTime and progress', () => {
    const el = makeMediaElement({ currentTime: 50, duration: 100 });
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onTimeUpdate, currentTime, progress, duration } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    duration.value = 100;
    const isDragging = ref(false);
    onTimeUpdate(isDragging);
    expect(currentTime.value).toBe(50);
    expect(progress.value).toBe(50);
  });

  it('onTimeUpdate does nothing when dragging', () => {
    const el = makeMediaElement({ currentTime: 50 });
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onTimeUpdate, currentTime } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    const isDragging = ref(true);
    onTimeUpdate(isDragging);
    expect(currentTime.value).toBe(0);
  });

  it('resetState resets all state', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlay, resetState, isPlaying, currentTime, duration, progress, playbackSpeed, playbackError } =
      useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    onPlay();
    resetState();
    expect(isPlaying.value).toBe(false);
    expect(currentTime.value).toBe(0);
    expect(duration.value).toBe(0);
    expect(progress.value).toBe(0);
    expect(playbackSpeed.value).toBe(1);
    expect(playbackError.value).toBeNull();
  });

  it('onPlaybackError sets playbackError', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlaybackError, playbackError } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    const fakeEvent = {
      target: { error: { code: 3, message: 'DECODER_ERROR' } },
    } as unknown as Event;
    onPlaybackError(fakeEvent);
    expect(playbackError.value).toEqual({ code: 3, message: 'DECODER_ERROR' });
  });

  it('onPlaybackError does nothing when no error', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlaybackError, playbackError } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    const fakeEvent = { target: { error: null } } as unknown as Event;
    onPlaybackError(fakeEvent);
    expect(playbackError.value).toBeNull();
  });

  it('setForwardPlaybackSpeed sets playbackRate and plays', () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { setForwardPlaybackSpeed, playbackSpeed } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    setForwardPlaybackSpeed(2);
    expect(playbackSpeed.value).toBe(2);
    expect(el.playbackRate).toBe(2);
    expect(el.muted).toBe(false);
    expect(el.play).toHaveBeenCalled();
  });

  it('setForwardPlaybackSpeed does nothing when no media element', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { setForwardPlaybackSpeed, playbackSpeed } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    setForwardPlaybackSpeed(2);
    expect(playbackSpeed.value).toBe(1);
  });

  it('pauseAndClearPlayback pauses media element', () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { pauseAndClearPlayback } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    pauseAndClearPlayback();
    expect(el.pause).toHaveBeenCalled();
  });

  it('returns all expected properties and methods', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const result = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
    expect(result.isPlaying).toBeDefined();
    expect(result.currentTime).toBeDefined();
    expect(result.duration).toBeDefined();
    expect(result.progress).toBeDefined();
    expect(result.playbackSpeed).toBeDefined();
    expect(result.playbackError).toBeDefined();
    expect(typeof result.togglePlay).toBe('function');
    expect(typeof result.setForwardPlaybackSpeed).toBe('function');
    expect(typeof result.setBackwardPlaybackSpeed).toBe('function');
    expect(typeof result.onTimeUpdate).toBe('function');
    expect(typeof result.onLoadedMetadata).toBe('function');
    expect(typeof result.onPlay).toBe('function');
    expect(typeof result.onPause).toBe('function');
    expect(typeof result.onPlaybackError).toBe('function');
    expect(typeof result.resetState).toBe('function');
    expect(typeof result.pauseAndClearPlayback).toBe('function');
  });
});
