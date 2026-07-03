/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineDocument } from '~/timeline/types';

const projectStoreMock = vi.hoisted(() => ({
  projectSettings: {
    project: {
      width: 3840,
      height: 2160,
      fps: 60,
      resolutionFormat: '2160p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: true,
      sampleRate: 48000,
    },
  },
  getFileByPath: vi.fn(),
  getFileHandleByPath: vi.fn(),
}));

const workspaceStoreMock = vi.hoisted(() => ({
  workspaceHandle: {},
}));

const buildVideoWorkerPayloadFromTracksMock = vi.hoisted(() => vi.fn());
const createProjectHostApiMock = vi.hoisted(() => vi.fn(() => ({ host: true })));
const setThumbnailHostApiMock = vi.hoisted(() => vi.fn());
const extractFrameToBlobMock = vi.hoisted(() => vi.fn());
const buildNativeMonitorSceneMock = vi.hoisted(() => vi.fn());
const nativeRenderTimelineFrameWebpMock = vi.hoisted(() => vi.fn());

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/timeline/application/workerPayloadBuilder', () => ({
  buildVideoWorkerPayloadFromTracks: buildVideoWorkerPayloadFromTracksMock,
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createProjectHostApi: createProjectHostApiMock,
}));

vi.mock('~/utils/video-editor/worker-client', () => ({
  setThumbnailHostApi: setThumbnailHostApiMock,
  getThumbnailWorkerClient: () => ({
    client: {
      extractFrameToBlob: extractFrameToBlobMock,
      cancelExport: vi.fn(),
      releaseFrameExtractor: vi.fn(),
    },
  }),
}));

vi.mock('~/utils/native-monitor-scene', () => ({
  buildNativeMonitorScene: buildNativeMonitorSceneMock,
}));

vi.mock('~/utils/tauri-media-processing', () => ({
  getNativeFileHandlePath: vi.fn(),
  nativeRenderTimelineFrameWebp: nativeRenderTimelineFrameWebpMock,
  nativeVideoFrameWebp: vi.fn(),
  nativeVideoFrameWebps: vi.fn(),
}));

const timelineDoc: TimelineDocument = {
  timebase: { fps: 30 },
  tracks: [
    {
      id: 'video-1',
      kind: 'video',
      name: 'Video 1',
      items: [],
    },
  ],
  metadata: {
    fastcat: {
      masterGain: 0.8,
      masterMuted: true,
      format: {
        width: 1280,
        height: 720,
        fps: 30,
        resolutionFormat: '720p',
        orientation: 'landscape',
        aspectRatio: '16:9',
        isCustomResolution: false,
        sampleRate: 48000,
        isAutoSettings: true,
        settingsSource: 'projectDefaults',
        useProjectSettings: true,
      },
    },
  },
};

describe('timeline frame media processors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildVideoWorkerPayloadFromTracksMock.mockResolvedValue({
      payload: [{ id: 'clip-1' }],
    });
    extractFrameToBlobMock.mockResolvedValue(new Blob(['web'], { type: 'image/webp' }));
    buildNativeMonitorSceneMock.mockResolvedValue({
      width: 3840,
      height: 2160,
      layers: [{ id: 'layer-1' }],
    });
    nativeRenderTimelineFrameWebpMock.mockResolvedValue(
      new Blob(['native'], { type: 'image/webp' }),
    );
  });

  it('web processor extracts the requested full-size export frame without thumbnail fitting', async () => {
    const { createWebMediaProcessor } = await import('~/media-processor/web.media-processor');
    const processor = createWebMediaProcessor();

    const blob = await processor.extractTimelineFrameBlob({
      timelineDoc,
      timeUs: 2_000_000,
      width: 3840,
      height: 2160,
      quality: 0.95,
      isExport: true,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(setThumbnailHostApiMock).toHaveBeenCalledWith({ host: true });
    expect(extractFrameToBlobMock).toHaveBeenCalledWith(
      2_000_000,
      3840,
      2160,
      [{ id: 'clip-1' }],
      0.95,
      undefined,
    );
  });

  it('native processor builds an export-quality scene and renders the requested full-size frame', async () => {
    const { createNativeMediaProcessor } = await import('~/media-processor/native.media-processor');
    const processor = createNativeMediaProcessor();

    const blob = await processor.extractTimelineFrameBlob({
      timelineDoc,
      timeUs: 2_000_000,
      width: 3840,
      height: 2160,
      quality: 0.95,
      isExport: true,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(buildNativeMonitorSceneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineDoc,
        masterGain: 0.8,
        masterMuted: false,
        previewScale: 1,
        includeAudio: false,
        isExport: true,
        fallbackFormat: expect.objectContaining({
          width: 3840,
          height: 2160,
          fps: 60,
        }),
      }),
    );
    expect(nativeRenderTimelineFrameWebpMock).toHaveBeenCalledWith({
      scene: {
        width: 3840,
        height: 2160,
        layers: [{ id: 'layer-1' }],
      },
      timeSec: 2,
      width: 3840,
      height: 2160,
      quality: 0.95,
    });
  });
});
