// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeRotation,
  getFinitePositiveNumber,
  getThumbnailSourceWidth,
  getThumbnailSourceHeight,
  drawRotatedThumbnailFrame,
  serializeWorkerError,
  disposeFrameExtractorState,
  type FrameExtractorState,
} from '~/workers/video-core-helpers';

describe('normalizeRotation', () => {
  it('returns 0 for 0 degrees', () => {
    expect(normalizeRotation(0)).toBe(0);
  });

  it('returns 90 for 90 degrees', () => {
    expect(normalizeRotation(90)).toBe(90);
  });

  it('returns 180 for 180 degrees', () => {
    expect(normalizeRotation(180)).toBe(180);
  });

  it('returns 270 for 270 degrees', () => {
    expect(normalizeRotation(270)).toBe(270);
  });

  it('returns 0 for 360 degrees', () => {
    expect(normalizeRotation(360)).toBe(0);
  });

  it('normalizes negative rotations', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(-270)).toBe(90);
  });

  it('normalizes rotations > 360', () => {
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(720)).toBe(0);
  });

  it('snaps to nearest quadrant', () => {
    expect(normalizeRotation(44)).toBe(0);
    expect(normalizeRotation(45)).toBe(90);
    expect(normalizeRotation(134)).toBe(90);
    expect(normalizeRotation(135)).toBe(180);
    expect(normalizeRotation(224)).toBe(180);
    expect(normalizeRotation(225)).toBe(270);
    expect(normalizeRotation(314)).toBe(270);
    expect(normalizeRotation(315)).toBe(0);
  });

  it('handles non-integer values', () => {
    expect(normalizeRotation(90.7)).toBe(90);
    expect(normalizeRotation(179.9)).toBe(180);
  });
});

describe('getFinitePositiveNumber', () => {
  it('returns the number for valid positive numbers', () => {
    expect(getFinitePositiveNumber(42)).toBe(42);
    expect(getFinitePositiveNumber(0.001)).toBe(0.001);
  });

  it('returns null for zero', () => {
    expect(getFinitePositiveNumber(0)).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(getFinitePositiveNumber(-1)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(getFinitePositiveNumber(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(getFinitePositiveNumber(Infinity)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(getFinitePositiveNumber(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(getFinitePositiveNumber(null)).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(getFinitePositiveNumber('abc')).toBeNull();
  });

  it('parses numeric strings', () => {
    expect(getFinitePositiveNumber('42')).toBe(42);
  });
});

describe('getThumbnailSourceWidth', () => {
  it('returns codedWidth from image source', () => {
    const source = { codedWidth: 1920 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceWidth(source, {}, 0)).toBe(1920);
  });

  it('returns codedWidth from sample when source lacks it', () => {
    const source = {} as CanvasImageSource;
    expect(getThumbnailSourceWidth(source, { codedWidth: 1280 }, 0)).toBe(1280);
  });

  it('falls back through videoWidth, naturalWidth, width', () => {
    const source = { videoWidth: 640 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceWidth(source, {}, 0)).toBe(640);

    const source2 = { naturalWidth: 320 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceWidth(source2, {}, 0)).toBe(320);

    const source3 = { width: 160 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceWidth(source3, {}, 0)).toBe(160);
  });

  it('skips displayWidth for quarter-turn rotations', () => {
    const source = { displayWidth: 1080 } as unknown as CanvasImageSource;
    // For 90/270 rotation, displayWidth is rotation-applied, so it should be skipped
    expect(getThumbnailSourceWidth(source, {}, 90)).toBe(0);
    expect(getThumbnailSourceWidth(source, {}, 270)).toBe(0);
  });

  it('uses displayWidth for non-quarter-turn rotations', () => {
    const source = { displayWidth: 1920 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceWidth(source, {}, 0)).toBe(1920);
    expect(getThumbnailSourceWidth(source, {}, 180)).toBe(1920);
  });

  it('returns 0 when no dimensions are available', () => {
    expect(getThumbnailSourceWidth({} as CanvasImageSource, {}, 0)).toBe(0);
  });

  it('prefers codedWidth over displayWidth', () => {
    const source = { codedWidth: 1920, displayWidth: 1080 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceWidth(source, {}, 0)).toBe(1920);
  });
});

describe('getThumbnailSourceHeight', () => {
  it('returns codedHeight from image source', () => {
    const source = { codedHeight: 1080 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceHeight(source, {}, 0)).toBe(1080);
  });

  it('falls back through videoHeight, naturalHeight, height', () => {
    const source = { videoHeight: 480 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceHeight(source, {}, 0)).toBe(480);

    const source2 = { naturalHeight: 240 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceHeight(source2, {}, 0)).toBe(240);

    const source3 = { height: 120 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceHeight(source3, {}, 0)).toBe(120);
  });

  it('skips displayHeight for quarter-turn rotations', () => {
    const source = { displayHeight: 1920 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceHeight(source, {}, 90)).toBe(0);
    expect(getThumbnailSourceHeight(source, {}, 270)).toBe(0);
  });

  it('uses displayHeight for non-quarter-turn rotations', () => {
    const source = { displayHeight: 1080 } as unknown as CanvasImageSource;
    expect(getThumbnailSourceHeight(source, {}, 0)).toBe(1080);
  });

  it('returns 0 when no dimensions are available', () => {
    expect(getThumbnailSourceHeight({} as CanvasImageSource, {}, 0)).toBe(0);
  });
});

describe('drawRotatedThumbnailFrame', () => {
  function createMockCtx() {
    const calls: string[] = [];
    return {
      calls,
      ctx: {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        clearRect: (...args: unknown[]) => calls.push(`clearRect:${args.join(',')}`),
        translate: (...args: unknown[]) => calls.push(`translate:${args.join(',')}`),
        rotate: (rad: number) => calls.push(`rotate:${rad}`),
        drawImage: (...args: unknown[]) => calls.push(`drawImage:${args.join(',')}`),
      } as unknown as OffscreenCanvasRenderingContext2D,
    };
  }

  it('draws without rotation for 0 degrees', () => {
    const { ctx, calls } = createMockCtx();
    const image = {} as CanvasImageSource;
    drawRotatedThumbnailFrame({ ctx, imageSource: image, rotation: 0, targetW: 100, targetH: 50 });

    expect(calls).toContain('save');
    expect(calls).toContain('restore');
    expect(calls.some((c) => c.startsWith('drawImage:'))).toBe(true);
    // No translate/rotate for 0 degrees
    expect(calls.some((c) => c.startsWith('translate:'))).toBe(false);
    expect(calls.some((c) => c.startsWith('rotate:'))).toBe(false);
  });

  it('applies translate and rotate for 90 degrees', () => {
    const { ctx, calls } = createMockCtx();
    const image = {} as CanvasImageSource;
    drawRotatedThumbnailFrame({ ctx, imageSource: image, rotation: 90, targetW: 100, targetH: 50 });

    expect(calls.some((c) => c === 'translate:100,0')).toBe(true);
    expect(calls.some((c) => c === `rotate:${Math.PI / 2}`)).toBe(true);
    // drawImage with swapped dimensions for quarter-turn
    expect(calls.some((c) => c.startsWith('drawImage:'))).toBe(true);
  });

  it('applies translate and rotate for 180 degrees', () => {
    const { ctx, calls } = createMockCtx();
    const image = {} as CanvasImageSource;
    drawRotatedThumbnailFrame({
      ctx,
      imageSource: image,
      rotation: 180,
      targetW: 100,
      targetH: 50,
    });

    expect(calls.some((c) => c === 'translate:100,50')).toBe(true);
    expect(calls.some((c) => c === `rotate:${Math.PI}`)).toBe(true);
  });

  it('applies translate and rotate for 270 degrees', () => {
    const { ctx, calls } = createMockCtx();
    const image = {} as CanvasImageSource;
    drawRotatedThumbnailFrame({
      ctx,
      imageSource: image,
      rotation: 270,
      targetW: 100,
      targetH: 50,
    });

    expect(calls.some((c) => c === 'translate:0,50')).toBe(true);
    expect(calls.some((c) => c === `rotate:${-Math.PI / 2}`)).toBe(true);
  });

  it('always calls save and restore', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const { ctx, calls } = createMockCtx();
      drawRotatedThumbnailFrame({
        ctx,
        imageSource: {} as CanvasImageSource,
        rotation,
        targetW: 10,
        targetH: 10,
      });
      expect(calls[0]).toBe('save');
      expect(calls[calls.length - 1]).toBe('restore');
    }
  });
});

describe('serializeWorkerError', () => {
  it('serializes an Error instance', () => {
    const err = new Error('test error');
    err.name = 'TypeError';
    const result = serializeWorkerError(err);
    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('test error');
    expect(result.stack).toBe(err.stack);
  });

  it('serializes an Error with cause', () => {
    const cause = new Error('root cause');
    const err = new Error('wrapper', { cause });
    const result = serializeWorkerError(err);
    expect(result.cause).toBe(cause);
  });

  it('uses "Error" as default name for Error without name', () => {
    const err = new Error('no name');
    err.name = '';
    const result = serializeWorkerError(err);
    expect(result.name).toBe('Error');
  });

  it('serializes non-Error values', () => {
    expect(serializeWorkerError('string error')).toEqual({
      name: 'Error',
      message: 'string error',
    });
    expect(serializeWorkerError(42)).toEqual({
      name: 'Error',
      message: '42',
    });
    expect(serializeWorkerError({ custom: true })).toEqual({
      name: 'Error',
      message: '[object Object]',
    });
  });

  it('serializes null', () => {
    const result = serializeWorkerError(null);
    expect(result.name).toBe('Error');
    expect(result.message).toBe('null');
  });

  it('serializes undefined', () => {
    const result = serializeWorkerError(undefined);
    expect(result.name).toBe('Error');
    expect(result.message).toBe('undefined');
  });
});

describe('disposeFrameExtractorState', () => {
  it('closes sink with close method', () => {
    const close = vi.fn();
    const state: FrameExtractorState = {
      source: {},
      input: {},
      sink: { getSample: () => Promise.resolve(null), close },
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
    disposeFrameExtractorState(state);
    expect(close).toHaveBeenCalled();
    expect(state.sink).toBeNull();
  });

  it('disposes sink with dispose method when close is not available', () => {
    const dispose = vi.fn();
    const state: FrameExtractorState = {
      source: {},
      input: {},
      sink: { getSample: () => Promise.resolve(null), dispose },
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
    disposeFrameExtractorState(state);
    expect(dispose).toHaveBeenCalled();
    expect(state.sink).toBeNull();
  });

  it('disposes input with dispose method', () => {
    const dispose = vi.fn();
    const state: FrameExtractorState = {
      source: {},
      input: { dispose },
      sink: null,
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
    disposeFrameExtractorState(state);
    expect(dispose).toHaveBeenCalled();
    expect(state.input).toBeNull();
  });

  it('disposes input with close method when dispose is not available', () => {
    const close = vi.fn();
    const state: FrameExtractorState = {
      source: {},
      input: { close },
      sink: null,
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
    disposeFrameExtractorState(state);
    expect(close).toHaveBeenCalled();
  });

  it('clears all state fields', () => {
    const state: FrameExtractorState = {
      source: {},
      input: {},
      sink: { getSample: () => Promise.resolve(null), close: () => {} },
      firstTimestampS: 1.5,
      rotation: 90,
      canvas: new OffscreenCanvas(10, 10),
      ctx: null,
    };
    disposeFrameExtractorState(state);
    expect(state.source).toBeNull();
    expect(state.input).toBeNull();
    expect(state.sink).toBeNull();
    expect(state.canvas).toBeNull();
    expect(state.ctx).toBeNull();
  });

  it('handles null sink gracefully', () => {
    const state: FrameExtractorState = {
      source: {},
      input: null,
      sink: null,
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
    expect(() => disposeFrameExtractorState(state)).not.toThrow();
  });

  it('swallows errors from sink.close', () => {
    const state: FrameExtractorState = {
      source: {},
      input: null,
      sink: {
        getSample: () => Promise.resolve(null),
        close: () => {
          throw new Error('close failed');
        },
      },
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
    expect(() => disposeFrameExtractorState(state)).not.toThrow();
    expect(state.sink).toBeNull();
  });

  it('swallows errors from input.dispose', () => {
    const state: FrameExtractorState = {
      source: {},
      input: {
        dispose: () => {
          throw new Error('dispose failed');
        },
      },
      sink: null,
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
    expect(() => disposeFrameExtractorState(state)).not.toThrow();
    expect(state.input).toBeNull();
  });
});
