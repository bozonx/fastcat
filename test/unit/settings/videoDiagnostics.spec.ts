/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { createVideoDiagnosticsSnapshot } from '~/utils/settings/videoDiagnostics';

describe('videoDiagnostics', () => {
  it('builds a healthy summary when compositor and WebCodecs paths are available', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      audioEncoderSupported: true,
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
        architecture: 'test-arch',
        description: 'Test GPU',
        device: 'Test Device',
        deviceAvailable: true,
        featureCount: 12,
        maxBufferSize: 1024,
        maxTextureDimension2D: 8192,
        vendor: 'Test Vendor',
      },
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
  });

  it('reports limited capabilities when WebGL and WebCodecs are unavailable', () => {
    const snapshot = createVideoDiagnosticsSnapshot({
      audioEncoderSupported: false,
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
        architecture: null,
        description: null,
        device: null,
        deviceAvailable: false,
        featureCount: null,
        maxBufferSize: null,
        maxTextureDimension2D: null,
        vendor: null,
      },
    });

    expect(snapshot.summary.tone).toBe('danger');
    expect(snapshot.sections[0]?.status.tone).toBe('danger');
    expect(snapshot.sections[2]?.status.tone).toBe('danger');
    expect(snapshot.sections[3]?.status.label).toContain('No WebGPU adapter');
    expect(
      snapshot.sections[0]?.items.find((item) => item.label === 'Compositor path')?.value,
    ).toBe('Limited or fallback-only');
  });
});
