/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderTexture } from 'pixi.js';

import {
  resolveMonitorSampleFallbackTimeS,
  ClipResourceManager,
} from '~/utils/video-editor/compositor/ClipResourceManager';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';
import type { WebGpuComputeRunner } from '~/utils/video-editor/compositor/WebGpuComputeRunner';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface MockImageSource {
  width: number;
  height: number;
  resource: unknown;
  resize: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createMockImageSource(width = 10, height = 10): MockImageSource {
  return {
    width,
    height,
    resource: null as unknown,
    resize: vi.fn((w: number, h: number) => {
      // no-op: mock doesn't need to actually resize
    }),
    update: vi.fn(),
  };
}

function createMockSprite(imageSource: ReturnType<typeof createMockImageSource>) {
  return {
    visible: false,
    texture: { source: imageSource },
  };
}

function createMockLayoutApplier() {
  return {
    applySpriteLayout: vi.fn(),
  } as unknown as import('~/utils/video-editor/compositor/LayoutApplier').LayoutApplier;
}

function createManager(overrides: Record<string, unknown> = {}) {
  return new ClipResourceManager({
    width: 1920,
    height: 1080,
    resourceManager: {} as any,
    videoFrameCache: {} as any,
    canvasFallbackRenderer: {} as any,
    getLayoutApplier: () => createMockLayoutApplier(),
    ...overrides,
  });
}

describe('resolveMonitorSampleFallbackTimeS', () => {
  it('does not fall back in strict mode', () => {
    expect(
      resolveMonitorSampleFallbackTimeS({
        sampleTimeS: 10,
        frameRate: 30,
        monitorSyncMode: 'strict',
      }),
    ).toBeNull();
  });

  it('uses a short fallback window in balanced mode', () => {
    expect(
      resolveMonitorSampleFallbackTimeS({
        sampleTimeS: 10,
        frameRate: 25,
        monitorSyncMode: 'balanced',
      }),
    ).toBeCloseTo(9.98);
  });

  it('uses a wider fallback window in smooth mode', () => {
    expect(
      resolveMonitorSampleFallbackTimeS({
        sampleTimeS: 10,
        frameRate: 25,
        monitorSyncMode: 'smooth',
      }),
    ).toBeCloseTo(9.92);
  });
});

describe('ClipResourceManager.applyEffectsToNonVideoClip', () => {
  it('returns early when previewEffectsEnabled is false', async () => {
    const manager = new ClipResourceManager({
      width: 1920,
      height: 1080,
      resourceManager: {} as any,
      videoFrameCache: {} as any,
      canvasFallbackRenderer: {} as any,
      getLayoutApplier: () =>
        ({
          applySpriteLayout: vi.fn(),
        }) as unknown as import('~/utils/video-editor/compositor/LayoutApplier').LayoutApplier,
    });
    const clip = {
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
    } as CompositorClip;
    await manager.applyEffectsToNonVideoClip(clip, false);
  });

  it('returns early when computeRunner is not ready', async () => {
    const runner = { isReady: () => false } as unknown as WebGpuComputeRunner;
    const manager = new ClipResourceManager({
      width: 1920,
      height: 1080,
      resourceManager: {} as any,
      videoFrameCache: {} as any,
      canvasFallbackRenderer: {} as any,
      getLayoutApplier: () =>
        ({
          applySpriteLayout: vi.fn(),
        }) as unknown as import('~/utils/video-editor/compositor/LayoutApplier').LayoutApplier,
      computeRunner: runner,
    });
    const clip = {
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
    } as CompositorClip;
    await manager.applyEffectsToNonVideoClip(clip, true);
  });

  it('applies effects to an image clip bitmap and reuses imageSource in-place', async () => {
    const mockProcessed = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const runner = {
      isReady: () => true,
      applyEffects: vi.fn().mockResolvedValue(mockProcessed),
    } as unknown as WebGpuComputeRunner;

    const imageSource = createMockImageSource();
    const sprite = createMockSprite(imageSource);

    const manager = createManager({ computeRunner: runner });

    const clip = {
      clipKind: 'image' as const,
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
      bitmap: { width: 10, height: 10 } as unknown as ImageBitmap,
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
    } as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);

    expect(runner.applyEffects).toHaveBeenCalled();
    // imageSource is reused in-place, not replaced
    expect(clip.imageSource).toBe(imageSource);
    // resource is updated to the processed bitmap
    expect((clip.imageSource as any).resource).toBe(mockProcessed);
    expect(clip.imageSource.update).toHaveBeenCalled();
    // lastVideoFrame tracks the processed bitmap for disposal on next call
    expect(clip.lastVideoFrame).toBe(mockProcessed);
    // cache key is set so subsequent calls can skip
    expect(clip.nonVideoEffectCacheKey).toBeDefined();
  });

  it('captures shape clips via RenderTexture without touching app.canvas', async () => {
    const bitmap = { width: 320, height: 180 } as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const extractedCanvas = { width: 320, height: 180 } as OffscreenCanvas;
    const render = vi.fn();
    const extractCanvas = vi.fn().mockReturnValue(extractedCanvas);
    const rtDestroy = vi.fn();
    const mockRt = { destroy: rtDestroy, width: 320, height: 180 };

    const createSpy = vi
      .spyOn(RenderTexture, 'create')
      .mockReturnValue(mockRt as unknown as RenderTexture);

    const sprite = { visible: false };
    const manager = createManager({
      width: 320,
      height: 180,
      getApp: () =>
        ({
          canvas: { width: 320, height: 180 },
          renderer: { render, extract: { canvas: extractCanvas } },
        }) as any,
    });

    const result = await (manager as any).getNonVideoClipBitmap({
      clipKind: 'shape',
      sprite,
    });

    expect(result).toBe(bitmap);
    // Renders to a RenderTexture target, not app.canvas
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ container: sprite, target: mockRt, clear: true }),
    );
    expect(extractCanvas).toHaveBeenCalledWith(mockRt);
    expect(createImageBitmapMock).toHaveBeenCalledWith(extractedCanvas);
    // RenderTexture is destroyed after use
    expect(rtDestroy).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('skips reprocessing when cache key matches and lastVideoFrame exists (dirty-cache)', async () => {
    const mockProcessed = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const runner = {
      isReady: () => true,
      applyEffects: vi.fn().mockResolvedValue(mockProcessed),
    } as unknown as WebGpuComputeRunner;

    const imageSource = createMockImageSource();
    const sprite = createMockSprite(imageSource);
    const manager = createManager({ computeRunner: runner });

    const clip = {
      clipKind: 'image' as const,
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
      bitmap: { width: 10, height: 10 } as unknown as ImageBitmap,
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
    } as CompositorClip;

    // First call processes
    await manager.applyEffectsToNonVideoClip(clip, true);
    expect(runner.applyEffects).toHaveBeenCalledTimes(1);

    // Second call with same effects skips reprocessing
    await manager.applyEffectsToNonVideoClip(clip, true);
    expect(runner.applyEffects).toHaveBeenCalledTimes(1);
  });

  it('reprocesses when effects change (cache key mismatch)', async () => {
    const mockProcessed1 = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const mockProcessed2 = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const runner = {
      isReady: () => true,
      applyEffects: vi.fn()
        .mockResolvedValueOnce(mockProcessed1)
        .mockResolvedValueOnce(mockProcessed2),
    } as unknown as WebGpuComputeRunner;

    const imageSource = createMockImageSource();
    const sprite = createMockSprite(imageSource);
    const manager = createManager({ computeRunner: runner });

    const clip = {
      clipKind: 'image' as const,
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
      bitmap: { width: 10, height: 10 } as unknown as ImageBitmap,
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
    } as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);
    expect(clip.lastVideoFrame).toBe(mockProcessed1);

    // Change effects
    clip.effects = [{ id: '1', type: 'color-adjustment', brightness: 2.0, enabled: true }];
    await manager.applyEffectsToNonVideoClip(clip, true);

    expect(runner.applyEffects).toHaveBeenCalledTimes(2);
    expect(clip.lastVideoFrame).toBe(mockProcessed2);
    // Old processed bitmap is disposed
    expect(mockProcessed1.close).toHaveBeenCalled();
  });

  it('disposes previous lastVideoFrame when new processed bitmap is committed', async () => {
    const mockProcessed1 = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const mockProcessed2 = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const runner = {
      isReady: () => true,
      applyEffects: vi.fn()
        .mockResolvedValueOnce(mockProcessed1)
        .mockResolvedValueOnce(mockProcessed2),
    } as unknown as WebGpuComputeRunner;

    const imageSource = createMockImageSource();
    const sprite = createMockSprite(imageSource);
    const manager = createManager({ computeRunner: runner });

    const clip = {
      clipKind: 'image' as const,
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
      bitmap: { width: 10, height: 10 } as unknown as ImageBitmap,
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
    } as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);
    expect(clip.lastVideoFrame).toBe(mockProcessed1);
    expect(mockProcessed1.close).not.toHaveBeenCalled();

    // Change effects to force reprocessing
    clip.effects = [{ id: '1', type: 'color-adjustment', brightness: 2.0, enabled: true }];
    await manager.applyEffectsToNonVideoClip(clip, true);

    // First processed bitmap is disposed after second is committed
    expect(mockProcessed1.close).toHaveBeenCalled();
    expect(clip.lastVideoFrame).toBe(mockProcessed2);
  });
});
