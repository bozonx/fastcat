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

  it('gates analytic edge AA on the quality uniform in perspective shaders', () => {
    // Perspective transitions replace fixed N*N coverage supersampling with analytic
    // box_coverage() from screen-space derivatives, gated on the quality uniform
    // (>1.5 = high/ultra AA, otherwise a hard inside test for low/medium).
    const cube = getShaderSource('cube');
    expect(cube).toContain('if (uni.p6 > 1.5)');
    expect(cube).toContain('box_coverage(center.from_p, px.from_p, py.from_p)');

    const falling = getShaderSource('falling-card');
    expect(falling).toContain('if (uni.p4 > 1.5)');
    expect(falling).toContain('box_coverage(p_moved, mx.p_moved, my.p_moved)');

    const card = getShaderSource('card-swap');
    expect(card).toContain('if (uni.p9 > 1.5)');
    expect(card).toContain('box_coverage(pfr, mx.pfr, my.pfr)');
    expect(card).toContain('box_coverage(pto, mx.pto, my.pto)');

    expect(getShaderSource('zoom')).toContain(
      'fn layer_coverage(uv: vec2<f32>, angle: f32, scale: f32, aspect: f32, ss: i32)',
    );
  });

  it('uses aspect-aware analytic AA for hard-edge masks', () => {
    expect(getShaderSource('wipe')).toContain(
      '0.5 * (abs(dir.x) / f32(uni.width) + abs(dir.y) / f32(uni.height))',
    );
    expect(getShaderSource('barn-door')).toContain('0.5 * (abs(axis.x) + abs(axis.y)) / dims().y');
    expect(getShaderSource('clock')).toContain('0.5 * angle_per_pixel / angle_range');
    expect(getShaderSource('circle')).toContain(
      '0.5 * (normal.x / scale.x + normal.y / scale.y) / dims().y',
    );
    expect(getShaderSource('rectangle')).toContain('let aa = 0.5 / dims().y;');
  });

  it('uses one-pixel coverage instead of a wide smoothstep for slide edges', () => {
    const source = getShaderSource('slide');

    expect(source).toContain('fn unit_interval_coverage(value: f32, pixel_size: f32)');
    expect(source).toContain('min(value, 1.0 - value) / pixel_size + 0.5');
    expect(source).toContain('gap_half - abs(coord_a - seam)) / pixel_size + 0.5');
    expect(source).toContain('+ vec2<f32>(0.5, 0.5)');
    expect(source).not.toContain('let aa = 1.5 /');
  });

  it('box-filters the angled strip boundary in blinds', () => {
    const source = getShaderSource('blinds');

    expect(source).toContain('fn blinds_get_strip(uv: vec2<f32>, strip_index: f32)');
    expect(source).toContain('let strip_footprint = uni.p4 * (');
    expect(source).toContain('abs(uni.p2) / f32(uni.width) + abs(uni.p3) / f32(uni.height)');
    expect(source).toContain('return mix(neighbor_color, center_color, center_coverage);');
  });
});
