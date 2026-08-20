import { describe, expect, it } from 'vitest';
import { getEffectNumericInputRanges } from '~/effects/param-ranges';

describe('getEffectNumericInputRanges', () => {
  it('maps animation bounds to numeric input bounds', () => {
    expect(
      getEffectNumericInputRanges({
        radius: {
          uiMin: 0,
          uiMax: 100,
          animationMin: 0,
          animationMax: 512,
          renderMin: 0,
          renderMax: 1024,
        },
      }),
    ).toEqual({ radius: { min: 0, max: 512 } });
  });

  it('does not add bounds when an effect has no animation ranges', () => {
    expect(getEffectNumericInputRanges(undefined)).toBeUndefined();
  });
});
