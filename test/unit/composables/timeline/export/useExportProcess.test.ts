/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useExportProcess } from '~/composables/timeline/export/core/useExportProcess';

const stopPlaybackMock = vi.fn();

const timelineStoreMock = {
  timelineDoc: { tracks: [], metadata: { fastcat: {} } },
  timelineFormat: null,
  audioMuted: false,
  masterGain: 1,
  isPlaying: false,
  stopPlayback: stopPlaybackMock,
};

const projectStoreMock = {
  currentProjectId: 'project-1',
  getFileHandleByPath: vi.fn(),
  getFileByPath: vi.fn(),
};

const workspaceStoreMock = {
  workspaceHandle: null,
  resolvedStorageTopology: null,
  userSettings: { optimization: { pixiRenderer: 'webgl' as const } },
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceStoreMock),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => projectStoreMock),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => timelineStoreMock),
}));

vi.mock('~/utils/io/io-governor', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

vi.mock('~/utils/video-editor/worker-client', () => ({
  broadcastPixiRendererPreference: vi.fn(),
  getExportWorkerClient: vi.fn(() => ({
    client: {
      exportTimeline: vi.fn().mockResolvedValue(undefined),
    },
    worker: {},
  })),
  registerExportTaskHostApi: vi.fn(),
  setExportHostApi: vi.fn(),
  unregisterExportTaskHostApi: vi.fn(),
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createVideoCoreHostApi: vi.fn(() => ({})),
}));

vi.mock('~/composables/timeline/export/payloadBuilder', () => ({
  buildVideoWorkerPayload: vi.fn(() => [{ kind: 'clip', id: 'v1', layer: 0 }]),
  buildVideoWorkerPayloadFromTracks: vi.fn(() => ({
    clips: [{ kind: 'clip' as const, id: 'v1', layer: 0, source: { path: 'test.mp4' } }],
    tracks: [],
  })),
  toWorkerTimelineClips: vi.fn(() => []),
  trimWorkerClipToRange: vi.fn((c) => c),
}));

vi.mock('~/utils/audio/track-bus', () => ({
  buildEffectiveAudioClipItems: vi.fn(() => []),
}));

describe('useExportProcess - playback guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timelineStoreMock.isPlaying = false;
    timelineStoreMock.timelineDoc = { tracks: [], metadata: { fastcat: {} } };
  });

  it('pauses playback before export in browser mode', async () => {
    timelineStoreMock.isPlaying = true;
    const { isTauriRuntime } = await import('~/utils/io/io-governor');
    (isTauriRuntime as any).mockReturnValue(false);

    const state = {
      activeExportTaskId: ref<string | null>(null),
      exportPhase: ref<'preparing' | 'encoding' | 'saving' | null>(null),
      exportWarnings: ref<string[]>([]),
      isExporting: ref(false),
      cancelRequested: ref(false),
    };

    const { exportTimelineToFile } = useExportProcess(
      state.activeExportTaskId,
      state.exportPhase,
      state.exportWarnings,
      state.isExporting,
      state.cancelRequested,
    );

    const fileHandle = { createWritable: vi.fn() } as any;
    await exportTimelineToFile(
      { format: 'mp4', videoCodec: 'h264', audio: false, audioSampleRate: 48000 } as any,
      fileHandle,
      () => {},
    );

    expect(stopPlaybackMock).toHaveBeenCalledTimes(1);
  });

  it('does not pause playback when already stopped', async () => {
    timelineStoreMock.isPlaying = false;
    const { isTauriRuntime } = await import('~/utils/io/io-governor');
    (isTauriRuntime as any).mockReturnValue(false);

    const state = {
      activeExportTaskId: ref<string | null>(null),
      exportPhase: ref<'preparing' | 'encoding' | 'saving' | null>(null),
      exportWarnings: ref<string[]>([]),
      isExporting: ref(false),
      cancelRequested: ref(false),
    };

    const { exportTimelineToFile } = useExportProcess(
      state.activeExportTaskId,
      state.exportPhase,
      state.exportWarnings,
      state.isExporting,
      state.cancelRequested,
    );

    const fileHandle = { createWritable: vi.fn() } as any;
    await exportTimelineToFile(
      { format: 'mp4', videoCodec: 'h264', audio: false, audioSampleRate: 48000 } as any,
      fileHandle,
      () => {},
    );

    expect(stopPlaybackMock).not.toHaveBeenCalled();
  });

  it('does not pause playback in tauri mode even when playing', async () => {
    timelineStoreMock.isPlaying = true;
    const { isTauriRuntime } = await import('~/utils/io/io-governor');
    (isTauriRuntime as any).mockReturnValue(true);

    const state = {
      activeExportTaskId: ref<string | null>(null),
      exportPhase: ref<'preparing' | 'encoding' | 'saving' | null>(null),
      exportWarnings: ref<string[]>([]),
      isExporting: ref(false),
      cancelRequested: ref(false),
    };

    const { exportTimelineToFile } = useExportProcess(
      state.activeExportTaskId,
      state.exportPhase,
      state.exportWarnings,
      state.isExporting,
      state.cancelRequested,
    );

    const fileHandle = { createWritable: vi.fn() } as any;
    await exportTimelineToFile(
      { format: 'mp4', videoCodec: 'h264', audio: false, audioSampleRate: 48000 } as any,
      fileHandle,
      () => {},
    );

    expect(stopPlaybackMock).not.toHaveBeenCalled();
  });
});

describe('useExportProcess - format resolution', () => {
  it('calls exportTimeline with format aac when aac option is provided', async () => {
    const state = {
      activeExportTaskId: ref<string | null>(null),
      exportPhase: ref<'preparing' | 'encoding' | 'saving' | null>(null),
      exportWarnings: ref<string[]>([]),
      isExporting: ref(false),
      cancelRequested: ref(false),
    };

    const { exportTimelineToFile } = useExportProcess(
      state.activeExportTaskId,
      state.exportPhase,
      state.exportWarnings,
      state.isExporting,
      state.cancelRequested,
    );

    const { getExportWorkerClient } = await import('~/utils/video-editor/worker-client');
    const mockExportTimeline = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getExportWorkerClient).mockReturnValue({
      client: {
        exportTimeline: mockExportTimeline,
      } as any,
      worker: {} as any,
    });

    const fileHandle = { createWritable: vi.fn() } as any;
    await exportTimelineToFile(
      { format: 'aac', videoCodec: 'none', audio: true, audioSampleRate: 44100 } as any,
      fileHandle,
      () => {},
    );

    expect(mockExportTimeline).toHaveBeenCalledWith(
      fileHandle,
      expect.objectContaining({ format: 'aac' }),
      expect.any(Array),
      expect.any(Array),
      expect.any(String),
    );
  });
});
