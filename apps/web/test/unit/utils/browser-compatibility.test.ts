import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateBrowserCompatibility } from '~/utils/browser-compatibility';

describe('evaluateBrowserCompatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports support when all critical browser APIs are available', () => {
    vi.stubGlobal('navigator', {
      storage: { getDirectory: vi.fn() },
      gpu: {},
    });
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('Worker', class WorkerMock {});
    vi.stubGlobal('OffscreenCanvas', class OffscreenCanvasMock {});
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('VideoDecoder', class VideoDecoderMock {});
    vi.stubGlobal('VideoEncoder', class VideoEncoderMock {});
    vi.stubGlobal('AudioDecoder', class AudioDecoderMock {});
    vi.stubGlobal('AudioEncoder', class AudioEncoderMock {});
    vi.stubGlobal('SharedArrayBuffer', class SharedArrayBufferMock {});
    vi.stubGlobal('crossOriginIsolated', true);

    const report = evaluateBrowserCompatibility();

    expect(report.isSupported).toBe(true);
    expect(report.criticalFailures).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('blocks the app when OPFS is unavailable', () => {
    vi.stubGlobal('navigator', {
      storage: {},
    });

    const report = evaluateBrowserCompatibility();

    expect(report.isSupported).toBe(false);
    expect(report.criticalFailures.map((check) => check.id)).toContain('opfs');
  });

  it('treats WebGPU as a warning instead of a blocker', () => {
    vi.stubGlobal('navigator', {
      storage: { getDirectory: vi.fn() },
    });
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('Worker', class WorkerMock {});
    vi.stubGlobal('OffscreenCanvas', class OffscreenCanvasMock {});
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('VideoDecoder', class VideoDecoderMock {});
    vi.stubGlobal('VideoEncoder', class VideoEncoderMock {});
    vi.stubGlobal('AudioDecoder', class AudioDecoderMock {});
    vi.stubGlobal('AudioEncoder', class AudioEncoderMock {});
    vi.stubGlobal('SharedArrayBuffer', class SharedArrayBufferMock {});
    vi.stubGlobal('crossOriginIsolated', true);

    const report = evaluateBrowserCompatibility();

    expect(report.isSupported).toBe(true);
    expect(report.warnings.map((check) => check.id)).toContain('webgpu');
  });
});
