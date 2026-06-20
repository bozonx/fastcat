import { describe, expect, it } from 'vitest';
import { bloomManifest } from '~/transitions/bloom/manifest';

describe('bloom transition quality', () => {
  it('normalizes the hidden renderer quality parameter', () => {
    expect(bloomManifest.normalizeParams?.({ blurQuality: 'low' })).toMatchObject({
      blurQuality: 'low',
    });
    expect(bloomManifest.normalizeParams?.({ blurQuality: 'invalid' })).toMatchObject({
      blurQuality: 'medium',
    });
  });

  it('stores the quality-controlled sample budget in the filter uniforms', () => {
    const filter = bloomManifest.createFilter?.();
    const uniforms = (
      filter as unknown as {
        resources?: { bloomUniforms?: { uniforms?: Record<string, unknown> } };
      }
    )?.resources?.bloomUniforms?.uniforms;

    expect(uniforms?.uBlurSamples).toBe(9);
    bloomManifest.updateFilter?.(
      filter!,
      {
        progress: 0.5,
        curve: 'linear',
        params: { blurQuality: 'ultra' },
      } as never,
    );
    expect(uniforms?.uBlurSamples).toBe(25);
    filter?.destroy();
  });
});
