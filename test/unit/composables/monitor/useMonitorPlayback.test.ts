import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useMonitorPlayback } from '../~/composables/monitor/useMonitorPlayback';

describe('useMonitorPlayback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(performance, 'now').mockReturnValue(100);
  });

  it('pauses playback when document becomes hidden', async () => {
    const isLoading = ref(false);
    const loadError = ref<string | null>(null);
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(1_000_000);
    const safeDurationUs = ref(1_000_000);

    const audioEngine = {
      play: vi.fn(),
      stop: vi.fn(),
      stopScrubPreview: vi.fn(),
      previewScrubForward: vi.fn(),
      seek: vi.fn(),
      getCurrentTimeUs: vi.fn(() => 0),
    } as any;

    const scheduleRender = vi.fn();
    const updateStoreTime = vi.fn((t: number) => {
      currentTime.value = t;
    });

    const TestComp = defineComponent({
      setup() {
        useMonitorPlayback({
          isLoading,
          loadError,
          isPlaying,
          currentTime,
          duration,
          safeDurationUs,
          getFps: () => 30,
          clampToTimeline: (t: number) => Math.max(0, Math.min(t, safeDurationUs.value)),
          updateStoreTime,
          scheduleRender,
          audioEngine,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    isPlaying.value = true;
    await nextTick();

    expect(audioEngine.play).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });

    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();

    expect(isPlaying.value).toBe(false);

    wrapper.unmount();
  });

  it('plays scrub preview when current time moves forward while paused', async () => {
    const isLoading = ref(false);
    const loadError = ref<string | null>(null);
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(1_000_000);
    const safeDurationUs = ref(1_000_000);

    const audioEngine = {
      play: vi.fn(),
      stop: vi.fn(),
      stopScrubPreview: vi.fn(),
      previewScrubForward: vi.fn(),
      seek: vi.fn(),
      getCurrentTimeUs: vi.fn(() => 0),
    } as any;

    const scheduleRender = vi.fn();
    const updateStoreTime = vi.fn((t: number) => {
      currentTime.value = t;
    });

    const TestComp = defineComponent({
      setup() {
        useMonitorPlayback({
          isLoading,
          loadError,
          isPlaying,
          currentTime,
          duration,
          safeDurationUs,
          getFps: () => 30,
          clampToTimeline: (t: number) => Math.max(0, Math.min(t, safeDurationUs.value)),
          updateStoreTime,
          scheduleRender,
          audioEngine,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    currentTime.value = 50_000;
    await nextTick();

    expect(audioEngine.previewScrubForward).toHaveBeenCalledWith(0, 50_000, 75_000);
    expect(audioEngine.stopScrubPreview).not.toHaveBeenCalled();
    expect(scheduleRender).toHaveBeenCalledWith(50_000);

    wrapper.unmount();
  });

  it('stops scrub preview when current time moves backward while paused', async () => {
    const isLoading = ref(false);
    const loadError = ref<string | null>(null);
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(1_000_000);
    const safeDurationUs = ref(1_000_000);

    const audioEngine = {
      play: vi.fn(),
      stop: vi.fn(),
      stopScrubPreview: vi.fn(),
      previewScrubForward: vi.fn(),
      seek: vi.fn(),
      getCurrentTimeUs: vi.fn(() => 0),
    } as any;

    const scheduleRender = vi.fn();
    const updateStoreTime = vi.fn((t: number) => {
      currentTime.value = t;
    });

    const TestComp = defineComponent({
      setup() {
        useMonitorPlayback({
          isLoading,
          loadError,
          isPlaying,
          currentTime,
          duration,
          safeDurationUs,
          getFps: () => 30,
          clampToTimeline: (t: number) => Math.max(0, Math.min(t, safeDurationUs.value)),
          updateStoreTime,
          scheduleRender,
          audioEngine,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    currentTime.value = 50_000;
    await nextTick();

    currentTime.value = 10_000;
    await nextTick();

    expect(audioEngine.stopScrubPreview).toHaveBeenCalled();

    wrapper.unmount();
  });
});
