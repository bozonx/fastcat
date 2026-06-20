/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';

describe('shared motion blur transition manifest', () => {
  const manifest = getTransitionManifestByType('motion-blur');

  it('exposes a native adjacent shader transition with normalized defaults', () => {
    expect(manifest).toMatchObject({
      type: 'motion-blur',
      renderer: 'wgpu',
      supportedModes: ['adjacent'],
      defaultParams: {
        angle: 0,
        motionBlur: 50,
        blurQuality: 'medium',
        motionBlurMode: 'normal',
        brightness: 0,
        bloomThreshold: 0.7,
      },
    });
  });

  it('normalizes invalid and out-of-range parameters', () => {
    expect(
      manifest?.normalizeParams?.({
        angle: 400,
        motionBlur: -10,
        blurQuality: 'invalid',
        motionBlurMode: 'invalid',
        brightness: 20,
        bloomThreshold: -1,
      }),
    ).toEqual({
      angle: 180,
      motionBlur: 0,
      blurQuality: 'medium',
      motionBlurMode: 'normal',
      brightness: 10,
      bloomThreshold: 0,
    });
  });

  it('builds a directional WGSL spec and scales blur by transition duration', () => {
    const spec = manifest?.toTransitionSpec?.(
      {
        angle: 90,
        motionBlur: 40,
        blurQuality: 'high',
        motionBlurMode: 'bloom',
        brightness: 0.5,
        bloomThreshold: 0.8,
      },
      2,
    );

    expect(spec?.type).toBe('custom-wgsl');
    expect(spec?.source).toContain('let envelope = sin(progress * PI);');
    expect(spec?.params).toMatchObject({
      p1: 1,
      p2: 0.1,
      p3: 32,
      p4: 1,
      p5: 0.5,
      p6: 0.8,
    });
    expect((spec?.params as Record<string, number> | undefined)?.p0).toBeCloseTo(0);
  });

  it('uses ultra sampling for export and paused preview', () => {
    const params = manifest?.defaultParams as Record<string, unknown>;

    const exportSpec = manifest?.toTransitionSpec?.(params, 1, { isExport: true });
    const pausedSpec = manifest?.toTransitionSpec?.(params, 1, { isPlaying: false });

    expect(exportSpec?.params).toMatchObject({ p3: 64 });
    expect(pausedSpec?.params).toMatchObject({ p3: 64 });
  });
});
