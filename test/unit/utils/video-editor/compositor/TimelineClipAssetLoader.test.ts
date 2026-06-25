import { describe, it, expect, vi } from 'vitest';

import { TimelineClipAssetLoader } from '~/utils/video-editor/compositor/TimelineClipAssetLoader';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    clipFactory: {
      createSolidClip: vi
        .fn()
        .mockReturnValue({ itemId: 'bg1', clipKind: 'solid', sprite: { tint: 0 } } as any),
      createTextClip: vi.fn().mockReturnValue({ itemId: 'text1', clipKind: 'text' } as any),
      createShapeClip: vi.fn().mockReturnValue({ itemId: 'shape1', clipKind: 'shape' } as any),
      createAdjustmentClip: vi
        .fn()
        .mockReturnValue({ itemId: 'adj1', clipKind: 'adjustment' } as any),
      createHudClip: vi.fn().mockReturnValue({ itemId: 'hud1', clipKind: 'hud' } as any),
    },
    hudMediaLoader: {
      loadImageState: vi.fn().mockResolvedValue(null),
    },
    mediaClipLoader: {
      loadVideoRuntime: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

const toVideoEffects = (v: unknown) => (Array.isArray(v) ? v : undefined);

describe('TimelineClipAssetLoader.build', () => {
  it('builds a background clip with sanitized color', () => {
    const ctx = makeContext();
    const loader = new TimelineClipAssetLoader(ctx as any);
    const clip = loader.build({
      clipData: { backgroundColor: '#ff0000', opacity: 0.5 },
      descriptor: {
        clipType: 'background',
        itemId: 'bg1',
        trackId: 't1',
        layer: 0,
        startUs: 0,
        endUs: 1_000_000,
        requestedTimelineDurationUs: 1_000_000,
      },
      toVideoEffects,
    });
    expect(ctx.clipFactory.createSolidClip).toHaveBeenCalled();
    expect(clip.itemId).toBe('bg1');
  });

  it('builds a text clip with text content', () => {
    const ctx = makeContext();
    const loader = new TimelineClipAssetLoader(ctx as any);
    const clip = loader.build({
      clipData: { text: 'Hello World', style: { fontFamily: 'Arial' } },
      descriptor: {
        clipType: 'text',
        itemId: 'text1',
        trackId: 't1',
        layer: 0,
        startUs: 0,
        endUs: 1_000_000,
        requestedTimelineDurationUs: 1_000_000,
      },
      toVideoEffects,
    });
    expect(ctx.clipFactory.createTextClip).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello World' }),
    );
  });

  it('builds a shape clip with shape properties', () => {
    const ctx = makeContext();
    const loader = new TimelineClipAssetLoader(ctx as any);
    const clip = loader.build({
      clipData: {
        shapeType: 'circle',
        fillColor: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: 2,
      },
      descriptor: {
        clipType: 'shape',
        itemId: 'shape1',
        trackId: 't1',
        layer: 0,
        startUs: 0,
        endUs: 1_000_000,
        requestedTimelineDurationUs: 1_000_000,
      },
      toVideoEffects,
    });
    expect(ctx.clipFactory.createShapeClip).toHaveBeenCalledWith(
      expect.objectContaining({
        shapeType: 'circle',
        fillColor: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: 2,
      }),
    );
  });

  it('builds an adjustment clip', () => {
    const ctx = makeContext();
    const loader = new TimelineClipAssetLoader(ctx as any);
    const clip = loader.build({
      clipData: {},
      descriptor: {
        clipType: 'adjustment',
        itemId: 'adj1',
        trackId: 't1',
        layer: 0,
        startUs: 0,
        endUs: 1_000_000,
        requestedTimelineDurationUs: 1_000_000,
      },
      toVideoEffects,
    });
    expect(ctx.clipFactory.createAdjustmentClip).toHaveBeenCalled();
  });

  it('builds a hud clip with hudType', () => {
    const ctx = makeContext();
    const loader = new TimelineClipAssetLoader(ctx as any);
    const clip = loader.build({
      clipData: { hudType: 'media_frame', background: {}, content: {}, frame: {} },
      descriptor: {
        clipType: 'hud',
        itemId: 'hud1',
        trackId: 't1',
        layer: 0,
        startUs: 0,
        endUs: 1_000_000,
        requestedTimelineDurationUs: 1_000_000,
      },
      toVideoEffects,
    });
    expect(ctx.clipFactory.createHudClip).toHaveBeenCalledWith(
      expect.objectContaining({ hudType: 'media_frame' }),
    );
  });

  it('defaults hudType to media_frame when not specified', () => {
    const ctx = makeContext();
    const loader = new TimelineClipAssetLoader(ctx as any);
    loader.build({
      clipData: {},
      descriptor: {
        clipType: 'hud',
        itemId: 'hud1',
        trackId: 't1',
        layer: 0,
        startUs: 0,
        endUs: 1_000_000,
        requestedTimelineDurationUs: 1_000_000,
      },
      toVideoEffects,
    });
    expect(ctx.clipFactory.createHudClip).toHaveBeenCalledWith(
      expect.objectContaining({ hudType: 'media_frame' }),
    );
  });

  it('defaults shapeType to square when not specified', () => {
    const ctx = makeContext();
    const loader = new TimelineClipAssetLoader(ctx as any);
    loader.build({
      clipData: {},
      descriptor: {
        clipType: 'shape',
        itemId: 'shape1',
        trackId: 't1',
        layer: 0,
        startUs: 0,
        endUs: 1_000_000,
        requestedTimelineDurationUs: 1_000_000,
      },
      toVideoEffects,
    });
    expect(ctx.clipFactory.createShapeClip).toHaveBeenCalledWith(
      expect.objectContaining({ shapeType: 'square' }),
    );
  });
});

describe('TimelineClipAssetLoader.initializeMaskState', () => {
  it('returns early when mask path is missing', async () => {
    const loader = new TimelineClipAssetLoader(makeContext() as any);
    const clip = { mask: undefined } as CompositorClip;
    await loader.initializeMaskState({
      clip,
      deps: { getFileHandleByPath: vi.fn() } as any,
      mediabunny: {} as any,
    });
  });

  it('returns early when file handle is not found', async () => {
    const loader = new TimelineClipAssetLoader(makeContext() as any);
    const clip = {
      mask: { source: { path: '/mask.png' } } as any,
      durationUs: 1_000_000,
      startUs: 0,
    } as CompositorClip;
    await loader.initializeMaskState({
      clip,
      deps: { getFileHandleByPath: vi.fn().mockResolvedValue(null) } as any,
      mediabunny: {} as any,
    });
    expect(clip.maskState).toBeUndefined();
  });

  it('loads image mask via hudMediaLoader', async () => {
    const mockState = { clipKind: 'image', imageSource: {} } as any;
    const ctx = makeContext({
      hudMediaLoader: {
        loadImageState: vi.fn().mockResolvedValue(mockState),
      },
    });
    const loader = new TimelineClipAssetLoader(ctx as any);
    const clip = {
      mask: { source: { path: '/mask.png' } } as any,
      durationUs: 1_000_000,
      startUs: 0,
      maskState: null,
    } as unknown as CompositorClip;
    const mockFile = { type: 'image/png' };
    await loader.initializeMaskState({
      clip,
      deps: {
        getFileHandleByPath: vi
          .fn()
          .mockResolvedValue({ getFile: vi.fn().mockResolvedValue(mockFile) }),
        getFileByPath: vi.fn().mockResolvedValue(mockFile),
      } as any,
      mediabunny: {} as any,
    });
    expect(ctx.hudMediaLoader.loadImageState).toHaveBeenCalled();
    expect(clip.maskState).toBe(mockState);
  });

  it('catches errors during mask initialization', async () => {
    const loader = new TimelineClipAssetLoader(makeContext() as any);
    const clip = {
      mask: { source: { path: '/mask.png' } } as any,
      durationUs: 1_000_000,
      startUs: 0,
    } as CompositorClip;
    // Should not throw
    await loader.initializeMaskState({
      clip,
      deps: {
        getFileHandleByPath: vi.fn().mockRejectedValue(new Error('IO error')),
      } as any,
      mediabunny: {} as any,
    });
  });
});
