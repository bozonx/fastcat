/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { createVideoDiagnosticsSnapshot } from '~/utils/settings/videoDiagnostics';

type SnapshotParams = Parameters<typeof createVideoDiagnosticsSnapshot>[0];

function healthyParams(): SnapshotParams {
  return {
    audioEncoderSupported: true,
    crossOriginIsolated: false,
    createImageBitmapSupported: true,
    encodingInfo: { powerEfficient: true, smooth: true, supported: true },
    mediaCapabilitiesEncodingSupported: true,
    offscreenCanvas2dSupported: true,
    offscreenCanvasSupported: true,
    offscreenWebGlInfo: {
      context: 'webgl2',
      maxRenderbufferSize: 16384,
      maxTextureSize: 16384,
      renderer: 'ANGLE Test Renderer',
      shadingLanguageVersion: 'WebGL GLSL ES 3.00',
      supported: true,
      vendor: 'Test Vendor',
      version: 'WebGL 2.0',
    },
    videoDecoderSupported: true,
    videoEncoderHardwareSupported: true,
    videoEncoderSoftwareSupported: true,
    videoCodecDiagnostics: [],
    webGlInfo: {
      context: 'webgl2',
      maxRenderbufferSize: 16384,
      maxTextureSize: 16384,
      renderer: 'ANGLE Test Renderer',
      shadingLanguageVersion: 'WebGL GLSL ES 3.00',
      supported: true,
      vendor: 'Test Vendor',
      version: 'WebGL 2.0',
    },
    webGpuInfo: {
      adapterAvailable: true,
      adapterRequestError: null,
      adapterRequestStatus: 'Available',
      apiAvailable: true,
      architecture: 'test-arch',
      description: 'Test GPU',
      device: 'Test Device',
      deviceAvailable: true,
      deviceRequestError: null,
      deviceRequestStatus: 'Available',
      featureCount: 12,
      maxBufferSize: 1024,
      maxTextureDimension2D: 8192,
      vendor: 'Test Vendor',
    },
    secureContext: true,
    selectedVideoCodec: 'avc1.640032',
    userAgent: 'test',
  };
}

describe('videoDiagnostics', () => {
  it('builds a healthy summary when compositor and WebCodecs paths are available', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      audioEncoderSupported: true,
      crossOriginIsolated: false,
      createImageBitmapSupported: true,
      encodingInfo: {
        powerEfficient: true,
        smooth: true,
        supported: true,
      },
      mediaCapabilitiesEncodingSupported: true,
      offscreenCanvas2dSupported: true,
      offscreenCanvasSupported: true,
      offscreenWebGlInfo: {
        context: 'webgl2',
        maxRenderbufferSize: 16384,
        maxTextureSize: 16384,
        renderer: 'ANGLE Test Renderer',
        shadingLanguageVersion: 'WebGL GLSL ES 3.00',
        supported: true,
        vendor: 'Test Vendor',
        version: 'WebGL 2.0',
      },
      videoDecoderSupported: true,
      videoEncoderHardwareSupported: true,
      videoEncoderSoftwareSupported: true,
      videoCodecDiagnostics: [
        {
          decodeSupported: true,
          hardwareEncodeSupported: true,
          label: 'H.264 (High)',
          softwareEncodeSupported: true,
          value: 'avc1.640032',
        },
        {
          decodeSupported: true,
          hardwareEncodeSupported: false,
          label: 'VP9',
          softwareEncodeSupported: true,
          value: 'vp09.00.10.08',
        },
      ],
      webGlInfo: {
        context: 'webgl2',
        maxRenderbufferSize: 16384,
        maxTextureSize: 16384,
        renderer: 'ANGLE Test Renderer',
        shadingLanguageVersion: 'WebGL GLSL ES 3.00',
        supported: true,
        vendor: 'Test Vendor',
        version: 'WebGL 2.0',
      },
      webGpuInfo: {
        adapterAvailable: true,
        adapterRequestError: null,
        adapterRequestStatus: 'Available',
        apiAvailable: true,
        architecture: 'test-arch',
        description: 'Test GPU',
        device: 'Test Device',
        deviceAvailable: true,
        deviceRequestError: null,
        deviceRequestStatus: 'Available',
        featureCount: 12,
        maxBufferSize: 1024,
        maxTextureDimension2D: 8192,
        vendor: 'Test Vendor',
      },
      secureContext: true,
      selectedVideoCodec: 'avc1.640032',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    });

    expect(snapshot.summary.tone).toBe('success');
    expect(snapshot.summary.label).toContain('healthy');
    expect(snapshot.sections).toHaveLength(4);
    expect(snapshot.sections[0]?.title).toBe('Preview compositor');
    expect(snapshot.sections[1]?.title).toBe('Import and decode path');
    expect(snapshot.sections[2]?.title).toBe('WebCodecs export path');
    expect(snapshot.sections[3]?.status.tone).toBe('neutral');
    expect(snapshot.sections[0]?.items.find((item) => item.label === 'GPU renderer')?.value).toBe(
      'ANGLE Test Renderer',
    );
    expect(
      snapshot.sections[0]?.items.find((item) => item.label === 'Compositor path')?.value,
    ).toBe('Pixi GPU renderer (WebGPU preferred, WebGL fallback)');
    expect(
      snapshot.sections[2]?.items.find((item) => item.label === 'H.264 (High) (avc1.640032)')
        ?.value,
    ).toBe('HW encode: Yes | SW encode: Yes | Decode: Yes');
  });

  it('reports limited capabilities when WebGL and WebCodecs are unavailable', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      audioEncoderSupported: false,
      crossOriginIsolated: false,
      createImageBitmapSupported: false,
      encodingInfo: null,
      mediaCapabilitiesEncodingSupported: false,
      offscreenCanvas2dSupported: false,
      offscreenCanvasSupported: false,
      offscreenWebGlInfo: {
        context: null,
        maxRenderbufferSize: null,
        maxTextureSize: null,
        renderer: null,
        shadingLanguageVersion: null,
        supported: false,
        vendor: null,
        version: null,
      },
      videoDecoderSupported: false,
      videoEncoderHardwareSupported: false,
      videoEncoderSoftwareSupported: false,
      videoCodecDiagnostics: [
        {
          decodeSupported: false,
          hardwareEncodeSupported: false,
          label: 'H.264 (High)',
          softwareEncodeSupported: false,
          value: 'avc1.640032',
        },
      ],
      webGlInfo: {
        context: null,
        maxRenderbufferSize: null,
        maxTextureSize: null,
        renderer: null,
        shadingLanguageVersion: null,
        supported: false,
        vendor: null,
        version: null,
      },
      webGpuInfo: {
        adapterAvailable: false,
        adapterRequestError: null,
        adapterRequestStatus: 'requestAdapter returned null',
        apiAvailable: true,
        architecture: null,
        description: null,
        device: null,
        deviceAvailable: false,
        deviceRequestError: null,
        deviceRequestStatus: 'Not requested',
        featureCount: null,
        maxBufferSize: null,
        maxTextureDimension2D: null,
        vendor: null,
      },
      secureContext: true,
      selectedVideoCodec: 'avc1.640032',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    });

    expect(snapshot.summary.tone).toBe('danger');
    expect(snapshot.sections[0]?.status.tone).toBe('danger');
    expect(snapshot.sections[2]?.status.tone).toBe('danger');
    expect(snapshot.sections[3]?.status.label).toContain('requestAdapter returned null');
    expect(
      snapshot.sections[3]?.items.find((item) => item.label === 'Linux Chromium hint')?.value,
    ).toContain('chrome://flags/#enable-vulkan');
    expect(
      snapshot.sections[0]?.items.find((item) => item.label === 'Compositor path')?.value,
    ).toBe('Limited or fallback-only');
  });

  it('omits the zero-copy coverage section when no compositor perf snapshot is provided', () => {
    const snapshot = createVideoDiagnosticsSnapshot(healthyParams());
    expect(snapshot.sections.some((s) => s.title === 'GPU zero-copy coverage')).toBe(false);
  });

  it('reports "not sampled yet" when the snapshot has no effect operations', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      ...healthyParams(),
      compositorPerf: {
        overall: { zeroCopy: 0, bitmapFallback: 0, rawFallback: 0, total: 0, zeroCopyPct: 0 },
        byPath: {},
      },
    });
    const section = snapshot.sections.find((s) => s.title === 'GPU zero-copy coverage');
    expect(section?.status.tone).toBe('neutral');
  });

  it('surfaces full zero-copy coverage as a success section', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      ...healthyParams(),
      compositorPerf: {
        overall: { zeroCopy: 200, bitmapFallback: 0, rawFallback: 0, total: 200, zeroCopyPct: 100 },
        byPath: {
          effects: { zeroCopy: 200, bitmapFallback: 0, rawFallback: 0, total: 200 },
        },
      },
    });
    const section = snapshot.sections.find((s) => s.title === 'GPU zero-copy coverage');
    expect(section?.status.tone).toBe('success');
    expect(section?.status.label).toContain('100% zero-copy');
    expect(section?.items.find((i) => i.label === 'Zero-copy')?.value).toBe('200 (100%)');
  });

  it('flags bitmap fallback as a warning and raw fallback as danger', () => {
    const warnSnapshot = createVideoDiagnosticsSnapshot({
      ...healthyParams(),
      compositorPerf: {
        overall: { zeroCopy: 90, bitmapFallback: 10, rawFallback: 0, total: 100, zeroCopyPct: 90 },
        byPath: {},
      },
    });
    expect(
      warnSnapshot.sections.find((s) => s.title === 'GPU zero-copy coverage')?.status.tone,
    ).toBe('warning');

    const dangerSnapshot = createVideoDiagnosticsSnapshot({
      ...healthyParams(),
      compositorPerf: {
        overall: { zeroCopy: 90, bitmapFallback: 5, rawFallback: 5, total: 100, zeroCopyPct: 90 },
        byPath: {},
      },
    });
    expect(
      dangerSnapshot.sections.find((s) => s.title === 'GPU zero-copy coverage')?.status.tone,
    ).toBe('danger');
  });
});
