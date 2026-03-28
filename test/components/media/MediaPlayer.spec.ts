import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import MediaPlayer from '~/components/media/MediaPlayer.vue';
import UiVolumeControl from '~/components/ui/editor/UiVolumeControl.vue';
import { useUiStore } from '~/stores/ui.store';
import { ref } from 'vue';

// Mock volume composable
vi.mock('~/composables/preview/useMediaPlayerVolume', () => ({
  useMediaPlayerVolume: vi.fn(() => ({
    volume: ref(0.7),
    isMuted: ref(false),
  })),
}));

// Mock playback composable
vi.mock('~/composables/preview/useMediaPlayerPlayback', () => ({
  useMediaPlayerPlayback: vi.fn(() => ({
    isPlaying: ref(false),
    currentTime: ref(0),
    duration: ref(60),
    progress: ref(0),
    playbackSpeed: ref(1.0),
    togglePlay: vi.fn(),
    setForwardPlaybackSpeed: vi.fn(),
    setBackwardPlaybackSpeed: vi.fn(),
    onTimeUpdate: vi.fn(),
    onLoadedMetadata: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    resetState: vi.fn(),
    pauseAndClearPlayback: vi.fn(),
  })),
}));

// Mock pan zoom composable
vi.mock('~/composables/preview/useImagePanZoom', () => ({
  useImagePanZoom: vi.fn(() => ({
    scale: { value: 1.0 },
    translateX: { value: 0 },
    translateY: { value: 0 },
    isReady: { value: true },
    reset: vi.fn(),
    fitToContainer: vi.fn(),
    onWheel: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onAuxClick: vi.fn(),
    onCustomZoom: vi.fn(),
  })),
}));

describe('MediaPlayer.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders video element correctly', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video'
      },
    });

    const video = component.find('video');
    expect(video.exists()).toBe(true);
    expect(video.attributes('src')).toBe('http://example.com/test.mp4');
  });

  it('renders audio representation correctly', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp3',
        type: 'audio'
      },
    });

    const audio = component.find('audio');
    expect(audio.exists()).toBe(true);
    expect(audio.attributes('src')).toBe('http://example.com/test.mp3');
    
    // Check if audio placeholder UI is visible
    expect(component.find('.i-heroicons-musical-note').exists()).toBe(true);
  });

  it('toggles playback on button click', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video'
      },
    });

    const playButton = component.find('button.i-heroicons-play, button.i-heroicons-pause');
    await playButton.trigger('click');
    
    const { useMediaPlayerPlayback } = await import('~/composables/preview/useMediaPlayerPlayback');
    const { togglePlay } = (useMediaPlayerPlayback as any).mock.results[0].value;
    expect(togglePlay).toHaveBeenCalled();
  });

  it('handles zoom triggers from uiStore for video', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video',
        isModal: true
      },
    });

    const { useImagePanZoom } = await import('~/composables/preview/useImagePanZoom');
    const { onCustomZoom, reset } = (useImagePanZoom as any).mock.results[0].value;
    const uiStore = useUiStore();

    // Reset trigger
    uiStore.previewZoomResetTrigger = Date.now();
    await component.vm.$nextTick();
    expect(reset).toHaveBeenCalled();

    // Custom zoom trigger
    uiStore.previewZoomTrigger = { timestamp: Date.now(), dir: 'in' };
    await component.vm.$nextTick();
    expect(onCustomZoom).toHaveBeenCalled();
  });

  it('emits open-modal and close-modal events', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video',
        isModal: false
      },
    });

    // Find fullscreen button
    const fullscreenBtn = component.find('button.i-heroicons-arrows-pointing-out, button.i-heroicons-arrows-pointing-in');
    await fullscreenBtn.trigger('click');
    expect(component.emitted('open-modal')).toBeTruthy();
  });

  it('updates volume correctly', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video'
      },
    });

    const { useMediaPlayerVolume } = await import('~/composables/preview/useMediaPlayerVolume');
    const { volume } = (useMediaPlayerVolume as any).mock.results[0].value;
    
    volume.value = 0.5;
    await component.vm.$nextTick();
    
    const video = component.find('video').element as HTMLVideoElement;
    expect(video.volume).toBe(0.5);
  });

  it('toggles mute on button click', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video'
      },
    });

    const { useMediaPlayerVolume } = await import('~/composables/preview/useMediaPlayerVolume');
    const { isMuted } = (useMediaPlayerVolume as any).mock.results[0].value;
    
    // Check for UiVolumeControl and find its mute button or trigger change
    const volumeControl = component.findComponent(UiVolumeControl);
    await volumeControl.vm.$emit('update:isMuted', true);
    
    expect(isMuted.value).toBe(true);
  });

  it('handles seek start and end', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video'
      },
    });

    const rangeInput = component.find('input[type="range"]');
    
    // Seek start
    await rangeInput.trigger('mousedown');
    expect((component.vm as any).isDragging).toBe(true);

    // Seek end
    await rangeInput.trigger('mouseup');
    expect((component.vm as any).isDragging).toBe(false);
  });

  it('resets state on source change', async () => {
    const component = await mountWithNuxt(MediaPlayer, {
      props: {
        src: 'http://example.com/test.mp4',
        type: 'video'
      },
    });

    const { useMediaPlayerPlayback } = await import('~/composables/preview/useMediaPlayerPlayback');
    const { resetState } = (useMediaPlayerPlayback as any).mock.results[0].value;

    await component.setProps({ src: 'http://example.com/new.mp4' });
    expect(resetState).toHaveBeenCalled();
  });
});
