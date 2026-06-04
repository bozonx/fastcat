import { describe, it, expect } from 'vitest';
import {
  BlendModeSchema,
  ShapeTypeSchema,
  ClipTransformSchema,
  ClipTransitionSchema,
  ClipEffectSchema,
} from '~/timeline/clip-schemas';
import {
  parseWorkerVideoPayload,
  type WorkerVideoPayloadItem,
} from '~/composables/timeline/export/types';

describe('clip-schemas', () => {
  it('accepts valid enum values and rejects invalid ones', () => {
    expect(BlendModeSchema.parse('multiply')).toBe('multiply');
    expect(() => BlendModeSchema.parse('not-a-blend')).toThrow();
    expect(ShapeTypeSchema.parse('star')).toBe('star');
    expect(() => ShapeTypeSchema.parse('hexagon')).toThrow();
  });

  it('validates known transform fields and rejects non-finite numbers', () => {
    const transform = ClipTransformSchema.parse({
      scale: { x: 1.5, y: 1 },
      rotationDeg: 90,
      position: { x: 10, y: -20 },
    });
    expect(transform).toMatchObject({ rotationDeg: 90, position: { x: 10 } });
    expect(() => ClipTransformSchema.parse({ position: { x: Infinity, y: 0 } })).toThrow();
  });

  it('keeps open-ended effect params via passthrough', () => {
    const effect = ClipEffectSchema.parse({
      id: 'e1',
      type: 'blur',
      enabled: true,
      // arbitrary effect-specific params must survive validation
      strength: 0.8,
      nested: { radius: 4 },
    });
    expect(effect).toMatchObject({ type: 'blur', strength: 0.8, nested: { radius: 4 } });
  });

  it('validates transition shape', () => {
    expect(() => ClipTransitionSchema.parse({ type: 'dissolve', durationUs: -1 })).toThrow();
    expect(ClipTransitionSchema.parse({ type: 'dissolve', durationUs: 100_000 })).toMatchObject({
      durationUs: 100_000,
    });
  });

  it('rejects an invalid blendMode at the worker payload boundary', () => {
    const badClip = {
      kind: 'clip',
      clipType: 'media',
      id: 'c1',
      layer: 0,
      blendMode: 'totally-invalid',
      timelineRange: { startUs: 0, durationUs: 1000 },
      sourceRange: { startUs: 0, durationUs: 1000 },
    };
    expect(() => parseWorkerVideoPayload([badClip])).toThrow();
  });

  it('accepts a fully-populated clip at the worker payload boundary', () => {
    const clip: WorkerVideoPayloadItem = {
      kind: 'clip',
      clipType: 'media',
      id: 'c1',
      layer: 0,
      blendMode: 'screen',
      opacity: 0.5,
      source: { path: 'a.mp4' },
      effects: [{ id: 'e1', type: 'blur', enabled: true } as never],
      transform: { rotationDeg: 0, scale: { x: 1, y: 1 } },
      transitionIn: { type: 'dissolve', durationUs: 100_000, mode: 'adjacent' },
      timelineRange: { startUs: 0, durationUs: 1000 },
      sourceRange: { startUs: 0, durationUs: 1000 },
    };
    const parsed = parseWorkerVideoPayload([clip]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'c1', blendMode: 'screen' });
  });
});
