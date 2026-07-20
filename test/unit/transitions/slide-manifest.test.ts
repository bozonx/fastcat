/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('slide transition manifest', () => {
  it('defines valid defaults and spec generation across directions', () => {
    const manifest = getTransitionManifestByType('slide');
    expect(manifest).toBeDefined();

    expect(manifest?.defaultDurationTicks).toBe(TICKS_PER_SECOND / 2);
    expect(manifest?.experimental ?? false).toBe(false);

    const specLeft = manifest?.toTransitionSpec?.({
      direction: 'left',
      gap: 0.02,
      gapColor: '#000000',
    });
    expect(specLeft?.type).toBe('custom-wgsl');
    expect(specLeft?.params).toMatchObject({
      p0: 0,
      p1: 0.02,
    });

    const specRight = manifest?.toTransitionSpec?.({
      direction: 'right',
      gap: 0.02,
      gapColor: '#000000',
    });
    expect(specRight?.params).toMatchObject({
      p0: 1,
      p1: 0.02,
    });

    const specUp = manifest?.toTransitionSpec?.({
      direction: 'up',
      gap: 0.02,
      gapColor: '#000000',
    });
    expect(specUp?.params).toMatchObject({
      p0: 2,
      p1: 0.02,
    });

    const specDown = manifest?.toTransitionSpec?.({
      direction: 'down',
      gap: 0.02,
      gapColor: '#000000',
    });
    expect(specDown?.params).toMatchObject({
      p0: 3,
      p1: 0.02,
    });
  });

  it('marks motion blur and post-blur parameter fields as experimental', () => {
    const manifest = getTransitionManifestByType('slide');
    const fields = manifest?.paramFields ?? [];

    const motionBlurField = fields.find((f) => f.key === 'motionBlur');
    expect(motionBlurField?.experimental).toBe(true);

    const brightnessField = fields.find((f) => f.key === 'brightness');
    expect(brightnessField?.experimental).toBe(true);
  });
});
