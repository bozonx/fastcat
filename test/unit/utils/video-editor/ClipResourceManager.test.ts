/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveMonitorSampleFallbackTimeS,
  ClipResourceManager,
} from '~/utils/video-editor/compositor/ClipResourceManager';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';
import type { WebGpuComputeRunner } from '~/utils/video-editor/compositor/WebGpuComputeRunner';
import { initEffects } from '~/effects';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('applies effects to an image clip bitmap', async () => {
    const mockProcessed = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const runner = {
      isReady: () => true,
      applyEffects: vi.fn().mockResolvedValue(mockProcessed),
    } as unknown as WebGpuComputeRunner;

    const mockSprite = { texture: null };

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
      clipKind: 'image' as const,
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
      bitmap: { width: 10, height: 10 } as unknown as ImageBitmap,
      sprite: mockSprite as unknown as CompositorClip['sprite'],
      imageSource: {} as any,
    } as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);

    expect(runner.applyEffects).toHaveBeenCalled();
  });

  it('captures shape clips through the compositor canvas without pixel extraction', async () => {
    const bitmap = { width: 320, height: 180 } as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    const sprite = { visible: false };
    const canvas = { width: 320, height: 180 };
    const render = vi.fn();
    const manager = new ClipResourceManager({
      width: 320,
      height: 180,
      resourceManager: {} as any,
      videoFrameCache: {} as any,
      canvasFallbackRenderer: {} as any,
      getLayoutApplier: () => ({}) as any,
      getApp: () =>
        ({
          canvas,
          renderer: { render },
        }) as any,
    });

    const result = await (manager as any).getNonVideoClipBitmap({
      clipKind: 'shape',
      sprite,
    });

    expect(result).toBe(bitmap);
    expect(render).toHaveBeenCalledWith({ container: sprite, clear: true });
    expect(createImageBitmapMock).toHaveBeenCalledWith(canvas);
    expect(sprite.visible).toBe(false);
  });
});
