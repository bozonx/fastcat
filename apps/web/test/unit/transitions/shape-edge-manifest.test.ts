/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';

describe.each(['circle', 'rectangle'] as const)('%s transition edge mode', (type) => {
  it('keeps blurred edges as the default', () => {
    const manifest = getTransitionManifestByType(type);

    expect(manifest?.defaultParams).toMatchObject({
      edgeMode: 'blur',
      strokeColor: '#000000',
      strokeWidth: 2,
      strokeMode: 'fixed',
    });
  });

  it('maps a stroke color and width to the shared WGSL parameters', () => {
    const manifest = getTransitionManifestByType(type);
    const spec = manifest?.toTransitionSpec?.({
      edgeMode: 'stroke',
      strokeColor: '#3366cc',
      strokeWidth: 4,
    });

    expect(spec?.params).toMatchObject({
      p0: 0.8,
      p8: 1,
      p9: 0.04,
      p10: 0.2,
      p11: 0.4,
    });
  });

  it('maps scaled stroke mode to the shared WGSL parameters', () => {
    const manifest = getTransitionManifestByType(type);
    const spec = manifest?.toTransitionSpec?.({
      edgeMode: 'stroke',
      strokeMode: 'scaled',
    });

    expect(spec?.params).toMatchObject({ p8: 2 });
  });
});
