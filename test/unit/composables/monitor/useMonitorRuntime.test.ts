import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestingPinia } from '@pinia/testing';
import { ref } from 'vue';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';

// Mocks for composables used inside useMonitorRuntime
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/editor' }),
}));

vi.mock('~/composables/monitor/useMonitorTimeline', () => ({
  useMonitorTimeline: () => ({
    videoItems: ref([]),
    workerTimelineClips: ref([]),
    workerAudioClips: ref([]),
    workerTimelinePayload: ref(null),
    rawWorkerTimelineClips: ref([
      { id: 'clip-text-1', clipType: 'text', text: 'Hello' },
      { id: 'clip-adj-1', clipType: 'adjustment' },
    ]),
    rawWorkerAudioClips: ref([]),
    safeDurationTicks: ref(10000000),
    clipSourceSignature: ref(''),
    clipLayoutSignature: ref(''),
    clipContentSignature: ref(''),
    activeLayoutSignature: ref(''),
    audioClipSourceSignature: ref(''),
    audioClipLayoutSignature: ref(''),
    masterAudioEffects: ref([]),
  }),
}));

vi.mock('~/composables/monitor/useMonitorDisplay', () => ({
  useMonitorDisplay: () => ({
    containerEl: ref(null),
    renderWidth: ref(1920),
    renderHeight: ref(1080),
    exportWidth: ref(1920),
    exportHeight: ref(1080),
    updateCanvasDisplaySize: vi.fn(),
  }),
}));

vi.mock('~/composables/monitor/useMonitorCore', () => ({
  useMonitorCore: () => ({
    isLoading: ref(false),
    loadError: ref(null),
    previewEffectsEnabled: ref(true),
    scheduleRender: vi.fn(),
    scheduleBuild: vi.fn(),
    clampToTimeline: vi.fn((t) => t),
    updateStoreTime: vi.fn(),
    audioEngine: { resumeContext: vi.fn() },
    useProxyInMonitor: ref(false),
    setCurrentTimeProvider: vi.fn(),
    beginInteractiveWindow: vi.fn(),
  }),
}));

vi.mock('~/composables/monitor/useMonitorPlayback', () => ({
  useMonitorPlayback: () => ({
    uiCurrentTimeTicks: ref(0),
    getLocalCurrentTimeTicks: vi.fn().mockReturnValue(0),
    setTimecodeEl: vi.fn(),
  }),
}));

vi.mock('~/composables/monitor/useMonitorSnapshot', () => ({
  useMonitorSnapshot: () => ({
    isSavingStopFrame: ref(false),
    createStopFrameSnapshot: vi.fn(),
  }),
}));

describe('useMonitorRuntime', () => {
  beforeEach(() => {
    createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        selection: {
          selectedEntity: { source: 'timeline', kind: 'clip', itemId: 'clip-text-1' },
        },
      },
    });
  });

  it('initializes and returns stores and clip selection state', () => {
    const runtime = useMonitorRuntime();

    expect(runtime.renderWidth.value).toBe(1920);
    expect(runtime.renderHeight.value).toBe(1080);
    expect(runtime.isTextClipSelected.value).toBe(true);
    expect(runtime.isAdjustmentClipSelected.value).toBe(false);
  });
});
