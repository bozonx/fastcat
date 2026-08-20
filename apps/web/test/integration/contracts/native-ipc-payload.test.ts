// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeTimelineExportOptions } from '~/utils/tauri-media-processing';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn(async () => vi.fn()));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

function sceneFixture() {
  return {
    width: 1920,
    height: 1080,
    previewFps: 30,
    layers: [
      {
        id: 'bg',
        kind: 'background',
        timelineStartSec: 0,
        timelineEndSec: 1,
        z: 0,
        color: '#101010',
      },
    ],
    videoTracks: [],
    audioLayers: [],
    audioTracks: [],
    audioMasterGain: 1,
    audioMasterMuted: false,
    masterEffects: [],
    audioMasterEffects: [],
  };
}

describe('native IPC payload contracts', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockClear();
  });

  it('sends camelCase timeline export payload accepted by the Tauri command layer', async () => {
    const { nativeExportTimeline } = await import('~/utils/tauri-media-processing');
    const scene = sceneFixture();
    const options: NativeTimelineExportOptions = {
      width: 1920,
      height: 1080,
      fps: 29.97,
      startSec: 0.25,
      endSec: 2.5,
      videoCodec: 'avc1.640032',
      videoBitrateBps: 8_000_000,
      format: 'mp4',
      audioEnabled: true,
      audioCodec: 'aac',
      audioBitrateBps: 192_000,
      audioChannels: 2,
      audioSampleRate: 48_000,
      videoEnabled: true,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      metadataTitle: 'Title',
      metadataDescription: null,
      metadataAuthor: 'Author',
      metadataTags: 'one,two',
      exportAlpha: false,
      fastStart: true,
      videoMaxBitrateBps: 10_000_000,
      videoMinBitrateBps: null,
    };

    await nativeExportTimeline({
      taskId: 'export-task',
      scene,
      targetPath: '/tmp/out.mp4',
      options,
      onProgress: vi.fn(),
      onWarning: vi.fn(),
    });

    expect(invokeMock).toHaveBeenCalledWith('native_timeline_export', {
      taskId: 'export-task',
      scene,
      targetPath: '/tmp/out.mp4',
      options,
    });
    expect(listenMock).toHaveBeenCalledWith(
      'native-timeline-export:progress',
      expect.any(Function),
    );
    expect(listenMock).toHaveBeenCalledWith('native-timeline-export:warning', expect.any(Function));
  });

  it('sends render-frame payload and normalizes native bytes to a WebP blob', async () => {
    const { nativeRenderTimelineFrameWebp } = await import('~/utils/tauri-media-processing');
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const scene = sceneFixture();
    invokeMock.mockResolvedValue(bytes);

    const blob = await nativeRenderTimelineFrameWebp({
      scene,
      timeSec: 1.25,
      width: 1280,
      height: 720,
      quality: 0.82,
    });

    expect(invokeMock).toHaveBeenCalledWith('native_timeline_render_frame_webp', {
      scene,
      timeSec: 1.25,
      width: 1280,
      height: 720,
      quality: 0.82,
    });
    expect(blob.type).toBe('image/webp');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...bytes]);
  });
});
