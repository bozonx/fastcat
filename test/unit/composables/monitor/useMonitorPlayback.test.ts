import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick, defineComponent, h, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import { useTimelineStore } from '~/stores/timeline.store';

describe('useMonitorPlayback', () => {
  let pinia: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(performance, 'now').mockReturnValue(100);
    // Explicitly mock requestAnimationFrame if needed, or use vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => setTimeout(() => cb(performance.now()), 16)));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => clearTimeout(id)));

    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: {
        timeline: {
          playbackSpeed: 1,
          currentTime: 0,
          isPlaying: false,
        },
      },
    });
  });

  function createAudioEngineMock() {
    return {
      play: vi.fn(),
      stop: vi.fn(),
      stopScrubPreview: vi.fn(),
      previewScrubForward: vi.fn(),
      seek: vi.fn(),
      setGlobalSpeed: vi.fn(),
      getCurrentTimeUs: vi.fn(() => 0),
    } as any;
  }

  it('pauses playback when document becomes hidden', async () => {
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(1_000_000);
    const safeDurationUs = ref(1_000_000);
    const audioEngine = createAudioEngineMock();

    const TestComp = defineComponent({
      setup() {
        useMonitorPlayback({
          isLoading: ref(false),
          loadError: ref(null),
          isPlaying,
          currentTime,
          duration,
          safeDurationUs,
          getFps: () => 30,
          clampToTimeline: (t: number) => Math.max(0, Math.min(t, safeDurationUs.value)),
          updateStoreTime: vi.fn(),
          scheduleRender: vi.fn(),
          audioEngine,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp, { global: { plugins: [pinia] } });

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
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const safeDurationUs = ref(1_000_000);
    const audioEngine = createAudioEngineMock();
    const scheduleRender = vi.fn();

    const TestComp = defineComponent({
      setup() {
        useMonitorPlayback({
          isLoading: ref(false),
          loadError: ref(null),
          isPlaying,
          currentTime,
          duration: ref(1_000_000),
          safeDurationUs,
          getFps: () => 30,
          clampToTimeline: (t: number) => Math.max(0, Math.min(t, safeDurationUs.value)),
          updateStoreTime: vi.fn(),
          scheduleRender,
          audioEngine,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp, { global: { plugins: [pinia] } });

    currentTime.value = 50_000;
    await nextTick();

    expect(audioEngine.previewScrubForward).toHaveBeenCalledWith(0, 50_000, 75_000);
    expect(scheduleRender).toHaveBeenCalledWith(50_000);
    wrapper.unmount();
  });

  it('updates global speed when timelineStore.playbackSpeed changes', async () => {
    const isPlaying = ref(false);
    const audioEngine = createAudioEngineMock();
    const timelineStore = useTimelineStore();

    const TestComp = defineComponent({
      setup() {
        useMonitorPlayback({
          isLoading: ref(false),
          loadError: ref(null),
          isPlaying,
          currentTime: ref(0),
          duration: ref(1_000_000),
          safeDurationUs: ref(1_000_000),
          getFps: () => 30,
          clampToTimeline: (t: number) => t,
          updateStoreTime: vi.fn(),
          scheduleRender: vi.fn(),
          audioEngine,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp, { global: { plugins: [pinia] } });

    isPlaying.value = true;
    await nextTick();

    timelineStore.playbackSpeed = 2;
    await nextTick();
    expect(audioEngine.setGlobalSpeed).toHaveBeenCalledWith(2);

    wrapper.unmount();
  });

  it('stops playback when reaching safeDurationUs', async () => {
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const safeDurationUs = ref(500_000);
    const audioEngine = createAudioEngineMock();
    audioEngine.getCurrentTimeUs.mockReturnValue(600_000);
    
    // We need to control RAF precisely
    let rafCb: any;
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { rafCb = cb; return 1; }));

    const TestComp = defineComponent({
      setup() {
        useMonitorPlayback({
          isLoading: ref(false),
          loadError: ref(null),
          isPlaying,
          currentTime,
          duration: ref(1_000_000),
          safeDurationUs,
          getFps: () => 30,
          clampToTimeline: (t: number) => Math.max(0, Math.min(t, safeDurationUs.value)),
          updateStoreTime: (t: any) => { currentTime.value = t; },
          scheduleRender: vi.fn(),
          audioEngine,
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp, { global: { plugins: [pinia] } });

    isPlaying.value = true;
    await nextTick();

    // Trigger the playback loop callback
    if (rafCb) rafCb(performance.now());
    await nextTick();

    expect(isPlaying.value).toBe(false);
    expect(currentTime.value).toBe(safeDurationUs.value);
    wrapper.unmount();
  });
});
