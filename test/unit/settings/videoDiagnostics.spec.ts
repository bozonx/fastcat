import { describe, expect, it } from 'vitest';

import { createVideoDiagnosticsSnapshot } from '~/utils/settings/videoDiagnostics';

describe('videoDiagnostics', () => {
  it('builds a healthy summary when compositor and WebCodecs paths are available', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      audioEncoderSupported: true,
      encodingInfo: {
        powerEfficient: true,
        smooth: true,
        supported: true,
      },
      offscreenCanvas2dSupported: true,
      offscreenCanvasSupported: true,
      videoEncoderHardwareSupported: true,
      videoEncoderSoftwareSupported: true,
      webGlInfo: {
        maxTextureSize: 16384,
        renderer: 'ANGLE Test Renderer',
        shadingLanguageVersion: 'WebGL GLSL ES 3.00',
        supported: true,
        vendor: 'Test Vendor',
        version: 'WebGL 2.0',
      },
      webGpuInfo: {
        adapterAvailable: true,
        architecture: 'test-arch',
        description: 'Test GPU',
        device: 'Test Device',
        featureCount: 12,
        maxBufferSize: 1024,
        maxTextureDimension2D: 8192,
        vendor: 'Test Vendor',
      },
    });

    expect(snapshot.summary.tone).toBe('success');
    expect(snapshot.summary.label).toContain('healthy');
    expect(snapshot.sections).toHaveLength(3);
    expect(snapshot.sections[0]?.title).toBe('Preview compositor');
    expect(snapshot.sections[1]?.title).toBe('WebCodecs export path');
    expect(snapshot.sections[2]?.status.tone).toBe('neutral');
    expect(snapshot.sections[0]?.items.find((item) => item.label === 'GPU renderer')?.value).toBe(
      'ANGLE Test Renderer',
    );
  });

  it('reports limited capabilities when WebGL and WebCodecs are unavailable', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      audioEncoderSupported: false,
      encodingInfo: null,
      offscreenCanvas2dSupported: false,
      offscreenCanvasSupported: false,
      videoEncoderHardwareSupported: false,
      videoEncoderSoftwareSupported: false,
      webGlInfo: {
        maxTextureSize: null,
        renderer: null,
        shadingLanguageVersion: null,
        supported: false,
        vendor: null,
        version: null,
      },
      webGpuInfo: {
        adapterAvailable: false,
        architecture: null,
        description: null,
        device: null,
        featureCount: null,
        maxBufferSize: null,
        maxTextureDimension2D: null,
        vendor: null,
      },
    });

    expect(snapshot.summary.tone).toBe('danger');
    expect(snapshot.sections[0]?.status.tone).toBe('danger');
    expect(snapshot.sections[1]?.status.tone).toBe('danger');
    expect(snapshot.sections[2]?.status.label).toContain('No WebGPU adapter');
    expect(
      snapshot.sections[0]?.items.find((item) => item.label === 'Compositor path')?.value,
    ).toBe('Limited or fallback-only');
  });
});
