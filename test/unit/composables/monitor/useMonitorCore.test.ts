import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { WorkerTimelineClip } from '../../../../src/composables/monitor/types';

import { useMonitorCore } from '../../../../src/composables/monitor/useMonitorCore';

const mockClient = {
  loadTimeline: vi.fn().mockResolvedValue(0),
  updateTimelineLayout: vi.fn().mockResolvedValue(0),
  clearClips: vi.fn().mockResolvedValue(undefined),
  renderFrame: vi.fn().mockResolvedValue(undefined),
  destroyCompositor: vi.fn().mockResolvedValue(undefined),
  initCompositor: vi.fn().mockResolvedValue(undefined),
};

const audioEngineInstances: Array<{
  setVolume: ReturnType<typeof vi.fn>;
  setMasterVolume: ReturnType<typeof vi.fn>;
  setMonitorVolume: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('~/utils/video-editor/worker-client', () => ({
  getPreviewWorkerClient: () => ({ client: mockClient, worker: {} }),
  setPreviewHostApi: vi.fn(),
}));

vi.mock('~/utils/video-editor/AudioEngine', () => {
  class AudioEngineMock {
    clips: any[] = [];
    getClips() {
      return this.clips;
    }
    loadClips = vi.fn().mockImplementation(async (clips) => {
      this.clips = clips;
    });
    setVolume = vi.fn();
    init = vi.fn().mockResolvedValue(undefined);
    // loadClips redefined
    updateTimelineLayout = vi.fn();
    destroy = vi.fn();
    setMasterVolume = vi.fn();
    setMonitorVolume = vi.fn();

    constructor() {
      audioEngineInstances.push(this);
    }
  }

  return { AudioEngine: AudioEngineMock };
});

function createAudioClip(overrides: Partial<WorkerTimelineClip> = {}): WorkerTimelineClip {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'audio-1',
    layer: 0,
    source: { path: 'audio.mp3' },
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    ...overrides,
  };
}

function createMonitorSettings(overrides?: Record<string, unknown>) {
  return {
    previewResolution: 720,
    useProxy: false,
    previewEffectsEnabled: true,
    ...overrides,
  };
}

describe('useMonitorCore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    audioEngineInstances.length = 0;

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
      masterGain: 1,
      audioMuted: false,
      setCurrentTimeUs: vi.fn(),
      timelineDoc: null,
    });

    const projectStore = reactive({
      projectSettings: {
        project: { width: 1920, height: 1080, audioDeclickDurationUs: 5000 },
        export: { width: 1920, height: 1080 },
        monitor: createMonitorSettings(),
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

    await vi.advanceTimersByTimeAsync(500);
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
      masterGain: 1,
      audioMuted: false,
      setCurrentTimeUs: vi.fn(),
      timelineDoc: null,
    });

    const projectStore = reactive({
      projectSettings: {
        export: { width: 1920, height: 1080 },
        monitor: createMonitorSettings(),
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
    expect(audioEngine?.setMasterVolume).toHaveBeenLastCalledWith(1);

    timelineStore.masterGain = 0.4;
    await nextTick();
    expect(audioEngine?.setMasterVolume).toHaveBeenLastCalledWith(0.4);

    timelineStore.audioMuted = true;
    await nextTick();
    expect(audioEngine?.setMasterVolume).toHaveBeenLastCalledWith(0);

    wrapper.unmount();
  });

  it('passes preview effects flag to renderFrame and re-renders when it changes', async () => {
    const timelineStore = reactive({
      duration: 0,
      currentTime: 1250,
      isPlaying: false,
      masterGain: 1,
      audioMuted: false,
      setCurrentTimeUs: vi.fn(),
      timelineDoc: null,
    });

    const projectStore = reactive({
      projectSettings: {
        export: { width: 1920, height: 1080 },
        monitor: createMonitorSettings(),
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
            videoItems: ref([{ id: 'clip-1' }]),
            workerTimelineClips: ref([]),
            workerAudioClips: ref([]),
            safeDurationUs: ref(2_000_000),
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

    mockClient.renderFrame.mockClear();

    projectStore.projectSettings.monitor.previewEffectsEnabled = false;
    await nextTick();

    expect(mockClient.renderFrame).toHaveBeenCalledWith(1250, { previewEffectsEnabled: false });

    projectStore.projectSettings.monitor.previewEffectsEnabled = true;
    await nextTick();

    expect(mockClient.renderFrame).toHaveBeenLastCalledWith(1250, { previewEffectsEnabled: true });

    wrapper.unmount();
  });
});
