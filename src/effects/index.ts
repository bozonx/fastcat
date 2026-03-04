import { registerEffect } from './core/registry';
import { colorAdjustmentManifest } from './video/color-adjustment/manifest';
import { blurManifest } from './video/blur/manifest';
import { colorMatrixManifest } from './video/color-matrix/manifest';
import { noiseManifest } from './video/noise/manifest';
import { displacementManifest } from './video/displacement/manifest';

export function initEffects() {
  registerEffect(colorAdjustmentManifest);
  registerEffect(blurManifest);
  registerEffect(colorMatrixManifest);
  registerEffect(noiseManifest);
  registerEffect(displacementManifest);
}

// Export everything for convenience
export * from './core/registry';
export * from './video/color-adjustment/manifest';
export * from './video/blur/manifest';
export * from './video/color-matrix/manifest';
export * from './video/noise/manifest';
export * from './video/displacement/manifest';
