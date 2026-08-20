import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';

describe('bloom transition quality', () => {
  it('stores the quality-controlled sample budget in the shared transition spec', () => {
    const manifest = getTransitionManifestByType('bloom');
    const medium = manifest?.toTransitionSpec?.(manifest.defaultParams, 1, {
      previewBlurQuality: 'medium',
    });
    const ultra = manifest?.toTransitionSpec?.(manifest.defaultParams, 1, {
      previewBlurQuality: 'ultra',
    });

    expect(medium?.params).toMatchObject({ p3: 9 });
    expect(ultra?.params).toMatchObject({ p3: 25 });
  });
});
