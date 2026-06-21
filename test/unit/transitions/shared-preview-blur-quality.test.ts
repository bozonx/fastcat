/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';

function getShaderSource(type: string): string {
  const manifest = getTransitionManifestByType(type);
  const spec = manifest?.toTransitionSpec?.(manifest.defaultParams as Record<string, unknown>, 1, {
    isPlaying: true,
    previewBlurQuality: 'medium',
  });

  expect(spec?.type).toBe('custom-wgsl');
  return spec?.source ?? '';
}

describe('shared preview blur shader optimization', () => {
  it('scales blinds and zoom samples by pixel-space blur length', () => {
    expect(getShaderSource('blinds')).toContain(
      'let pixel_blur = mb * length(vec2<f32>(uni.p0, uni.p1) * dims());',
    );
    expect(getShaderSource('zoom')).toContain(
      'let pixel_blur = blur_amount * length(dir * dims());',
    );
  });

  it('keeps zoom blur extent independent from sample count', () => {
    expect(getShaderSource('zoom')).toContain('let t = i / max(samples - 1.0, 1.0);');
  });

  it('scales bloom transition disk sampling with preview quality', () => {
    const manifest = getTransitionManifestByType('bloom');
    const params = manifest?.defaultParams as Record<string, unknown>;

    expect(
      manifest?.toTransitionSpec?.(params, 1, {
        isPlaying: true,
        previewBlurQuality: 'low',
      }).params,
    ).toMatchObject({ p3: 5 });
    expect(
      manifest?.toTransitionSpec?.(params, 1, {
        isPlaying: true,
        previewBlurQuality: 'ultra',
      }).params,
    ).toMatchObject({ p3: 25 });
    expect(getShaderSource('bloom')).toContain('for (var i = 0; i < 25; i = i + 1)');
  });

  it('scales each card-swap radial branch independently with a four-sample minimum', () => {
    const source = getShaderSource('card-swap');

    expect(source).toContain('rad_pixels_fr = blur_fr * max(dims().x, dims().y);');
    expect(source).toContain('rad_pixels_to = blur_to * max(dims().x, dims().y);');
    expect(source).toContain('let samples = clamp(i32(ceil(rad_pixels_fr)), 4, max_samples);');
    expect(source).toContain('let samples = clamp(i32(ceil(rad_pixels_to)), 4, max_samples);');
  });

  it('disables edge anti-aliasing for perspective transitions in low/medium preview quality', () => {
    const low = { isPlaying: true, previewBlurQuality: 'low' };
    const medium = { isPlaying: true, previewBlurQuality: 'medium' };
    const high = { isPlaying: true, previewBlurQuality: 'high' };
    const ultra = { isPlaying: true, previewBlurQuality: 'ultra' };

    const cube = getTransitionManifestByType('cube');
    expect(
      cube?.toTransitionSpec?.(cube?.defaultParams as Record<string, unknown>, 1, low).params,
    ).toMatchObject({ p6: 1 });
    expect(
      cube?.toTransitionSpec?.(cube?.defaultParams as Record<string, unknown>, 1, medium).params,
    ).toMatchObject({ p6: 1 });
    expect(
      cube?.toTransitionSpec?.(cube?.defaultParams as Record<string, unknown>, 1, high).params,
    ).toMatchObject({ p6: 8 });
    expect(
      cube?.toTransitionSpec?.(cube?.defaultParams as Record<string, unknown>, 1, ultra).params,
    ).toMatchObject({ p6: 8 });

    const fallingCard = getTransitionManifestByType('falling-card');
    expect(
      fallingCard?.toTransitionSpec?.(fallingCard?.defaultParams as Record<string, unknown>, 1, low)
        .params,
    ).toMatchObject({ p4: 1 });
    expect(
      fallingCard?.toTransitionSpec?.(
        fallingCard?.defaultParams as Record<string, unknown>,
        1,
        medium,
      ).params,
    ).toMatchObject({ p4: 1 });
    expect(
      fallingCard?.toTransitionSpec?.(
        fallingCard?.defaultParams as Record<string, unknown>,
        1,
        high,
      ).params,
    ).toMatchObject({ p4: 8 });
    expect(
      fallingCard?.toTransitionSpec?.(
        fallingCard?.defaultParams as Record<string, unknown>,
        1,
        ultra,
      ).params,
    ).toMatchObject({ p4: 8 });

    const cardSwap = getTransitionManifestByType('card-swap');
    expect(
      cardSwap?.toTransitionSpec?.(cardSwap?.defaultParams as Record<string, unknown>, 1, low)
        .params,
    ).toMatchObject({ p9: 1 });
    expect(
      cardSwap?.toTransitionSpec?.(cardSwap?.defaultParams as Record<string, unknown>, 1, medium)
        .params,
    ).toMatchObject({ p9: 1 });
    expect(
      cardSwap?.toTransitionSpec?.(cardSwap?.defaultParams as Record<string, unknown>, 1, high)
        .params,
    ).toMatchObject({ p9: 8 });
    expect(
      cardSwap?.toTransitionSpec?.(cardSwap?.defaultParams as Record<string, unknown>, 1, ultra)
        .params,
    ).toMatchObject({ p9: 8 });

    const zoom = getTransitionManifestByType('zoom');
    expect(
      zoom?.toTransitionSpec?.(zoom?.defaultParams as Record<string, unknown>, 1, low).params,
    ).toMatchObject({ p7: 1 });
    expect(
      zoom?.toTransitionSpec?.(zoom?.defaultParams as Record<string, unknown>, 1, medium).params,
    ).toMatchObject({ p7: 1 });
    expect(
      zoom?.toTransitionSpec?.(zoom?.defaultParams as Record<string, unknown>, 1, high).params,
    ).toMatchObject({ p7: 8 });
    expect(
      zoom?.toTransitionSpec?.(zoom?.defaultParams as Record<string, unknown>, 1, ultra).params,
    ).toMatchObject({ p7: 8 });
  });

  it('reads the edge-AA grid size from quality uniforms in perspective shaders', () => {
    expect(getShaderSource('cube')).toContain('let ss = i32(clamp(uni.p6, 1.0, 8.0));');
    expect(getShaderSource('falling-card')).toContain('let ss = i32(clamp(uni.p4, 1.0, 8.0));');
    expect(getShaderSource('card-swap')).toContain('let ss = i32(clamp(uni.p9, 1.0, 8.0));');
    expect(getShaderSource('zoom')).toContain(
      'fn layer_coverage(uv: vec2<f32>, angle: f32, scale: f32, aspect: f32, ss: i32)',
    );
  });
});
