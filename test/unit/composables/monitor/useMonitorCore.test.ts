import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { WorkerTimelineClip } from '../../../../src/composables/monitor/types';

const mockClient = {
  loadTimeline: vi.fn().mockResolvedValue(0),
  updateTimelineLayout: vi.fn().mockResolvedValue(0),
  clearClips: vi.fn().mockResolvedValue(undefined),
  renderFrame: vi.fn().mockResolvedValue(undefined),
  destroyCompositor: vi.fn().mockResolvedValue(undefined),
  initCompositor: vi.fn().mockResolvedValue(undefined),
};

const audioEngineInstances: Array<{ setVolume: ReturnType<typeof vi.fn> }> = [];

vi.mock('~/utils/video-editor/worker-client', () => ({
  getPreviewWorkerClient: () => ({ client: mockClient, worker: {} }),
  setPreviewHostApi: vi.fn(),
}));

vi.mock('~/utils/video-editor/AudioEngine', () => {
  class AudioEngineMock {
    setVolume = vi.fn();
    init = vi.fn().mockResolvedValue(undefined);
    loadClips = vi.fn().mockResolvedValue(undefined);
    updateTimelineLayout = vi.fn();
    destroy = vi.fn();

    constructor() {
      audioEngineInstances.push(this);
    }
  }

  return { AudioEngine: AudioEngineMock };
});

import { useMonitorCore } from '../../../../src/composables/monitor/useMonitorCore';

function createAudioClip(overrides: Partial<WorkerTimelineClip> = {}): WorkerTimelineClip {
  return {
    kind: 'clip',
    id: 'audio-1',
    layer: 0,
    source: { path: 'audio.mp3' },
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    ...overrides,
  };
}

describe('useMonitorCore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    audioEngineInstances.length = 0;
    vi.stubGlobal('useI18n', () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }));

    if (!('ResizeObserver' in globalThis)) {
      class ResizeObserverMock {
        observe() {}
        disconnect() {}
      }
      vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    }

    if (!HTMLCanvasElement.prototype.transferControlToOffscreen) {
      HTMLCanvasElement.prototype.transferControlToOffscreen = () => ({}) as OffscreenCanvas;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses audio duration when timeline has only audio clips', async () => {
    const timelineStore = reactive({
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      audioVolume: 1,
      audioMuted: false,
    });

    const projectStore = reactive({
      projectSettings: {
        export: { width: 1920, height: 1080 },
        monitor: { previewResolution: 720, useProxy: false },
      },
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
    };

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const audioClips = ref<WorkerTimelineClip[]>([createAudioClip()]);

    const TestComp = defineComponent({
      setup() {
        useMonitorCore({
          projectStore,
          timelineStore,
          proxyStore,
          monitorTimeline: {
            videoItems: ref([]),
            workerTimelineClips: ref([]),
            workerAudioClips: audioClips,
            safeDurationUs: ref(0),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    await vi.runAllTimersAsync();
    await nextTick();

    expect(timelineStore.duration).toBe(5_000_000);
    expect(mockClient.loadTimeline).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('updates AudioEngine volume when mute or volume changes', async () => {
    const timelineStore = reactive({
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      audioVolume: 1,
      audioMuted: false,
    });

    const projectStore = reactive({
      projectSettings: {
        export: { width: 1920, height: 1080 },
        monitor: { previewResolution: 720, useProxy: false },
      },
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
    };

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const TestComp = defineComponent({
      setup() {
        useMonitorCore({
          projectStore,
          timelineStore,
          proxyStore,
          monitorTimeline: {
            videoItems: ref([]),
            workerTimelineClips: ref([]),
            workerAudioClips: ref([]),
            safeDurationUs: ref(0),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    await nextTick();

    const audioEngine = audioEngineInstances[0];
    expect(audioEngine?.setVolume).toHaveBeenLastCalledWith(1);

    timelineStore.audioVolume = 0.4;
    await nextTick();
    expect(audioEngine?.setVolume).toHaveBeenLastCalledWith(0.4);

    timelineStore.audioMuted = true;
    await nextTick();
    expect(audioEngine?.setVolume).toHaveBeenLastCalledWith(0);

    wrapper.unmount();
  });
});
