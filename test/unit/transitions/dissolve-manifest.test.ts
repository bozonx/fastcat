/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('dissolve transition manifest', () => {
  it('defines valid defaults and spec generation', () => {
    const manifest = getTransitionManifestByType('dissolve');
    expect(manifest).toBeDefined();

    expect(manifest?.defaultDurationTicks).toBe(TICKS_PER_SECOND / 2);
    expect(manifest?.supportedModes).toEqual(['adjacent', 'background', 'transparent']);
    expect(manifest?.experimental ?? false).toBe(false);

    const spec = manifest?.toTransitionSpec?.(manifest.defaultParams);
    expect(spec).toEqual({ type: 'crossfade' });
  });
});
