/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  buildNativeExportOptions,
  useExportProcess,
} from '~/composables/timeline/export/core/useExportProcess';
import { isTauriRuntime } from '~/utils/io/io-governor';

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
  createProjectHostApi: vi.fn(() => ({})),
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

vi.mock('~/utils/tauri-media-processing', () => ({
  getNativeFileHandlePath: vi.fn(() => '/fake/path.mp4'),
  nativeCancelMediaTask: vi.fn().mockResolvedValue(undefined),
  nativeExportTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/utils/native-monitor-scene', () => ({
  buildNativeMonitorScene: vi.fn().mockResolvedValue({
    width: 1920,
    height: 1080,
    time: 0,
    background: [0, 0, 0, 255],
    layers: [],
    audio_layers: [],
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  timelineStoreMock.isPlaying = false;
  timelineStoreMock.timelineDoc = { tracks: [], metadata: { fastcat: {} } };
});

describe('useExportProcess - playback guard', () => {
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
      {
        format: 'mp4',
        videoCodec: 'h264',
        audio: false,
        audioSampleRate: 48000,
        width: 1920,
        height: 1080,
      } as any,
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
      {
        format: 'mp4',
        videoCodec: 'h264',
        audio: false,
        audioSampleRate: 48000,
        width: 1920,
        height: 1080,
      } as any,
      fileHandle,
      () => {},
    );

    expect(stopPlaybackMock).not.toHaveBeenCalled();
  });

  it('pauses playback in tauri mode when playing', async () => {
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
      {
        format: 'mp4',
        videoCodec: 'h264',
        audio: false,
        audioSampleRate: 48000,
        width: 1920,
        height: 1080,
      } as any,
      fileHandle,
      () => {},
    );

    expect(stopPlaybackMock).toHaveBeenCalledOnce();
  });
});

describe('useExportProcess - format resolution', () => {
  it('builds native options for the advertised video export matrix', () => {
    const cases = [
      ['mp4', 'avc1.640032'],
      ['mp4', 'vp09.00.10.08'],
      ['mp4', 'av01.0.05M.08'],
      ['mkv', 'avc1.640032'],
      ['mkv', 'vp09.00.10.08'],
      ['mkv', 'av01.0.05M.08'],
    ] as const;

    for (const [format, videoCodec] of cases) {
      const options = buildNativeExportOptions({
        options: {
          format,
          videoCodec,
          audio: false,
          audioCodec: 'aac',
          audioSampleRate: 48000,
          audioBitrate: 128000,
          audioChannels: 'stereo',
          width: 1920,
          height: 1080,
          fps: 30,
          bitrate: 5_000_000,
        },
        rangeStartUs: 0,
        rangeEndUs: 1_000_000,
      });

      expect(options).toMatchObject({
        format,
        videoCodec,
        videoEnabled: true,
        audioEnabled: false,
      });
    }
  });

  it('builds native audio-only options for every Tauri audio export format', () => {
    const cases = [
      ['aac', 'aac'],
      ['opus', 'opus'],
      ['wav', 'pcm'],
      ['flac', 'flac'],
      ['mp3', 'mp3'],
    ] as const;

    for (const [format, audioCodec] of cases) {
      const options = buildNativeExportOptions({
        options: {
          format,
          videoCodec: 'none',
          audio: true,
          audioCodec,
          audioSampleRate: 48000,
          audioBitrate: 128000,
          audioChannels: 'stereo',
          width: 1920,
          height: 1080,
          fps: 30,
          bitrate: 5_000_000,
        },
        rangeStartUs: 0,
        rangeEndUs: 1_000_000,
      });

      expect(options).toMatchObject({
        format,
        audioCodec,
        videoEnabled: false,
        audioEnabled: true,
      });
    }
  });

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

    expect(mockExportTimeline).toHaveBeenCalledTimes(1);
    const callArgs = mockExportTimeline.mock.calls[0];
    expect(callArgs[0]).toBe(fileHandle);
    expect(callArgs[1]).toMatchObject({ format: 'aac' });
    expect(Array.isArray(callArgs[2])).toBe(true);
    expect(Array.isArray(callArgs[3])).toBe(true);
    expect(typeof callArgs[4]).toBe('string');
  });
});

describe('useExportProcess - platform routing', () => {
  it('always routes to nativeExportTimeline in Tauri mode', async () => {
    const { isTauriRuntime } = await import('~/utils/io/io-governor');
    vi.mocked(isTauriRuntime).mockReturnValue(true);

    const { nativeExportTimeline } = await import('~/utils/tauri-media-processing');
    const { getExportWorkerClient } = await import('~/utils/video-editor/worker-client');
    const mockExportTimeline = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getExportWorkerClient).mockReturnValue({
      client: {
        exportTimeline: mockExportTimeline,
      } as any,
      worker: {} as any,
    });

    const { buildVideoWorkerPayloadFromTracks, buildVideoWorkerPayload } =
      await import('~/composables/timeline/export/payloadBuilder');
    vi.mocked(buildVideoWorkerPayloadFromTracks).mockResolvedValue({
      clips: [
        {
          kind: 'clip',
          id: 'v1',
          layer: 0,
          source: { path: 'test.mp4' },
          transitionIn: { type: 'slide', durationUs: 1000000 },
        },
      ] as any,
      tracks: [],
    });
    vi.mocked(buildVideoWorkerPayload).mockReturnValue([
      {
        kind: 'clip',
        id: 'v1',
        layer: 0,
        transitionIn: { type: 'slide', durationUs: 1000000 },
      },
    ]);

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
      {
        format: 'mp4',
        videoCodec: 'h264',
        audio: false,
        audioSampleRate: 48000,
        width: 1920,
        height: 1080,
      } as any,
      fileHandle,
      () => {},
    );

    expect(nativeExportTimeline).toHaveBeenCalledTimes(1);
    expect(mockExportTimeline).not.toHaveBeenCalled();
  });

  it('marks mp3 exports as audio-only in Tauri mode', async () => {
    const { isTauriRuntime } = await import('~/utils/io/io-governor');
    vi.mocked(isTauriRuntime).mockReturnValue(true);

    const { nativeExportTimeline } = await import('~/utils/tauri-media-processing');

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
      {
        format: 'mp3',
        videoCodec: 'none',
        audio: true,
        audioCodec: 'mp3',
        audioSampleRate: 48000,
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: 5_000_000,
        audioBitrate: 192_000,
      } as any,
      fileHandle,
      () => {},
    );

    expect(nativeExportTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          format: 'mp3',
          audioCodec: 'mp3',
          videoEnabled: false,
        }),
      }),
    );
  });

  it('routes to worker client.exportTimeline in browser mode', async () => {
    const { isTauriRuntime } = await import('~/utils/io/io-governor');
    vi.mocked(isTauriRuntime).mockReturnValue(false);

    const { nativeExportTimeline } = await import('~/utils/tauri-media-processing');
    const { getExportWorkerClient } = await import('~/utils/video-editor/worker-client');
    const mockExportTimeline = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getExportWorkerClient).mockReturnValue({
      client: {
        exportTimeline: mockExportTimeline,
      } as any,
      worker: {} as any,
    });

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
      {
        format: 'mp4',
        videoCodec: 'h264',
        audio: false,
        audioSampleRate: 48000,
        width: 1920,
        height: 1080,
      } as any,
      fileHandle,
      () => {},
    );

    expect(nativeExportTimeline).not.toHaveBeenCalled();
    expect(mockExportTimeline).toHaveBeenCalledTimes(1);
  });
});
