import { registerEffect } from './core/registry';
import { colorAdjustmentManifest } from './video/color-adjustment/manifest';
import { blurManifest } from './video/blur/manifest';

export function initEffects() {
  registerEffect(colorAdjustmentManifest);
  registerEffect(blurManifest);
}

// Export everything for convenience
export * from './core/registry';
export * from './video/color-adjustment/manifest';
export * from './video/blur/manifest';
