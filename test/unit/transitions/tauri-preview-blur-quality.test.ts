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
    expect(getShaderSource('slide')).toContain('let pixel_blur = mb * max(dims().x, dims().y);');
    expect(getShaderSource('blinds')).toContain('let pixel_blur = mb * max(dims().x, dims().y);');
    expect(getShaderSource('zoom')).toContain(
      'let pixel_blur = blur_amount * max(dims().x, dims().y);',
    );
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
