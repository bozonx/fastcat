import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

describe('tauri media processing byte handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies native byte arrays into a standalone ArrayBuffer', async () => {
    const { __tauriMediaProcessingTestHooks } = await import('~/utils/tauri-media-processing');

    const buffer = __tauriMediaProcessingTestHooks.toBlobPart([1, 2, 3]);

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
  });

  it('decodes packed thumbnail responses from serialized number arrays', async () => {
    const { nativeVideoFrameWebps } = await import('~/utils/tauri-media-processing');
    invokeMock.mockResolvedValueOnce([2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);

    const blobs = await nativeVideoFrameWebps({
      sourcePath: '/tmp/video.mp4',
      timesSec: [0, 4],
      maxWidth: 160,
      maxHeight: 90,
      quality: 0.8,
    });

    expect(blobs).toHaveLength(2);
    expect(blobs[1]).toBeNull();
    expect(Array.from(new Uint8Array(await blobs[0]!.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('decodes native waveform responses from binary payloads', async () => {
    const { nativeMediaExtractPeaks } = await import('~/utils/tauri-media-processing');
    const bytes = new Uint8Array(8 + 4 * 4);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 2, true);
    view.setUint32(4, 2, true);
    view.setFloat32(8, 0.1, true);
    view.setFloat32(12, 0.2, true);
    view.setFloat32(16, 0.3, true);
    view.setFloat32(20, 0.4, true);
    invokeMock.mockResolvedValueOnce(bytes);

    const peaks = await nativeMediaExtractPeaks('/tmp/audio.wav', 2);

    expect(invokeMock).toHaveBeenCalledWith('native_media_extract_peaks', {
      path: '/tmp/audio.wav',
      maxLength: 2,
    });
    expect(peaks).toHaveLength(2);
    expect(Array.from(peaks[0]!)).toEqual(
      expect.arrayContaining([expect.closeTo(0.1), expect.closeTo(0.2)]),
    );
    expect(Array.from(peaks[1]!)).toEqual(
      expect.arrayContaining([expect.closeTo(0.3), expect.closeTo(0.4)]),
    );
  });
});
