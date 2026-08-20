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
      pixiRenderer: 'webgpu',
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
      'transparent',
      'webgpu',
      3840,
      2160,
    );
  });

  it('serializes simultaneous compositor initialization requests', async () => {
    let resolveInit: (() => void) | undefined;
    const mockClient = {
      destroyCompositor: vi.fn().mockResolvedValue(undefined),
      initCompositor: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveInit = resolve;
          }),
      ),
    } as unknown as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI;
    const options = makeOptions(mockClient);
    options.containerEl.value = document.createElement('div');
    HTMLCanvasElement.prototype.transferControlToOffscreen = vi
      .fn()
      .mockReturnValue({} as OffscreenCanvas);

    const runtime = createMonitorCompositorRuntime(options);
    const first = runtime.ensureReady();
    const second = runtime.ensureReady();

    await vi.waitFor(() => expect(mockClient.initCompositor).toHaveBeenCalledTimes(1));
    resolveInit?.();
    await Promise.all([first, second]);

    expect(mockClient.destroyCompositor).toHaveBeenCalledTimes(1);
  });

  it('throttles video prewarm by wall clock, surviving backward seeks', async () => {
    const mockClient = {
      renderFrame: vi.fn().mockResolvedValue({}),
      prewarmVideoFrames: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI;
    const runtime = createMonitorCompositorRuntime(makeOptions(mockClient));

    let nowMs = 10_000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    try {
      runtime.scheduleRender(600_000, { prewarm: true });
      await vi.waitFor(() => expect(mockClient.renderFrame).toHaveBeenCalledTimes(1));
      // Within the throttle window: suppressed regardless of timeline distance.
      nowMs += 100;
      runtime.scheduleRender(700_000, { prewarm: true });
      await vi.waitFor(() => expect(mockClient.renderFrame).toHaveBeenCalledTimes(2));
      // Past the throttle window AND a backward timeline seek: must still fire —
      // a timeline-time gate would go silent here (delta negative after the seek).
      nowMs += 300;
      runtime.scheduleRender(0, { prewarm: true });
      await vi.waitFor(() => expect(mockClient.renderFrame).toHaveBeenCalledTimes(3));

      expect(mockClient.prewarmVideoFrames).toHaveBeenCalledTimes(2);
      expect(mockClient.prewarmVideoFrames).toHaveBeenNthCalledWith(1, 600_000);
      expect(mockClient.prewarmVideoFrames).toHaveBeenNthCalledWith(2, 0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  // Pipeline depth 2 hides the render-RPC round trip: the worker coalesces
  // (latest-request-wins) so the main thread may keep a second render in flight
  // instead of stalling a full RTT between frames — the fix that lifted web
  // playback off its 1/RTT fps ceiling. These pin the invariant so the queue can
  // never silently regress to a serial await-per-frame loop (depth 1) or grow
  // unbounded (which would just buffer stale playhead times).
  it('keeps at most two render RPCs in flight and coalesces the rest to the latest time', async () => {
    const resolvers: Array<() => void> = [];
    const renderFrame = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const mockClient = {
      renderFrame,
    } as unknown as import('~/utils/video-editor/worker-rpc').VideoCoreWorkerAPI;
    const runtime = createMonitorCompositorRuntime(makeOptions(mockClient));

    // Four schedules while every render is still pending: two go in flight, the
    // remaining two collapse into a single parked request (latest time wins).
    runtime.scheduleRender(1_000);
    runtime.scheduleRender(2_000);
    runtime.scheduleRender(3_000);
    runtime.scheduleRender(4_000);

    await vi.waitFor(() => expect(renderFrame).toHaveBeenCalledTimes(2));
    expect(renderFrame).toHaveBeenNthCalledWith(1, 1_000, expect.anything());
    expect(renderFrame).toHaveBeenNthCalledWith(2, 2_000, expect.anything());

    // Draining one in-flight RPC frees a slot; the parked latest request (4_000,
    // not the intermediate 3_000) is what pumps next.
    resolvers[0]!();
    await vi.waitFor(() => expect(renderFrame).toHaveBeenCalledTimes(3));
    expect(renderFrame).toHaveBeenNthCalledWith(3, 4_000, expect.anything());

    resolvers[1]!();
    resolvers[2]!();
    await vi.waitFor(() => expect(renderFrame).toHaveBeenCalledTimes(3));
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
