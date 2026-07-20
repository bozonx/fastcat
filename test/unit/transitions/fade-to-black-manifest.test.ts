/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('fade-to-black transition manifest', () => {
  it('defines valid defaults and spec generation with color normalization', () => {
    const manifest = getTransitionManifestByType('fade-to-black');
    expect(manifest).toBeDefined();

    expect(manifest?.defaultDurationTicks).toBe((7 * TICKS_PER_SECOND) / 10);
    expect(manifest?.experimental ?? false).toBe(false);
    expect(manifest?.supportedModes).toEqual(['adjacent', 'background', 'transparent']);

    const specHex = manifest?.toTransitionSpec?.({ color: '#ff6600' });
    expect(specHex).toEqual({
      type: 'fade-through-color',
      color: '#ff6600',
    });

    const specFallback = manifest?.toTransitionSpec?.({ color: 'invalid-color' });
    expect(specFallback).toEqual({
      type: 'fade-through-color',
      color: '#000000',
    });
  });
});
