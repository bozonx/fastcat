/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  ClipScaleSchema,
  ClipAnchorSchema,
  ClipPositionSchema,
  ClipCropSchema,
  ClipTransformSchema,
  TimelineBlendModeSchema,
  AudioFadeCurveSchema,
  TimelineClipTypeSchema,
  TimelineClipFastCatMetaSchema,
  TimelineTrackFastCatMetaSchema,
  TimelineDocFastCatMetaSchema,
} from '~/timeline/otio/schemas';

describe('ClipScaleSchema', () => {
  it('parses valid scale', () => {
    expect(ClipScaleSchema.parse({ x: 2, y: 1 })).toEqual({ x: 2, y: 1 });
  });

  it('catches invalid values with defaults', () => {
    expect(ClipScaleSchema.parse({ x: 'invalid', y: 'invalid' })).toEqual({ x: 1, y: 1 });
  });
});

describe('ClipAnchorSchema', () => {
  it('parses valid anchor', () => {
    expect(ClipAnchorSchema.parse({ preset: 'center' })).toEqual({ preset: 'center' });
  });

  it('catches invalid preset with default', () => {
    expect(ClipAnchorSchema.parse({ preset: 'invalid' })).toEqual({ preset: 'center' });
  });
});

describe('ClipPositionSchema', () => {
  it('parses valid position', () => {
    expect(ClipPositionSchema.parse({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('catches invalid values with defaults', () => {
    expect(ClipPositionSchema.parse({ x: 'invalid', y: 'invalid' })).toEqual({ x: 0, y: 0 });
  });
});

describe('ClipCropSchema', () => {
  it('parses valid crop', () => {
    expect(ClipCropSchema.parse({ top: 10, bottom: 10 })).toEqual({ top: 10, bottom: 10 });
  });

  it('allows empty crop', () => {
    expect(ClipCropSchema.parse({})).toEqual({});
  });
});

describe('ClipTransformSchema', () => {
  it('parses valid transform', () => {
    const result = ClipTransformSchema.parse({ scale: { x: 2, y: 1 }, rotationDeg: 45 });
    expect(result.scale).toEqual({ x: 2, y: 1 });
    expect(result.rotationDeg).toBe(45);
  });

  it('allows empty transform', () => {
    expect(ClipTransformSchema.parse({})).toEqual({});
  });
});

describe('TimelineBlendModeSchema', () => {
  it('parses valid blend modes', () => {
    expect(TimelineBlendModeSchema.parse('normal')).toBe('normal');
    expect(TimelineBlendModeSchema.parse('multiply')).toBe('multiply');
  });

  it('throws for invalid blend mode', () => {
    expect(() => TimelineBlendModeSchema.parse('invalid')).toThrow();
  });
});

describe('AudioFadeCurveSchema', () => {
  it('parses valid curves', () => {
    expect(AudioFadeCurveSchema.parse('linear')).toBe('linear');
    expect(AudioFadeCurveSchema.parse('logarithmic')).toBe('logarithmic');
  });

  it('throws for invalid curve', () => {
    expect(() => AudioFadeCurveSchema.parse('invalid')).toThrow();
  });
});

describe('TimelineClipTypeSchema', () => {
  it('parses valid clip types', () => {
    expect(TimelineClipTypeSchema.parse('media')).toBe('media');
    expect(TimelineClipTypeSchema.parse('text')).toBe('text');
  });

  it('throws for invalid type', () => {
    expect(() => TimelineClipTypeSchema.parse('invalid')).toThrow();
  });
});

describe('TimelineClipFastCatMetaSchema', () => {
  it('parses valid metadata', () => {
    const result = TimelineClipFastCatMetaSchema.parse({
      id: 'clip-1',
      clipType: 'media',
      playback: { speed: 2 },
    });
    expect(result.id).toBe('clip-1');
    expect(result.clipType).toBe('media');
    expect(result.playback?.speed).toBe(2);
  });

  it('returns empty object for invalid input', () => {
    const result = TimelineClipFastCatMetaSchema.parse('invalid');
    expect(result).toEqual({});
  });
});

describe('TimelineTrackFastCatMetaSchema', () => {
  it('parses valid track metadata', () => {
    const result = TimelineTrackFastCatMetaSchema.parse({
      id: 'track-1',
      kind: 'video',
      video: { hidden: false },
    });
    expect(result.id).toBe('track-1');
    expect(result.kind).toBe('video');
  });

  it('returns empty object for invalid input', () => {
    expect(TimelineTrackFastCatMetaSchema.parse('invalid')).toEqual({});
  });
});

describe('TimelineDocFastCatMetaSchema', () => {
  it('parses valid document metadata', () => {
    const result = TimelineDocFastCatMetaSchema.parse({
      version: 1,
      docId: 'doc-1',
      timebase: { fps: 30 },
    });
    expect(result.version).toBe(1);
    expect(result.docId).toBe('doc-1');
  });

  it('returns empty object for invalid input', () => {
    expect(TimelineDocFastCatMetaSchema.parse('invalid')).toEqual({});
  });
});
