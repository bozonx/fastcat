/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { createMonitorCompositorRuntime } from '~/composables/monitor/useMonitorCore.compositor';
import type { PreviewRenderOptions } from '~/utils/video-editor/worker-rpc';

function makeOptions(client: unknown = null) {
  return {
    client: client as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI | null,
    containerEl: { value: null as HTMLDivElement | null },
    renderWidth: { value: 1920 },
    renderHeight: { value: 1080 },
    designWidth: { value: 3840 },
    designHeight: { value: 2160 },
    isUnmounted: () => false,
    getPreviewRenderOptions: (): PreviewRenderOptions => ({
      quality: 0.9,
      drawDebugOverlays: false,
      showSafeAreas: false,
      showTitleSafe: false,
      showActionSafe: false,
      showCenterCrosshair: false,
      showFrameCounter: false,
      showGrid: false,
      gridType: 'thirds',
      showGuides: false,
      showMarkers: false,
      showClipLabels: false,
      showTimecode: false,
      showWaveform: false,
      waveformHeight: 0.2,
      waveformColor: '#00ff00',
      showScopes: false,
      scopeSize: 0.2,
      scopeType: 'vectorscope',
      showAudioMeter: false,
      audioMeterHeight: 0.1,
      audioMeterColor: '#00ff00',
      showMonitorOverlay: false,
      monitorOverlayOpacity: 0.5,
      monitorOverlayColor: '#000000',
      showMonitorBorder: false,
      monitorBorderColor: '#000000',
      showMonitorBackground: false,
      monitorBackgroundColor: '#000000',
      showMonitorSafeAreas: false,
      monitorSafeAreaColor: '#000000',
      showMonitorActionSafe: false,
      monitorActionSafeColor: '#000000',
      showMonitorTitleSafe: false,
      monitorTitleSafeColor: '#000000',
      showMonitorCenterCrosshair: false,
      monitorCenterCrosshairColor: '#000000',
      showMonitorFrameCounter: false,
      monitorFrameCounterColor: '#000000',
      showMonitorGrid: false,
      monitorGridColor: '#000000',
      showMonitorGuides: false,
      monitorGuidesColor: '#000000',
      showMonitorMarkers: false,
      monitorMarkersColor: '#000000',
      showMonitorClipLabels: false,
      monitorClipLabelsColor: '#000000',
      showMonitorTimecode: false,
      monitorTimecodeColor: '#000000',
      showMonitorWaveform: false,
      monitorWaveformColor: '#000000',
      showMonitorScopes: false,
      monitorScopesColor: '#000000',
      showMonitorAudioMeter: false,
      monitorAudioMeterColor: '#000000',
      showMonitorOverlay2: false,
      monitorOverlay2Opacity: 0.5,
      monitorOverlay2Color: '#000000',
      showMonitorBorder2: false,
      monitorBorder2Color: '#000000',
      showMonitorBackground2: false,
      monitorBackground2Color: '#000000',
      showMonitorSafeAreas2: false,
      monitorSafeAreas2Color: '#000000',
      showMonitorActionSafe2: false,
      monitorActionSafe2Color: '#000000',
      showMonitorTitleSafe2: false,
      monitorTitleSafe2Color: '#000000',
      showMonitorCenterCrosshair2: false,
      monitorCenterCrosshair2Color: '#000000',
      showMonitorFrameCounter2: false,
      monitorFrameCounter2Color: '#000000',
      showMonitorGrid2: false,
      monitorGrid2Color: '#000000',
      showMonitorGuides2: false,
      monitorGuides2Color: '#000000',
      showMonitorMarkers2: false,
      monitorMarkers2Color: '#000000',
      showMonitorClipLabels2: false,
      monitorClipLabels2Color: '#000000',
      showMonitorTimecode2: false,
      monitorTimecode2Color: '#000000',
      showMonitorWaveform2: false,
      monitorWaveform2Color: '#000000',
      showMonitorScopes2: false,
      monitorScopes2Color: '#000000',
      showMonitorAudioMeter2: false,
      monitorAudioMeter2Color: '#000000',
      pixiRenderer: 'webgl',
    }),
  };
}

describe('createMonitorCompositorRuntime', () => {
  it('does not crash when client is null (Tauri mode)', async () => {
    const runtime = createMonitorCompositorRuntime(makeOptions(null));

    await expect(runtime.ensureReady()).resolves.toBeUndefined();
    expect(runtime.isReady()).toBe(false);

    // scheduleRender should silently return without a client
    expect(() => runtime.scheduleRender(0)).not.toThrow();

    await expect(runtime.destroy()).resolves.toBeUndefined();
  });

  it('calls destroyCompositor on destroy when client is present', async () => {
    const mockClient = {
      destroyCompositor: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI;

    const runtime = createMonitorCompositorRuntime(makeOptions(mockClient));
    await runtime.destroy();
    expect(mockClient.destroyCompositor).toHaveBeenCalled();
  });

  it('initializes the preview compositor with project design dimensions', async () => {
    const mockClient = {
      destroyCompositor: vi.fn().mockResolvedValue(undefined),
      initCompositor: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI;
    const options = makeOptions(mockClient);
    options.containerEl.value = document.createElement('div');
    HTMLCanvasElement.prototype.transferControlToOffscreen = vi
      .fn()
      .mockReturnValue({} as OffscreenCanvas);

    const runtime = createMonitorCompositorRuntime(options);
    await runtime.ensureReady();

    expect(mockClient.initCompositor).toHaveBeenCalledWith(
      expect.anything(),
      1920,
      1080,
      '#000',
      'webgl',
      3840,
      2160,
    );
  });

  it('throttles video prewarm while rendering playback frames', async () => {
    const mockClient = {
      renderFrame: vi.fn().mockResolvedValue({}),
      prewarmVideoFrames: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI;
    const runtime = createMonitorCompositorRuntime(makeOptions(mockClient));

    runtime.scheduleRender(0, { prewarm: true });
    await vi.waitFor(() => expect(mockClient.renderFrame).toHaveBeenCalledTimes(1));
    runtime.scheduleRender(100_000, { prewarm: true });
    await vi.waitFor(() => expect(mockClient.renderFrame).toHaveBeenCalledTimes(2));
    runtime.scheduleRender(300_000, { prewarm: true });
    await vi.waitFor(() => expect(mockClient.renderFrame).toHaveBeenCalledTimes(3));

    expect(mockClient.prewarmVideoFrames).toHaveBeenCalledTimes(2);
    expect(mockClient.prewarmVideoFrames).toHaveBeenNthCalledWith(1, 0);
    expect(mockClient.prewarmVideoFrames).toHaveBeenNthCalledWith(2, 300_000);
  });

  it('does not prewarm video frames for passive renders', async () => {
    const mockClient = {
      renderFrame: vi.fn().mockResolvedValue({}),
      prewarmVideoFrames: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI;
    const runtime = createMonitorCompositorRuntime(makeOptions(mockClient));

    runtime.scheduleRender(1_000_000);
    await vi.waitFor(() => expect(mockClient.renderFrame).toHaveBeenCalledTimes(1));

    expect(mockClient.prewarmVideoFrames).not.toHaveBeenCalled();
  });
});
