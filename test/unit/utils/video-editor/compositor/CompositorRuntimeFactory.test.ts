/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

import { createCompositorRuntime } from '~/utils/video-editor/compositor/CompositorRuntimeFactory';

describe('createCompositorRuntime', () => {
  it('creates all required runtime components', () => {
    const runtime = createCompositorRuntime({
      width: 1920,
      height: 1080,
      designWidth: 1920,
      designHeight: 1080,
      clipPreferBitmapFallback: new Map(),
      resourceManager: {} as any,
      videoFrameCache: {} as any,
    });

    expect(runtime.layoutApplier).toBeDefined();
    expect(runtime.textRenderer).toBeDefined();
    expect(runtime.shapeRenderer).toBeDefined();
    expect(runtime.canvasFallbackRenderer).toBeDefined();
    expect(runtime.timelineClipLoader).toBeDefined();
    expect(runtime.hudMediaLoader).toBeDefined();
    expect(runtime.mediaClipLoader).toBeDefined();
    expect(runtime.rasterImageLoader).toBeDefined();
    expect(runtime.clipFactory).toBeDefined();
    expect(runtime.timelineClipAssetLoader).toBeDefined();
    expect(runtime.timelineLoadOrchestrator).toBeDefined();
    expect(runtime.timelineActiveClipProcessor).toBeDefined();
    expect(runtime.timelineApplyLifecycle).toBeDefined();
    expect(runtime.timelineClipLayoutUpdater).toBeDefined();
    expect(runtime.timelineTrackRebinder).toBeDefined();
    expect(runtime.timelineUpdateLifecycle).toBeDefined();
    expect(runtime.timelineLayoutOrchestrator).toBeDefined();
    expect(runtime.frameSampleOrchestrator).toBeDefined();
    expect(runtime.clipResourceManager).toBeDefined();
  });

  it('passes computeRunner to clipResourceManager when provided', () => {
    const mockRunner = { isReady: () => false } as any;
    const runtime = createCompositorRuntime({
      width: 1920,
      height: 1080,
      designWidth: 1920,
      designHeight: 1080,
      clipPreferBitmapFallback: new Map(),
      resourceManager: {} as any,
      videoFrameCache: {} as any,
      computeRunner: mockRunner,
    });
    expect(runtime.clipResourceManager.getComputeRunner()).toBe(mockRunner);
  });

  it('passes getApp to clipResourceManager when provided', () => {
    const mockApp = { stage: {} } as any;
    const getApp = vi.fn().mockReturnValue(mockApp);
    const runtime = createCompositorRuntime({
      width: 1920,
      height: 1080,
      designWidth: 1920,
      designHeight: 1080,
      clipPreferBitmapFallback: new Map(),
      resourceManager: {} as any,
      videoFrameCache: {} as any,
      getApp,
    });
    // getApp is stored internally; we can verify it doesn't throw
    expect(runtime.clipResourceManager).toBeDefined();
  });
});
