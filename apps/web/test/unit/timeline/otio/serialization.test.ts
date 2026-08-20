/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  serializeEffects,
  parseEffects,
  serializeTimeEffects,
  parseTimeEffects,
  serializeMarker,
  parseOtioMarkers,
  buildOtioTransition,
  parseOtioTransition,
  parseFastCatTransition,
} from '~/timeline/otio/serialization';

vi.mock('~/transitions', () => ({
  normalizeTransitionCurve: vi.fn((c) => c ?? 'linear'),
  normalizeTransitionMode: vi.fn((m) => m ?? 'adjacent'),
}));

describe('serializeEffects', () => {
  it('returns undefined for empty array', () => {
    expect(serializeEffects([])).toBeUndefined();
    expect(serializeEffects(undefined)).toBeUndefined();
  });

  it('serializes effects to otio format', () => {
    const effects = [{ id: 'e1', type: 'blur', enabled: true, target: 'video', amount: 5 }];
    const result = serializeEffects(effects as any);
    expect(result).toHaveLength(1);
    expect(result![0].OTIO_SCHEMA).toBe('Effect.1');
    expect(result![0].effect_name).toBe('fastcat:blur');
  });
});

describe('parseEffects', () => {
  it('parses otio effects', () => {
    const raw = [
      {
        OTIO_SCHEMA: 'Effect.1',
        name: 'blur',
        effect_name: 'fastcat:blur',
        enabled: true,
        metadata: { fastcat: { effect: { id: 'e1', type: 'blur', target: 'video' } } },
      },
    ];
    const result = parseEffects(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
    expect(result[0].type).toBe('blur');
  });

  it('skips invalid effects', () => {
    expect(parseEffects([null, {}, { OTIO_SCHEMA: 'Other.1' }])).toEqual([]);
  });
});

describe('serializeTimeEffects', () => {
  it('serializes speed effect', () => {
    const result = serializeTimeEffects({ speed: 2, speedActive: true });
    expect(result).toHaveLength(1);
    expect(result![0].OTIO_SCHEMA).toBe('LinearTimeWarp.1');
  });

  it('serializes freeze frame effect', () => {
    const result = serializeTimeEffects({ freezeFrameSourceTicks: 500_000 });
    expect(result).toHaveLength(1);
    expect(result![0].OTIO_SCHEMA).toBe('FreezeFrame.1');
  });

  it('returns undefined when no effects', () => {
    expect(serializeTimeEffects({})).toBeUndefined();
  });
});

describe('parseTimeEffects', () => {
  it('parses speed from LinearTimeWarp', () => {
    const result = parseTimeEffects([{ OTIO_SCHEMA: 'LinearTimeWarp.1', time_scalar: 2 }]);
    expect(result.speed).toBe(2);
    expect(result.speedActive).toBe(true);
  });

  it('parses freeze frame from metadata', () => {
    const result = parseTimeEffects([
      {
        OTIO_SCHEMA: 'FreezeFrame.1',
        metadata: { fastcat: { effect: { params: { freezeFrameSourceTicks: 500_000 } } } },
      },
    ]);
    expect(result.freezeFrameSourceTicks).toBe(500_000);
  });
});

describe('serializeMarker', () => {
  it('serializes marker to otio format', () => {
    const marker = { id: 'm1', timeTicks: 1_000_000, text: 'Marker', color: 'red' };
    const result = serializeMarker(marker as any);
    expect(result.OTIO_SCHEMA).toBe('Marker.2');
    expect(result.color).toBe('RED');
    expect(result.name).toBe('Marker');
  });
});

describe('parseOtioMarkers', () => {
  it('parses otio markers', () => {
    const raw = [
      {
        OTIO_SCHEMA: 'Marker.2',
        comment: 'Test',
        marked_range: { start_time: { value: 30, rate: 30 }, duration: { value: 0, rate: 30 } },
        metadata: { fastcat: { marker: { id: 'm1', color: 'red' } } },
      },
    ];
    const result = parseOtioMarkers(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
    expect(result[0].text).toBe('Test');
  });

  it('returns empty array for non-array input', () => {
    expect(parseOtioMarkers(null)).toEqual([]);
  });
});

describe('buildOtioTransition', () => {
  it('returns null for invalid transition', () => {
    expect(buildOtioTransition({ type: '', durationTicks: 0 } as any, 'name')).toBeNull();
  });

  it('builds otio transition', () => {
    const result = buildOtioTransition(
      { type: 'dissolve', durationTicks: 500_000 } as any,
      'trans',
    );
    expect(result?.OTIO_SCHEMA).toBe('Transition.1');
    expect(result?.transition_type).toBe('SMPTE_Dissolve');
  });
});

describe('parseOtioTransition', () => {
  it('returns null for invalid input', () => {
    expect(parseOtioTransition(null)).toBeNull();
    expect(parseOtioTransition({ OTIO_SCHEMA: 'Other.1' })).toBeNull();
  });

  it('parses otio transition', () => {
    const result = parseOtioTransition({
      OTIO_SCHEMA: 'Transition.1',
      transition_type: 'SMPTE_Dissolve',
      in_offset: { value: 250_000, rate: 1_000_000 },
      out_offset: { value: 250_000, rate: 1_000_000 },
      metadata: { fastcat: { transition: { type: 'dissolve', durationTicks: 500_000 } } },
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('dissolve');
    expect(result?.durationTicks).toBe(500_000);
  });
});

describe('parseFastCatTransition', () => {
  it('returns undefined for invalid input', () => {
    expect(parseFastCatTransition(null)).toBeUndefined();
    expect(parseFastCatTransition({})).toBeUndefined();
  });

  it('parses fastcat transition', () => {
    const result = parseFastCatTransition({ type: 'dissolve', durationTicks: 500_000 });
    expect(result).toEqual(expect.objectContaining({ type: 'dissolve', durationTicks: 500_000 }));
  });
});
