/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, reactive, nextTick, effectScope } from 'vue';
import { useMediaPlayerPlayback } from '~/composables/preview/useMediaPlayerPlayback';

let mockState: any = null;
const mockTimelineStore = reactive({
  isPlaying: false,
});

if (typeof global.requestAnimationFrame === 'undefined') {
  global.requestAnimationFrame = (callback: any) => setTimeout(callback, 0) as any;
}
if (typeof global.cancelAnimationFrame === 'undefined') {
  global.cancelAnimationFrame = (id: any) => clearTimeout(id);
}

const mockUiStore = reactive({
  hasActivePreviewPlayer: false,
  previewModalOpen: false,
  get previewPlaybackTrigger() {
    return mockState?.trigger;
  },
});

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
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
  beforeEach(() => {
    mockState = reactive({
      trigger: null,
    });
    mockTimelineStore.isPlaying = false;
    mockUiStore.hasActivePreviewPlayer = false;
    mockUiStore.previewModalOpen = false;
  });

  it('initializes with default state', () => {
    const mediaEl = ref<HTMLVideoElement | null>(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const result = useMediaPlayerPlayback(
      mediaEl,
      { src: 'test.mp4' },
      volume,
      isMuted,
      focusStore,
    );

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

    const { togglePlay, isPlaying } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
    togglePlay();
    expect(isPlaying.value).toBe(false);
  });

  it('togglePlay calls play() when not playing', () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { togglePlay } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
    togglePlay();
    expect(el.play).toHaveBeenCalled();
  });

  it('togglePlay calls pause() when playing', () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { togglePlay, onPlay, isPlaying } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

    const { onPlay, isPlaying } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
    onPlay();
    expect(isPlaying.value).toBe(true);
  });

  it('onPause sets isPlaying to false', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlay, onPause, isPlaying } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
    onPlay();
    onPause();
    expect(isPlaying.value).toBe(false);
  });

  it('onPause with suppressNextPause does not set isPlaying to false', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { onPlay, pauseAndClearPlayback, onPause, isPlaying } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

    const { onLoadedMetadata, duration } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

    const { onTimeUpdate, currentTime, progress, duration } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

    const { onTimeUpdate, currentTime } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
    const isDragging = ref(true);
    onTimeUpdate(isDragging);
    expect(currentTime.value).toBe(0);
  });

  it('resetState resets all state', () => {
    const mediaEl = ref(null);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const {
      onPlay,
      resetState,
      isPlaying,
      currentTime,
      duration,
      progress,
      playbackSpeed,
      playbackError,
    } = useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);
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

    const { onPlaybackError, playbackError } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

    const { onPlaybackError, playbackError } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

    const { setForwardPlaybackSpeed, playbackSpeed } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

    const { setForwardPlaybackSpeed, playbackSpeed } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
    setForwardPlaybackSpeed(2);
    expect(playbackSpeed.value).toBe(1);
  });

  it('pauseAndClearPlayback pauses media element', () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: false, effectiveFocus: null };

    const { pauseAndClearPlayback } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );
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

  it('resets speed to 1x when setting speed to the same speed we are already playing at', async () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    const { playbackSpeed, isPlaying, onPlay } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );

    // Set playing to true, and initial speed to 2
    onPlay();
    playbackSpeed.value = 2;

    // Trigger set to speed 2 (same speed)
    mockState.trigger = {
      action: 'set',
      speed: 2,
      direction: 'forward',
      timestamp: Date.now(),
    };

    // Since watch is asynchronous, we wait for next tick or use a short delay
    await new Promise((resolve) => setTimeout(resolve, 0));

    // It should have reset playbackSpeed to 1
    expect(playbackSpeed.value).toBe(1);
    expect(el.playbackRate).toBe(1);

    // Now test backward speed reset
    playbackSpeed.value = -2;
    mockState.trigger = {
      action: 'set',
      speed: 2,
      direction: 'backward',
      timestamp: Date.now(),
    };

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(playbackSpeed.value).toBe(-1);
  });

  it('handles preview transport seek triggers', async () => {
    const el = makeMediaElement({ currentTime: 10, duration: 100 });
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    const { currentTime } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );

    mockState.trigger = {
      action: 'step',
      seconds: 1 / 30,
      timestamp: Date.now(),
    };
    await nextTick();

    expect(currentTime.value).toBe(10 + 1 / 30);

    mockState.trigger = {
      action: 'toStart',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(currentTime.value).toBe(0);
    expect(el.currentTime).toBe(0);
  });

  it('pauses preview playback on toggle1 when already playing', async () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    const { onPlay, playbackSpeed } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );

    onPlay();
    playbackSpeed.value = 2;

    mockState.trigger = {
      action: 'toggle1',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(playbackSpeed.value).toBe(1);
    expect(el.playbackRate).toBe(1);
    expect(el.pause).toHaveBeenCalledOnce();
  });

  it('starts preview playback at 1x on toggle1 when paused', async () => {
    const el = makeMediaElement({ currentTime: 12, playbackRate: 2 });
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    const { playbackSpeed, currentTime } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );

    currentTime.value = 12;
    playbackSpeed.value = 2;

    mockState.trigger = {
      action: 'toggle1',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(playbackSpeed.value).toBe(1);
    expect(el.playbackRate).toBe(1);
    expect(el.currentTime).toBe(12);
    expect(el.play).toHaveBeenCalledOnce();
  });

  it('keeps speedDownForward in forward playback for preview', async () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    const { playbackSpeed } = useMediaPlayerPlayback(
      mediaEl,
      { src: '' },
      volume,
      isMuted,
      focusStore,
    );

    mockState.trigger = {
      action: 'speedDownForward',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(playbackSpeed.value).toBe(0.75);
    expect(el.playbackRate).toBe(0.75);

    playbackSpeed.value = 0.5;
    mockState.trigger = {
      action: 'speedDownForward',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(playbackSpeed.value).toBe(0.5);
    expect(el.playbackRate).toBe(0.5);
  });

  it('handles preview volume and mute transport triggers', async () => {
    const el = makeMediaElement({ volume: 0.5, muted: false });
    const mediaEl = ref(el);
    const volume = ref(0.5);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore);

    mockState.trigger = {
      action: 'volumeUp',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(volume.value).toBe(0.55);
    expect(el.volume).toBe(0.55);

    mockState.trigger = {
      action: 'toggleMute',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(isMuted.value).toBe(true);
    expect(el.muted).toBe(true);
  });

  it('lets modal player handle preview triggers while inline player is gated', async () => {
    const inlineEl = makeMediaElement();
    const modalEl = makeMediaElement();
    const inlineMediaEl = ref(inlineEl);
    const modalMediaEl = ref(modalEl);
    const inlineVolume = ref(1);
    const modalVolume = ref(1);
    const inlineMuted = ref(false);
    const modalMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    useMediaPlayerPlayback(
      inlineMediaEl,
      { src: '', isModal: false },
      inlineVolume,
      inlineMuted,
      focusStore,
    );
    useMediaPlayerPlayback(
      modalMediaEl,
      { src: '', isModal: true },
      modalVolume,
      modalMuted,
      focusStore,
    );

    mockUiStore.previewModalOpen = true;
    mockState.trigger = {
      action: 'toggle',
      timestamp: Date.now(),
    };
    await nextTick();

    expect(inlineEl.play).not.toHaveBeenCalled();
    expect(modalEl.play).toHaveBeenCalledOnce();
  });

  it('stops timeline playback when preview playback starts', async () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    mockTimelineStore.isPlaying = true;

    const scope = effectScope();
    const { isPlaying } = scope.run(() =>
      useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore),
    )!;

    isPlaying.value = true;

    await nextTick();

    expect(mockTimelineStore.isPlaying).toBe(false);
    scope.stop();
  });

  it('pauses preview playback when timeline playback starts', async () => {
    const el = makeMediaElement();
    const mediaEl = ref(el);
    const volume = ref(1);
    const isMuted = ref(false);
    const focusStore = { canUsePreviewHotkeys: true, effectiveFocus: null };

    const scope = effectScope();
    const { isPlaying, onPlay } = scope.run(() =>
      useMediaPlayerPlayback(mediaEl, { src: '' }, volume, isMuted, focusStore),
    )!;

    // Start playing preview
    onPlay();
    expect(isPlaying.value).toBe(true);

    await nextTick();

    // Start timeline playback
    mockTimelineStore.isPlaying = true;

    await nextTick();

    // Preview playback should be paused
    expect(isPlaying.value).toBe(false);
    expect(el.pause).toHaveBeenCalled();
    scope.stop();
  });
});
