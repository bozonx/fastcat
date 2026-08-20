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

describe('ClipResourceManager.getVideoSampleForClip', () => {
  it('keeps the current render frame alive when the cache rejects the decoded frame', async () => {
    const renderFrame = { closed: false, close: vi.fn() };
    const sharedFrame = {
      closed: false,
      clone: vi.fn(() => renderFrame),
      close: vi.fn(function (this: { closed: boolean }) {
        this.closed = true;
      }),
    };
    const decodedFrame = {
      codedWidth: 128,
      codedHeight: 72,
      closed: false,
      clone: vi.fn(() => sharedFrame),
      close: vi.fn(function (this: { closed: boolean }) {
        this.closed = true;
      }),
    };
    const decodedSample = {
      timestamp: 1,
      toVideoFrame: vi.fn(() => decodedFrame),
      close: vi.fn(),
    };
    const videoFrameCache = {
      frameLe: vi.fn(() => null),
      set: vi.fn((entry: { frame: typeof decodedFrame }) => entry.frame.close()),
    };
    const manager = createManager({
      resourceManager: {
        withVideoSampleSlot: (task: () => Promise<unknown>) => task(),
      },
      videoFrameCache,
    });
    const clip = {
      itemId: 'clip',
      clipKind: 'video',
      frameRate: 30,
      startTicks: 0,
      sink: { getSample: vi.fn().mockResolvedValue(decodedSample) },
    } as unknown as CompositorClip;

    const sample = (await manager.getVideoSampleForClip({ clip, sampleTimeS: 1 })) as {
      toVideoFrame: () => typeof renderFrame;
      close: () => void;
    };

    expect(decodedFrame.closed).toBe(true);
    expect(sample.toVideoFrame()).toBe(renderFrame);
    expect(renderFrame.closed).toBe(false);
    expect(sharedFrame.closed).toBe(true);
    sample.close();
    expect(renderFrame.close).not.toHaveBeenCalled();
  });

  it('clones a cache hit before it can be evicted', async () => {
    const renderFrame = { closed: false, close: vi.fn() };
    const cachedFrame = { closed: false, clone: vi.fn(() => renderFrame) };
    const manager = createManager({
      videoFrameCache: {
        frameLe: vi.fn(() => ({ frame: cachedFrame })),
      },
    });
    const clip = { itemId: 'clip', frameRate: 30 } as CompositorClip;

    const sample = (await manager.getVideoSampleForClip({ clip, sampleTimeS: 1 })) as {
      toVideoFrame: () => typeof renderFrame;
    };
    cachedFrame.closed = true;

    expect(sample.toVideoFrame()).toBe(renderFrame);
  });

  it('coalesces concurrent decodes while giving each consumer its own frame', async () => {
    const consumerFrames = [
      { id: 'first', close: vi.fn() },
      { id: 'second', close: vi.fn() },
    ];
    const sharedFrame = {
      clone: vi.fn(() => consumerFrames.shift()),
      close: vi.fn(),
    };
    const decodedFrame = {
      codedWidth: 128,
      codedHeight: 72,
      clone: vi.fn(() => sharedFrame),
      close: vi.fn(),
    };
    const sink = {
      getSample: vi.fn().mockResolvedValue({
        timestamp: 1,
        toVideoFrame: () => decodedFrame,
        close: vi.fn(),
      }),
    };
    const manager = createManager({
      resourceManager: { withVideoSampleSlot: (task: () => Promise<unknown>) => task() },
      videoFrameCache: { frameLe: vi.fn(() => null), set: vi.fn() },
    });
    const clip = {
      itemId: 'clip',
      clipKind: 'video',
      frameRate: 30,
      startTicks: 0,
      sink,
    } as unknown as CompositorClip;

    const [first, second] = (await Promise.all([
      manager.getVideoSampleForClip({ clip, sampleTimeS: 1 }),
      manager.getVideoSampleForClip({ clip, sampleTimeS: 1 }),
    ])) as Array<{ toVideoFrame: () => { id: string } }>;

    expect(sink.getSample).toHaveBeenCalledTimes(1);
    expect(first?.toVideoFrame().id).toBe('first');
    expect(second?.toVideoFrame().id).toBe('second');
    expect(sharedFrame.close).toHaveBeenCalledTimes(1);
  });
});

describe('ClipResourceManager.warmClipFrameWindow', () => {
  function createCacheMock(preCached: string[] = []) {
    const store = new Map<string, unknown>();
    for (const key of preCached) store.set(key, { frame: {} });
    return {
      store,
      get: vi.fn((key: string) => store.get(key) ?? null),
      set: vi.fn((entry: { key: string }) => store.set(entry.key, entry)),
    };
  }

  // A sequential sink yielding 25fps frames from the requested start time. Tracks
  // opened iterators and whether they were finalized via return().
  function createSinkMock() {
    const opens: Array<{ startS: number | undefined; endS: number | undefined }> = [];
    const finalized: number[] = [];
    return {
      opens,
      finalized,
      samples: vi.fn((startS?: number, endS?: number) => {
        const openIndex = opens.length;
        opens.push({ startS, endS });
        let t = Math.ceil((startS ?? 0) * 25 - 1e-6) / 25;
        const iterator: AsyncGenerator<unknown> = {
          async next() {
            if (endS !== undefined && t >= endS) return { value: undefined, done: true };
            const timestamp = t;
            t += 1 / 25;
            return {
              value: {
                timestamp,
                toVideoFrame: () => ({ codedWidth: 128, codedHeight: 72, closed: false }),
                close: () => undefined,
              },
              done: false,
            };
          },
          async return() {
            finalized.push(openIndex);
            return { value: undefined, done: true };
          },
          async throw() {
            return { value: undefined, done: true };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        } as AsyncGenerator<unknown>;
        return iterator;
      }),
    };
  }

  function createVideoClip(sink: unknown): CompositorClip {
    return {
      itemId: 'clip-1',
      clipKind: 'video',
      frameRate: 25,
      firstTimestampS: 0,
      startTicks: 0,
      sourceStartTicks: 0,
      sourceRangeDurationTicks: 2_540_160_000_000,
      sink,
    } as unknown as CompositorClip;
  }

  it('warms the look-ahead window through a sequential iterator, keyed by PTS (ms grid)', async () => {
    const videoFrameCache = createCacheMock();
    const sink = createSinkMock();
    const manager = createManager({ videoFrameCache: videoFrameCache as any });

    await manager.warmClipFrameWindow({
      clip: createVideoClip(sink),
      nowSourceTimeS: 0,
      aheadSourceTimeS: 0.12,
      timelineNowTicks: 0,
      speed: 1,
    });

    // One sequential stream, opened once at the playhead source time.
    expect(sink.samples).toHaveBeenCalledTimes(1);
    expect(sink.opens[0]).toEqual({ startS: 0, endS: 10 });
    // Frames at t=0, 0.04, 0.08, 0.12 → ms keys 0, 40, 80, 120 (the pull stops once
    // the frontier reaches aheadSourceTimeS).
    expect(videoFrameCache.store.has('clip-1:0')).toBe(true);
    expect(videoFrameCache.store.has('clip-1:40')).toBe(true);
    expect(videoFrameCache.store.has('clip-1:80')).toBe(true);
  });

  it('reuses the same iterator across ticks, decoding only new frames', async () => {
    const videoFrameCache = createCacheMock();
    const sink = createSinkMock();
    const manager = createManager({ videoFrameCache: videoFrameCache as any });
    const clip = createVideoClip(sink);

    await manager.warmClipFrameWindow({
      clip,
      nowSourceTimeS: 0,
      aheadSourceTimeS: 0.12,
      timelineNowTicks: 0,
      speed: 1,
    });
    const storedAfterFirst = videoFrameCache.set.mock.calls.length;

    // Playhead advanced 0.08s; the same stream is pulled forward, no reopen.
    await manager.warmClipFrameWindow({
      clip,
      nowSourceTimeS: 0.08,
      aheadSourceTimeS: 0.2,
      timelineNowTicks: 80_000,
      speed: 1,
    });

    expect(sink.samples).toHaveBeenCalledTimes(1);
    // Only the newly-entered frames were decoded and stored.
    expect(videoFrameCache.set.mock.calls.length).toBeGreaterThan(storedAfterFirst);
    // Frame at t=0.16 → ms key 160.
    expect(videoFrameCache.store.has('clip-1:160')).toBe(true);
  });

  it('can warm transition handles beyond the visible source range', async () => {
    const videoFrameCache = createCacheMock();
    const sink = createSinkMock();
    const manager = createManager({ videoFrameCache: videoFrameCache as any });

    await manager.warmClipFrameWindow({
      clip: createVideoClip(sink),
      nowSourceTimeS: 10,
      aheadSourceTimeS: 10.12,
      rangeEndSourceTimeS: 12,
      timelineNowTicks: 0,
      speed: 1,
    });

    expect(sink.opens[0]).toEqual({ startS: 10, endS: 12 });
    expect(videoFrameCache.store.has('clip-1:10000')).toBe(true);
  });

  it('reopens an existing iterator when a transition extends its source range', async () => {
    const videoFrameCache = createCacheMock();
    const sink = createSinkMock();
    const manager = createManager({ videoFrameCache: videoFrameCache as any });
    const clip = createVideoClip(sink);

    await manager.warmClipFrameWindow({
      clip,
      nowSourceTimeS: 9.8,
      aheadSourceTimeS: 9.92,
      timelineNowTicks: 0,
      speed: 1,
    });
    await manager.warmClipFrameWindow({
      clip,
      nowSourceTimeS: 10,
      aheadSourceTimeS: 10.12,
      rangeEndSourceTimeS: 12,
      timelineNowTicks: 10_000_000,
      speed: 1,
    });

    expect(sink.samples).toHaveBeenCalledTimes(2);
    expect(sink.finalized).toContain(0);
    expect(sink.opens[1]).toEqual({ startS: 10, endS: 12 });
  });

  it('reopens the stream after a backward seek', async () => {
    const videoFrameCache = createCacheMock();
    const sink = createSinkMock();
    const manager = createManager({ videoFrameCache: videoFrameCache as any });
    const clip = createVideoClip(sink);

    await manager.warmClipFrameWindow({
      clip,
      nowSourceTimeS: 1.0,
      aheadSourceTimeS: 1.12,
      timelineNowTicks: 1_000_000,
      speed: 1,
    });

    await manager.warmClipFrameWindow({
      clip,
      nowSourceTimeS: 0.2,
      aheadSourceTimeS: 0.32,
      timelineNowTicks: 200_000,
      speed: 1,
    });

    expect(sink.samples).toHaveBeenCalledTimes(2);
    // The stale forward iterator was finalized when replaced.
    expect(sink.finalized).toContain(0);
    expect(sink.opens[1]?.startS).toBeCloseTo(0.2);
  });

  it('disposeWarmStream finalizes the iterator; pruneWarmStreams drops inactive clips', async () => {
    const videoFrameCache = createCacheMock();
    const sink = createSinkMock();
    const manager = createManager({ videoFrameCache: videoFrameCache as any });
    const clip = createVideoClip(sink);

    await manager.warmClipFrameWindow({
      clip,
      nowSourceTimeS: 0,
      aheadSourceTimeS: 0.08,
      timelineNowTicks: 0,
      speed: 1,
    });

    manager.pruneWarmStreams(new Set(['other-clip']));
    expect(sink.finalized).toContain(0);
  });

  it('is a no-op when the sink lacks the sequential API', async () => {
    const videoFrameCache = createCacheMock();
    const manager = createManager({ videoFrameCache: videoFrameCache as any });

    await manager.warmClipFrameWindow({
      clip: createVideoClip({ getSample: vi.fn() }),
      nowSourceTimeS: 0,
      aheadSourceTimeS: 0.12,
      timelineNowTicks: 0,
      speed: 1,
    });

    expect(videoFrameCache.set).not.toHaveBeenCalled();
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

  it('keeps text canvas texture when no effects are active', async () => {
    const manager = createManager();
    const imageSource = createMockImageSource();
    const canvas = { width: 64, height: 32 };
    const canvasTextureSource = { resource: canvas, update: vi.fn() };
    const sprite = {
      texture: { source: canvasTextureSource },
    };
    const clip = {
      clipKind: 'text',
      effects: [],
      sprite,
      imageSource,
      canvas,
      ctx: {},
      textDirty: false,
    } as unknown as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);

    expect(sprite.texture.source).toBe(canvasTextureSource);
    expect(clip.textDirty).toBe(false);
  });

  it('restores solid clips from placeholder source when no effects are active', async () => {
    const clearRect = vi.fn();
    const fillRect = vi.fn();
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn(function MockOffscreenCanvas(width: number, height: number) {
        return {
          width,
          height,
          getContext: vi.fn(() => ({ clearRect, fillRect, fillStyle: '' })),
        };
      }),
    );

    const manager = createManager();
    const imageSource = createMockImageSource();
    const placeholderTexture = { source: imageSource };
    const sprite = { texture: placeholderTexture };
    const clip = {
      clipKind: 'solid',
      effects: [],
      sprite,
      imageSource,
      backgroundColor: '#ff0000',
    } as unknown as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);

    expect(sprite.texture).not.toBe(placeholderTexture);
    expect(sprite.texture.source).not.toBe(imageSource);
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

  it('uses GPU texture output for non-video sprite effects when possible', async () => {
    const sourceTexture = {
      uid: 11,
      width: 1920,
      height: 1080,
      source: { pixelWidth: 1920, pixelHeight: 1080, format: 'bgra8unorm' },
      destroy: vi.fn(),
    };
    const effectTexture = {
      uid: 12,
      width: 1920,
      height: 1080,
      source: { pixelWidth: 1920, pixelHeight: 1080, format: 'bgra8unorm' },
      destroy: vi.fn(),
    };
    const createRenderTexture = vi
      .spyOn(RenderTexture, 'create')
      .mockReturnValueOnce(sourceTexture as any)
      .mockReturnValueOnce(effectTexture as any);

    const render = vi.fn();
    const applyEffects = vi.fn();
    const applyEffectsToTexture = vi.fn(() => true);
    const runner = {
      isReady: () => true,
      applyEffects,
      applyEffectsToTexture,
    } as unknown as WebGpuComputeRunner;
    const layoutApplier = createMockLayoutApplier();
    const imageSource = createMockImageSource(2, 2);
    const sprite = createMockSprite(imageSource);
    const manager = createManager({
      computeRunner: runner,
      getLayoutApplier: () => layoutApplier,
      getApp: () =>
        ({
          renderer: { render },
        }) as any,
    });
    const clip = {
      clipKind: 'solid' as const,
      effects: [{ id: '1', type: 'color-adjustment', brightness: 1.2, enabled: true }],
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
      lastVideoFrame: null,
    } as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);

    expect(createRenderTexture).toHaveBeenNthCalledWith(1, { width: 1920, height: 1080 });
    expect(createRenderTexture).toHaveBeenNthCalledWith(2, { width: 1920, height: 1080 });
    expect(render).toHaveBeenCalledWith({
      container: sprite,
      target: sourceTexture,
      clear: true,
    });
    expect(applyEffectsToTexture).toHaveBeenCalledWith({
      source: sourceTexture,
      target: effectTexture,
      effects: expect.arrayContaining([expect.objectContaining({ type: 'brightness' })]),
    });
    expect(applyEffects).not.toHaveBeenCalled();
    expect((clip.sprite as any).texture).toBe(effectTexture);
    expect(clip.effectRenderTexture).toBe(effectTexture);
    expect(clip.lastVideoFrame).toBeNull();
    expect(clip.nonVideoEffectCacheKey).toBeDefined();
    expect(layoutApplier.applySpriteLayout).toHaveBeenCalledWith(1920, 1080, clip);
    expect(sourceTexture.destroy).toHaveBeenCalledWith(true);
  });

  it('uses GPU texture output for bitmap-source non-video blur-fill effects', async () => {
    const effectTexture = {
      uid: 21,
      width: 1920,
      height: 1080,
      source: { pixelWidth: 1920, pixelHeight: 1080, format: 'bgra8unorm' },
      destroy: vi.fn(),
    };
    vi.spyOn(RenderTexture, 'create').mockReturnValue(effectTexture as any);

    const bitmap = { width: 320, height: 180, close: vi.fn() } as unknown as ImageBitmap;
    const applyBlurFill = vi.fn();
    const applyBlurFillSourceToTexture = vi.fn().mockResolvedValue({
      rendered: true,
      width: 1920,
      height: 1080,
      contentWidth: 1920,
      contentHeight: 1080,
      padding: 0,
    });
    const runner = {
      isReady: () => true,
      applyBlurFill,
      applyBlurFillSourceToTexture,
    } as unknown as WebGpuComputeRunner;
    const layoutApplier = createMockLayoutApplier();
    const imageSource = createMockImageSource(320, 180);
    const sprite = createMockSprite(imageSource);
    const manager = createManager({
      computeRunner: runner,
      getLayoutApplier: () => layoutApplier,
    });
    const clip = {
      clipKind: 'image' as const,
      effects: [
        {
          id: 'fill-1',
          type: 'blur-fill',
          fgScale: 1,
          bgScale: 1.1,
          blur: 40,
          bgDim: 0.85,
          bgSaturation: 1,
          tintColor: '#000000',
          tintStrength: 0,
          fgOffsetY: 0,
          enabled: true,
        },
      ],
      bitmap,
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
      lastVideoFrame: null,
    } as CompositorClip;

    await manager.applyEffectsToNonVideoClip(clip, true);

    expect(applyBlurFillSourceToTexture).toHaveBeenCalledWith({
      source: bitmap,
      target: effectTexture,
      frameW: 1920,
      frameH: 1080,
      fgScale: 1,
      bgScale: 1.1,
      blur: 40,
      bgDim: 0.85,
      bgSaturation: 1,
      tintColor: [0, 0, 0, 255],
      tintStrength: 0,
      fgOffsetY: 0,
    });
    expect(applyBlurFill).not.toHaveBeenCalled();
    expect((clip.sprite as any).texture).toBe(effectTexture);
    expect(clip.lastVideoFrame).toBeNull();
    expect(clip.effectIgnoreTransform).toBe(true);
    expect(bitmap.close).not.toHaveBeenCalled();
    expect(layoutApplier.applySpriteLayout).toHaveBeenCalledWith(1920, 1080, clip, {
      ignoreClipTransform: true,
    });
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
      applyEffects: vi
        .fn()
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
      applyEffects: vi
        .fn()
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

describe('ClipResourceManager.updateClipTextureFromSample', () => {
  it('uses GPU texture output for non-padded video effects', async () => {
    const effectTexture = {
      uid: 7,
      width: 128,
      height: 72,
      source: { pixelWidth: 128, pixelHeight: 72, format: 'bgra8unorm' },
      destroy: vi.fn(),
    };
    vi.spyOn(RenderTexture, 'create').mockReturnValue(effectTexture as any);

    const frame = {
      displayWidth: 128,
      displayHeight: 72,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const sample = {
      toVideoFrame: vi.fn(() => frame),
    };
    const applyEffects = vi.fn();
    const applyEffectsSourceToTexture = vi.fn().mockResolvedValue({
      rendered: true,
      width: 128,
      height: 72,
      contentWidth: 128,
      contentHeight: 72,
      padding: 0,
    });
    const runner = {
      isReady: () => true,
      applyEffects,
      applyEffectsSourceToTexture,
    } as unknown as WebGpuComputeRunner;
    const layoutApplier = createMockLayoutApplier();
    const imageSource = createMockImageSource(128, 72);
    const sprite = createMockSprite(imageSource);
    const manager = createManager({
      computeRunner: runner,
      getLayoutApplier: () => layoutApplier,
    });
    const clip = {
      itemId: 'clip-1',
      clipKind: 'video',
      sourceKind: 'videoFrame',
      effects: [{ id: 'b', type: 'color-adjustment', brightness: 1.2, enabled: true }],
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
      lastVideoFrame: null,
    } as CompositorClip;

    await manager.updateClipTextureFromSample(sample, clip, true);

    expect(applyEffectsSourceToTexture).toHaveBeenCalledWith({
      source: frame,
      target: effectTexture,
      effects: expect.arrayContaining([expect.objectContaining({ type: 'brightness' })]),
    });
    expect(applyEffects).not.toHaveBeenCalled();
    expect((clip.sprite as any).texture).toBe(effectTexture);
    expect(clip.effectRenderTexture).toBe(effectTexture);
    expect(clip.effectTextureW).toBe(128);
    expect(clip.effectTextureH).toBe(72);
    expect(clip.lastVideoFrame).toBeNull();
    expect(frame.close).toHaveBeenCalled();
    expect(layoutApplier.applySpriteLayout).toHaveBeenCalledWith(128, 72, clip);
  });

  it('uses padded GPU texture output for bleed video effects', async () => {
    const effectTexture = {
      width: 132,
      height: 76,
      source: { pixelWidth: 132, pixelHeight: 76, format: 'bgra8unorm' },
      destroy: vi.fn(),
    };
    const createRenderTexture = vi
      .spyOn(RenderTexture, 'create')
      .mockReturnValue(effectTexture as any);

    const frame = {
      displayWidth: 128,
      displayHeight: 72,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const sample = {
      toVideoFrame: vi.fn(() => frame),
    };
    const applyEffects = vi.fn();
    const applyEffectsSourceToTexture = vi.fn().mockResolvedValue({
      rendered: true,
      width: 132,
      height: 76,
      contentWidth: 128,
      contentHeight: 72,
      padding: 2,
    });
    const runner = {
      isReady: () => true,
      applyEffects,
      applyEffectsSourceToTexture,
    } as unknown as WebGpuComputeRunner;
    const layoutApplier = createMockLayoutApplier();
    const imageSource = createMockImageSource(128, 72);
    const sprite = createMockSprite(imageSource);
    const manager = createManager({
      computeRunner: runner,
      getLayoutApplier: () => layoutApplier,
    });
    const clip = {
      itemId: 'clip-1',
      clipKind: 'video',
      sourceKind: 'videoFrame',
      effects: [
        {
          id: 'blur-1',
          type: 'blur',
          strength: 10,
          blurType: 'gaussian',
          blurPastEdges: true,
          enabled: true,
        },
      ],
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
      lastVideoFrame: null,
    } as CompositorClip;

    await manager.updateClipTextureFromSample(sample, clip, true);

    expect(createRenderTexture).toHaveBeenCalledWith({ width: 132, height: 76 });
    expect(applyEffectsSourceToTexture).toHaveBeenCalledWith({
      source: frame,
      target: effectTexture,
      effects: expect.arrayContaining([
        expect.objectContaining({ type: 'gaussian-blur', radius: 10, bleed: true }),
      ]),
    });
    expect(applyEffects).not.toHaveBeenCalled();
    expect((clip.sprite as any).texture).toBe(effectTexture);
    expect(clip.effectTextureW).toBe(132);
    expect(clip.effectTextureH).toBe(76);
    expect(clip.effectSourceW).toBe(128);
    expect(clip.effectSourceH).toBe(72);
    expect(frame.close).toHaveBeenCalled();
    expect(layoutApplier.applySpriteLayout).toHaveBeenCalledWith(128, 72, clip);
  });

  it('uses GPU texture output for standalone blur-fill video effects', async () => {
    const effectTexture = {
      width: 1920,
      height: 1080,
      source: { pixelWidth: 1920, pixelHeight: 1080, format: 'bgra8unorm' },
      destroy: vi.fn(),
    };
    const createRenderTexture = vi
      .spyOn(RenderTexture, 'create')
      .mockReturnValue(effectTexture as any);

    const frame = {
      displayWidth: 128,
      displayHeight: 72,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const sample = {
      toVideoFrame: vi.fn(() => frame),
    };
    const applyBlurFill = vi.fn();
    const applyBlurFillSourceToTexture = vi.fn().mockResolvedValue({
      rendered: true,
      width: 1920,
      height: 1080,
      contentWidth: 1920,
      contentHeight: 1080,
      padding: 0,
    });
    const runner = {
      isReady: () => true,
      applyBlurFill,
      applyBlurFillSourceToTexture,
    } as unknown as WebGpuComputeRunner;
    const layoutApplier = createMockLayoutApplier();
    const imageSource = createMockImageSource(128, 72);
    const sprite = createMockSprite(imageSource);
    const manager = createManager({
      computeRunner: runner,
      getLayoutApplier: () => layoutApplier,
    });
    const clip = {
      itemId: 'clip-1',
      clipKind: 'video',
      sourceKind: 'videoFrame',
      effects: [
        {
          id: 'fill-1',
          type: 'blur-fill',
          fgScale: 1,
          bgScale: 1.1,
          blur: 40,
          bgDim: 0.85,
          bgSaturation: 1,
          tintColor: '#000000',
          tintStrength: 0,
          fgOffsetY: 0,
          enabled: true,
        },
      ],
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
      lastVideoFrame: null,
    } as CompositorClip;

    await manager.updateClipTextureFromSample(sample, clip, true);

    expect(createRenderTexture).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(applyBlurFillSourceToTexture).toHaveBeenCalledWith({
      source: frame,
      target: effectTexture,
      frameW: 1920,
      frameH: 1080,
      fgScale: 1,
      bgScale: 1.1,
      blur: 40,
      bgDim: 0.85,
      bgSaturation: 1,
      tintColor: [0, 0, 0, 255],
      tintStrength: 0,
      fgOffsetY: 0,
    });
    expect(applyBlurFill).not.toHaveBeenCalled();
    expect((clip.sprite as any).texture).toBe(effectTexture);
    expect(clip.effectSourceW).toBe(1920);
    expect(clip.effectSourceH).toBe(1080);
    expect(clip.effectTextureW).toBe(1920);
    expect(clip.effectTextureH).toBe(1080);
    expect(clip.effectIgnoreTransform).toBe(true);
    expect(frame.close).toHaveBeenCalled();
    expect(layoutApplier.applySpriteLayout).toHaveBeenCalledWith(1920, 1080, clip, {
      ignoreClipTransform: true,
    });
  });

  it('uses GPU texture output for effects followed by blur-fill', async () => {
    const effectTexture = {
      width: 1920,
      height: 1080,
      source: { pixelWidth: 1920, pixelHeight: 1080, format: 'bgra8unorm' },
      destroy: vi.fn(),
    };
    vi.spyOn(RenderTexture, 'create').mockReturnValue(effectTexture as any);

    const frame = {
      displayWidth: 128,
      displayHeight: 72,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const sample = {
      toVideoFrame: vi.fn(() => frame),
    };
    const applyEffects = vi.fn();
    const applyBlurFill = vi.fn();
    const applyEffectsThenBlurFillSourceToTexture = vi.fn().mockResolvedValue({
      rendered: true,
      width: 1920,
      height: 1080,
      contentWidth: 1920,
      contentHeight: 1080,
      padding: 0,
    });
    const runner = {
      isReady: () => true,
      applyEffects,
      applyBlurFill,
      applyEffectsThenBlurFillSourceToTexture,
    } as unknown as WebGpuComputeRunner;
    const layoutApplier = createMockLayoutApplier();
    const imageSource = createMockImageSource(128, 72);
    const sprite = createMockSprite(imageSource);
    const manager = createManager({
      computeRunner: runner,
      getLayoutApplier: () => layoutApplier,
    });
    const clip = {
      itemId: 'clip-1',
      clipKind: 'video',
      sourceKind: 'videoFrame',
      effects: [
        { id: 'b', type: 'color-adjustment', brightness: 1.2, enabled: true },
        {
          id: 'fill-1',
          type: 'blur-fill',
          fgScale: 1,
          bgScale: 1.1,
          blur: 40,
          bgDim: 0.85,
          bgSaturation: 1,
          tintColor: '#000000',
          tintStrength: 0,
          fgOffsetY: 0,
          enabled: true,
        },
      ],
      sprite: sprite as unknown as CompositorClip['sprite'],
      imageSource: imageSource as any,
      lastVideoFrame: null,
    } as CompositorClip;

    await manager.updateClipTextureFromSample(sample, clip, true);

    expect(applyEffectsThenBlurFillSourceToTexture).toHaveBeenCalledWith({
      source: frame,
      target: effectTexture,
      effects: expect.arrayContaining([expect.objectContaining({ type: 'brightness' })]),
      frameW: 1920,
      frameH: 1080,
      fgScale: 1,
      bgScale: 1.1,
      blur: 40,
      bgDim: 0.85,
      bgSaturation: 1,
      tintColor: [0, 0, 0, 255],
      tintStrength: 0,
      fgOffsetY: 0,
    });
    expect(applyEffects).not.toHaveBeenCalled();
    expect(applyBlurFill).not.toHaveBeenCalled();
    expect((clip.sprite as any).texture).toBe(effectTexture);
    expect(clip.effectSourceW).toBe(1920);
    expect(clip.effectSourceH).toBe(1080);
    expect(clip.effectTextureW).toBe(1920);
    expect(clip.effectTextureH).toBe(1080);
    expect(clip.effectIgnoreTransform).toBe(true);
    expect(frame.close).toHaveBeenCalled();
    expect(layoutApplier.applySpriteLayout).toHaveBeenCalledWith(1920, 1080, clip, {
      ignoreClipTransform: true,
    });
  });
});
