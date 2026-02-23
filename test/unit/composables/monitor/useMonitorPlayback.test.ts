import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useMonitorPlayback } from '../../../../src/composables/monitor/useMonitorPlayback';

describe('useMonitorPlayback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
