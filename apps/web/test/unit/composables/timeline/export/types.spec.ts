/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { parseWorkerVideoPayload } from '~/composables/timeline/export/types';

function makeValidClip(): unknown {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-a',
    layer: 0,
    speed: 1,
    source: { path: '/media/test.mp4' },
    timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
  };
}

function makeValidTrack(): unknown {
  return {
    kind: 'track',
    id: 'track-a',
    layer: 1,
  };
}

function makeValidMeta(): unknown {
  return {
    kind: 'meta',
    masterEffects: [],
  };
}

describe('parseWorkerVideoPayload', () => {
  it('accepts a valid mixed payload', () => {
    const payload = [makeValidMeta(), makeValidTrack(), makeValidClip()];
    const result = parseWorkerVideoPayload(payload);
    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({ kind: 'clip', id: 'clip-1' });
  });

  it('accepts a clip with optional fields omitted', () => {
    const clip = {
      kind: 'clip',
      clipType: 'text',
      id: 'clip-2',
      layer: 0,
      timelineRange: { startTicks: 0, durationTicks: 500_000 },
      sourceRange: { startTicks: 0, durationTicks: 500_000 },
    };
    const result = parseWorkerVideoPayload([clip]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'clip', clipType: 'text' });
  });

  it('throws on a clip missing required timelineRange', () => {
    const clip = {
      kind: 'clip',
      clipType: 'media',
      id: 'clip-3',
      layer: 0,
      sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
    };
    expect(() => parseWorkerVideoPayload([clip])).toThrow();
  });

  it('throws on a clip with negative durationTicks', () => {
    const clip = {
      kind: 'clip',
      clipType: 'media',
      id: 'clip-4',
      layer: 0,
      timelineRange: { startTicks: 0, durationTicks: -100 },
      sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
    };
    expect(() => parseWorkerVideoPayload([clip])).toThrow();
  });

  it('throws on a track missing id', () => {
    const track = {
      kind: 'track',
      layer: 1,
    };
    expect(() => parseWorkerVideoPayload([track])).toThrow();
  });

  it('throws on a meta missing masterEffects array', () => {
    const meta = {
      kind: 'meta',
    };
    expect(() => parseWorkerVideoPayload([meta])).toThrow();
  });

  it('throws on unknown kind', () => {
    const item = {
      kind: 'unknown',
      id: 'x',
    };
    expect(() => parseWorkerVideoPayload([item])).toThrow();
  });
});
