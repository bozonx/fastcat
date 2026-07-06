import { getVideoEffectManifest } from './core/registry';
import type { ClipEffect } from '~/timeline/types';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';

/**
 * Converts a list of `ClipEffect` UI objects to the `VideoEffectSpec[]` array
 * consumed by both the native WGPU runner and the web WebGPU compute runner.
 * Disabled effects and audio effects are skipped.
 *
 * Lives in this leaf module (rather than `./index`) so the keyframe baker
 * (`./animation-bake`) can reuse it without an import cycle through the barrel.
 */
export function buildEffectSpecs(effects?: ClipEffect[]): VideoEffectSpec[] | undefined {
  if (!Array.isArray(effects) || effects.length === 0) {
    return undefined;
  }

  const specs: VideoEffectSpec[] = [];
  for (const effect of effects) {
    // Parity and some callers pass already-formed VideoEffectSpec objects
    // (e.g. { type: "brightness", value: 1.5 }) instead of ClipEffect UI
    // objects. Detect them by the absence of the UI-only `enabled` field and
    // pass them through unchanged.
    const isRawSpec = effect && typeof effect.enabled !== 'boolean';
    if (isRawSpec) {
      if ((effect.target ?? 'video') !== 'audio') {
        specs.push(effect as unknown as VideoEffectSpec);
      }
      continue;
    }

    if (!effect?.enabled || effect.target === 'audio') {
      continue;
    }

    const manifest = getVideoEffectManifest(effect.type);
    if (!manifest?.toEffectSpecs) {
      continue;
    }

    specs.push(...manifest.toEffectSpecs(effect));
  }

  return specs.length > 0 ? specs : undefined;
}
