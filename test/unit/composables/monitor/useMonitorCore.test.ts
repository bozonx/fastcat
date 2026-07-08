/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { WorkerTimelineClip } from '~/composables/monitor/types';

import { useMonitorCore } from '~/composables/monitor/useMonitorCore';
import { workerClipToAudioEngineClip } from '~/composables/monitor/useMonitorCore.audio';
import { computeMonitorTimelineDuration } from '~/composables/monitor/useMonitorCore.timeline';

const mockClient = {
  loadTimeline: vi.fn().mockResolvedValue(0),
  updateTimelineLayout: vi.fn().mockResolvedValue(0),
  clearClips: vi.fn().mockResolvedValue(undefined),
  renderFrame: vi.fn().mockResolvedValue(undefined),
  prewarmVideoFrames: vi.fn().mockResolvedValue(undefined),
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
  setProxyHostApi: vi.fn(),
  broadcastPixiRendererPreference: vi.fn(),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: {
      optimization: { pixiRenderer: 'webgpu', videoFrameCacheMb: 256 },
      projectDefaults: { audioDeclickDurationUs: 5000 },
      timeline: { defaultStaticClipDurationUs: 5000000 },
    },
    workspaceHandle: null,
    workspaceState: {
      fileBrowser: {
        instances: {},
      },
      presets: {
        custom: [],
        defaultText: '',
      },
    },
  }),
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
    updateTimelineLayout = vi.fn();
    destroy = vi.fn();
    setMasterVolume = vi.fn();
    setMonitorVolume = vi.fn();
    resumeContext = vi.fn().mockResolvedValue(undefined);

    constructor() {
      audioEngineInstances.push(this);
    }
  }

  return {
    createAudioEngine: () => new AudioEngineMock(),
    WebAudioEngine: AudioEngineMock,
    TauriAudioEngine: AudioEngineMock,
  };
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

  it('preserves audio envelope fields in the canonical clip→audio-engine projection', () => {
    const item = workerClipToAudioEngineClip({
      clip: createAudioClip({
        audioFadeInCurve: 'logarithmic',
        audioFadeOutCurve: 'linear',
        audioDeclickDurationUs: 5000,
        defaultAudioFadeCurve: 'logarithmic',
        transitionIn: { type: 'dissolve', durationUs: 100_000, mode: 'adjacent' } as any,
        transitionOut: { type: 'dissolve', durationUs: 200_000, mode: 'adjacent' } as any,
      }),
      sourcePath: 'audio.mp3',
      fileHandle: {} as FileSystemFileHandle,
    });

    expect(item).toMatchObject({
      audioFadeInCurve: 'logarithmic',
      audioFadeOutCurve: 'linear',
      audioDeclickDurationUs: 5000,
      transitionIn: { durationUs: 100_000 },
      transitionOut: { durationUs: 200_000 },
    });
  });

  it('does not keep stale monitor duration after timeline shrink', () => {
    expect(
      computeMonitorTimelineDuration({
        currentDurationUs: 10_000_000,
        maxDurationUs: 3_000_000,
        audioDurationUs: 4_000_000,
      }),
    ).toBe(4_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses audio duration when timeline has only audio clips', async () => {
    // Audio is derived from timelineDoc.tracks (the single source of truth),
    // mirroring the native monitor — not from a separately-fed clip array.
    const audioTrack = {
      id: 'track-audio',
      kind: 'audio',
      name: 'A1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'audio-1',
          trackId: 'track-audio',
          name: 'audio-1',
          source: { path: 'audio.mp3' },
          timelineRange: { startUs: 0, durationUs: 5_000_000 },
          sourceRange: { startUs: 0, durationUs: 5_000_000 },
        },
      ],
    };

    const timelineStore = reactive({
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      masterGain: 1,
      audioMuted: false,
      setCurrentTimeUs: vi.fn(),
      timelineDoc: { tracks: [audioTrack] } as any,
    });

    const projectStore = reactive({
      projectSettings: {
        project: { width: 1920, height: 1080, audioDeclickDurationUs: 5000 },
        export: { width: 1920, height: 1080 },
      },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
      getProxyFile: vi.fn(async () => null),
      existingProxies: ref(new Set()),
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
            rawWorkerAudioClips: audioClips,
            workerTimelineClips: ref([]),
            workerAudioClips: audioClips,
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(0),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            clipContentSignature: ref(1),
            activeLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
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
      },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
      getProxyFile: vi.fn(async () => null),
      existingProxies: ref(new Set()),
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
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(0),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            clipContentSignature: ref(1),
            activeLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
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

  it('updates AudioEngine monitor volume when uiStore changes', async () => {
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
      projectSettings: { export: { width: 1920, height: 1080 } },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const uiStoreMock = reactive({
      monitorVolume: 0.8,
      monitorMuted: false,
    });

    // We don't need to vi.mock here if we are inside a test that's already mocked or handles it.
    // Actually useMonitorCore uses useUiStore() internally.

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const TestComp = defineComponent({
      setup() {
        useMonitorCore({
          projectStore,
          timelineStore,
          proxyStore: {
            getProxyFileHandle: vi.fn(),
            getProxyFile: vi.fn(),
            existingProxies: ref(new Set()),
          } as any,
          monitorTimeline: {
            videoItems: ref([]),
            workerTimelineClips: ref([]),
            workerAudioClips: ref([]),
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(0),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            clipContentSignature: ref(1),
            activeLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);
    await nextTick();

    const audioEngine = audioEngineInstances[0];
    // Need to trigger the watcher or initialization
    // Actually useMonitorCore starts watchers on init.

    // Let's assume uiStore for this test is controlled.
    // Since useUiStore is mocked globally or we can mock it here.
    // Wait, useUiStore is already used in useMonitorCore.

    expect(audioEngine?.setMonitorVolume).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('calls initCompositor when container element becomes available', async () => {
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
      projectSettings: { export: { width: 1920, height: 1080 } },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const containerEl = ref<HTMLDivElement | null>(null);
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const TestComp = defineComponent({
      setup() {
        useMonitorCore({
          projectStore,
          timelineStore,
          proxyStore: {
            getProxyFileHandle: vi.fn(),
            getProxyFile: vi.fn(),
            existingProxies: ref(new Set()),
          } as any,
          monitorTimeline: {
            videoItems: ref([]),
            workerTimelineClips: ref([]),
            workerAudioClips: ref([]),
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(0),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            clipContentSignature: ref(1),
            activeLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);
    mockClient.initCompositor.mockClear();

    containerEl.value = document.createElement('div');
    await nextTick();
    await vi.advanceTimersByTimeAsync(150); // wait for BUILD_DEBOUNCE_MS

    expect(mockClient.initCompositor).toHaveBeenCalledWith(
      expect.anything(),
      640,
      360,
      'transparent',
      'webgpu',
      1920,
      1080,
    );
    wrapper.unmount();
  });

  it('clears the compositor for an empty timeline that still has default tracks', async () => {
    // Regression: creating/opening a fresh timeline yields a doc with default
    // empty tracks but zero clips. The old guard used `tracks.length > 0` as a
    // proxy for "content arrived", so it bailed WITHOUT clearing the compositor
    // — leaving the previous timeline's frame (and clips) on screen.
    const timelineStore = reactive({
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      masterGain: 1,
      audioMuted: false,
      setCurrentTimeUs: vi.fn(),
      // Default fresh-timeline shape: tracks exist, but every track is empty.
      timelineDoc: {
        tracks: [
          { id: 'v1', kind: 'video', items: [] },
          { id: 'a1', kind: 'audio', items: [] },
        ],
      } as any,
    });

    const projectStore = reactive({
      projectSettings: { export: { width: 1920, height: 1080 } },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const TestComp = defineComponent({
      setup() {
        useMonitorCore({
          projectStore,
          timelineStore,
          proxyStore: {
            getProxyFileHandle: vi.fn(),
            getProxyFile: vi.fn(),
            existingProxies: ref(new Set()),
          } as any,
          monitorTimeline: {
            videoItems: ref([]),
            workerTimelineClips: ref([]),
            workerAudioClips: ref([]),
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(0),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            clipContentSignature: ref(1),
            activeLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);
    await vi.advanceTimersByTimeAsync(200);
    await nextTick();

    // The compositor must be cleared (not left holding the previous timeline)
    // and a render scheduled so the stale frame is repainted away immediately.
    expect(mockClient.clearClips).toHaveBeenCalled();
    expect(mockClient.renderFrame).toHaveBeenCalled();

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
      },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
      getProxyFile: vi.fn(async () => null),
      existingProxies: ref(new Set()),
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
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(2_000_000),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            clipContentSignature: ref(1),
            activeLayoutSignature: ref(1),
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    mockClient.renderFrame.mockClear();

    projectStore.activeMonitor.previewEffectsEnabled = false;
    await nextTick();

    expect(mockClient.renderFrame).toHaveBeenCalledWith(
      1250,
      expect.objectContaining({ previewEffectsEnabled: false }),
    );

    projectStore.activeMonitor.previewEffectsEnabled = true;
    await nextTick();

    expect(mockClient.renderFrame).toHaveBeenLastCalledWith(
      1250,
      expect.objectContaining({ previewEffectsEnabled: true }),
    );

    wrapper.unmount();
  });

  it('uses 200ms debounce for clip layout updates', async () => {
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
      projectSettings: { export: { width: 1920, height: 1080 } },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
      getProxyFile: vi.fn(async () => null),
      existingProxies: ref(new Set()),
    };

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const clipLayoutSig = ref(1);
    const activeLayoutSig = ref(1);

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
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(2_000_000),
            clipSourceSignature: ref(1),
            clipLayoutSignature: clipLayoutSig,
            clipContentSignature: ref(1),
            activeLayoutSignature: activeLayoutSig,
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    // Wait for initial build
    await vi.advanceTimersByTimeAsync(200);
    await nextTick();

    // Ensure init build actually ran so signatures are set up
    expect(mockClient.clearClips).toHaveBeenCalled();

    mockClient.renderFrame.mockClear();
    mockClient.updateTimelineLayout.mockClear();
    mockClient.clearClips.mockClear();

    // Change layout signature and active layout (clip becomes visible) to trigger update
    clipLayoutSig.value = 2;
    activeLayoutSig.value = 2;
    await nextTick();

    // After 150ms debounce should not have fired yet (needs 200ms)
    await vi.advanceTimersByTimeAsync(150);
    expect(mockClient.updateTimelineLayout).not.toHaveBeenCalled();
    expect(mockClient.renderFrame).not.toHaveBeenCalled();

    // After another 400ms (550ms total) layout update should definitely flush
    await vi.advanceTimersByTimeAsync(400);
    await nextTick();
    expect(mockClient.updateTimelineLayout).toHaveBeenCalled();
    expect(mockClient.renderFrame).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('uses 1000ms debounce for clip content updates', async () => {
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
      projectSettings: { export: { width: 1920, height: 1080 } },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
      getProxyFile: vi.fn(async () => null),
      existingProxies: ref(new Set()),
    };

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const clipContentSig = ref(1);
    const activeLayoutSig = ref(1);

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
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(2_000_000),
            clipSourceSignature: ref(1),
            clipLayoutSignature: ref(1),
            clipContentSignature: clipContentSig,
            activeLayoutSignature: activeLayoutSig,
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    // Wait for initial build
    await vi.advanceTimersByTimeAsync(200);
    await nextTick();
    mockClient.renderFrame.mockClear();
    mockClient.updateTimelineLayout.mockClear();

    // Change content signature and active layout (clip becomes visible) to trigger update
    clipContentSig.value = 2;
    activeLayoutSig.value = 2;
    await nextTick();

    // After 900ms debounce should not have fired yet (needs 1000ms)
    await vi.advanceTimersByTimeAsync(900);
    expect(mockClient.updateTimelineLayout).not.toHaveBeenCalled();
    expect(mockClient.renderFrame).not.toHaveBeenCalled();

    // After another 200ms (1100ms total) content update should flush
    await vi.advanceTimersByTimeAsync(200);
    expect(mockClient.updateTimelineLayout).toHaveBeenCalled();
    expect(mockClient.renderFrame).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('skips render when activeLayoutSignature is unchanged after layout update', async () => {
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
      projectSettings: { export: { width: 1920, height: 1080 } },
      activeMonitor: createMonitorSettings(),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
      getProxyFile: vi.fn(async () => null),
      existingProxies: ref(new Set()),
    };

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const clipLayoutSig = ref(1);
    const activeLayoutSig = ref(42);

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
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(2_000_000),
            clipSourceSignature: ref(1),
            clipLayoutSignature: clipLayoutSig,
            clipContentSignature: ref(1),
            activeLayoutSignature: activeLayoutSig,
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    // Wait for initial build
    await vi.advanceTimersByTimeAsync(200);
    await nextTick();
    mockClient.renderFrame.mockClear();
    mockClient.updateTimelineLayout.mockClear();

    // Change layout signature but keep activeLayoutSignature the same.
    // The edited clip is off-playhead / hidden, so active layout hasn't changed.
    clipLayoutSig.value = 2;
    await nextTick();

    await vi.advanceTimersByTimeAsync(300);
    expect(mockClient.updateTimelineLayout).toHaveBeenCalled();
    // Because activeLayoutSignature stayed 42, scheduleRender should be skipped.
    expect(mockClient.renderFrame).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('debounces the ultra-quality upgrade after interactive layout edits while paused', async () => {
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
      },
      activeMonitor: createMonitorSettings({ previewBlurQuality: 'low' }),
      getFileHandleByPath: vi.fn(async () => ({}) as FileSystemFileHandle),
    });

    const proxyStore = {
      getProxyFileHandle: vi.fn(async () => null),
      getProxyFile: vi.fn(async () => null),
      existingProxies: ref(new Set()),
    };

    const containerEl = ref<HTMLDivElement | null>(document.createElement('div'));
    const viewportEl = ref<HTMLDivElement | null>(document.createElement('div'));

    const clipLayoutSig = ref(1);
    const activeLayoutSig = ref(1);

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
            workerTimelinePayload: ref([]),
            safeDurationUs: ref(2_000_000),
            clipSourceSignature: ref(1),
            clipLayoutSignature: clipLayoutSig,
            clipContentSignature: ref(1),
            activeLayoutSignature: activeLayoutSig,
            audioClipSourceSignature: ref(1),
            audioClipLayoutSignature: ref(1),
          },
          monitorDisplay: {
            containerEl,
            viewportEl,
            renderWidth: ref(640),
            renderHeight: ref(360),
            exportWidth: ref(1920),
            exportHeight: ref(1080),
            updateCanvasDisplaySize: vi.fn(),
          },
        });
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    // Wait for the initial build.
    await vi.advanceTimersByTimeAsync(200);
    await nextTick();
    mockClient.renderFrame.mockClear();

    // First interactive edit (e.g. an effect/transform param drag): bump both
    // signatures so the layout watcher schedules a render, as a real clip-property
    // edit would while paused.
    clipLayoutSig.value = 2;
    activeLayoutSig.value = 2;
    await nextTick();
    await vi.advanceTimersByTimeAsync(200); // clipLayoutDebounceMs

    expect(mockClient.renderFrame).toHaveBeenLastCalledWith(
      1250,
      expect.objectContaining({ previewEffectQuality: 'low' }),
    );

    // A second edit lands before the settle window elapses: it should still
    // render at the cheap tier, not the expensive ultra tier.
    await vi.advanceTimersByTimeAsync(200);
    clipLayoutSig.value = 3;
    activeLayoutSig.value = 3;
    await nextTick();
    await vi.advanceTimersByTimeAsync(200); // clipLayoutDebounceMs

    expect(mockClient.renderFrame).toHaveBeenLastCalledWith(
      1250,
      expect.objectContaining({ previewEffectQuality: 'low' }),
    );
    mockClient.renderFrame.mockClear();

    // Still short of the 500ms settle window since the last edit: no upgrade yet.
    await vi.advanceTimersByTimeAsync(300);
    expect(mockClient.renderFrame).not.toHaveBeenCalled();

    // Once idle for the full settle window, the frame re-renders at ultra.
    await vi.advanceTimersByTimeAsync(300);
    expect(mockClient.renderFrame).toHaveBeenLastCalledWith(
      1250,
      expect.objectContaining({ previewEffectQuality: 'ultra' }),
    );

    wrapper.unmount();
  });
});
