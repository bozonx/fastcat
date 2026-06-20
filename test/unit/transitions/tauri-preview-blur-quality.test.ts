/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTauriTransitionManifest } from '~/transitions/tauri/manifests';

function getShaderSource(type: string): string {
  const manifest = getTauriTransitionManifest(type);
  const spec = manifest?.toTauriSpec?.(manifest.defaultParams as Record<string, unknown>, 1, {
    isPlaying: true,
    previewBlurQuality: 'medium',
  });

  expect(spec?.type).toBe('custom-wgsl');
  return spec?.source ?? '';
}

describe('Tauri preview blur shader optimization', () => {
  it('scales slide, blinds, and zoom samples by pixel-space blur length', () => {
    expect(getShaderSource('slide')).toContain('let pixel_blur = mb * length(axis * dims());');
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
    const manifest = getTauriTransitionManifest('bloom');
    const params = manifest?.defaultParams as Record<string, unknown>;

    expect(
      manifest?.toTauriSpec?.(params, 1, {
        isPlaying: true,
        previewBlurQuality: 'low',
      }).params,
    ).toMatchObject({ p3: 5 });
    expect(
      manifest?.toTauriSpec?.(params, 1, {
        isPlaying: true,
        previewBlurQuality: 'ultra',
      }).params,
    ).toMatchObject({ p3: 25 });
    expect(getShaderSource('bloom')).toContain('for (var i = 0; i < 25; i = i + 1)');
  });

  it('scales each card-swap radial branch independently with a four-sample minimum', () => {
    const source = getShaderSource('card-swap');

    expect(source).toContain(
      'let samples_fr = clamp(i32(ceil(blur_fr * max(dims().x, dims().y))), 4, max_samples);',
    );
    expect(source).toContain(
      'let samples_to = clamp(i32(ceil(blur_to * max(dims().x, dims().y))), 4, max_samples);',
    );
  });
});
