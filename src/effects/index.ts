import { registerEffect, getVideoEffectManifest } from './core/registry';
import type { ClipEffect } from '~/timeline/types';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import { compressorManifest } from './audio/compressor/manifest';
import { echoManifest } from './audio/echo/manifest';
import { flangerManifest } from './audio/flanger/manifest';
import { limiterManifest } from './audio/limiter/manifest';
import { phaserManifest } from './audio/phaser/manifest';
import { reverbManifest } from './audio/reverb/manifest';
import { distortionManifest } from './audio/distortion/manifest';
import { tremoloManifest } from './audio/tremolo/manifest';
import { parametricEqManifest } from './audio/parametric-eq/manifest';
import { envBehindWallManifest } from './audio/env-behind-wall/manifest';
import { oldVinylManifest } from './audio/old-vinyl/manifest';
import { envStadiumManifest } from './audio/env-stadium/manifest';
import { telephoneManifest } from './audio/telephone/manifest';
import { walkieTalkieManifest } from './audio/walkie-talkie/manifest';
import { thoughtMonologueManifest } from './audio/thought-monologue/manifest';
import { envMuffledManifest } from './audio/env-muffled/manifest';
import { voiceRadioManifest } from './audio/voice-radio/manifest';
import { voiceRobotManifest } from './audio/voice-robot/manifest';
import { voiceShakyManifest } from './audio/voice-shaky/manifest';
import { voiceUnderwaterManifest } from './audio/voice-underwater/manifest';

// Video effects are not registered here: they live in the unified, runtime-
// agnostic `videoEffectManifests` catalog (`./video-manifests`) and run through
// the shared WGSL compute shader. Only audio effects use the runtime registry.
export function initEffects() {
  registerEffect(compressorManifest);
  registerEffect(echoManifest);
  registerEffect(limiterManifest);
  registerEffect(flangerManifest);
  registerEffect(phaserManifest);
  registerEffect(reverbManifest);
  registerEffect(distortionManifest);
  registerEffect(tremoloManifest);
  registerEffect(parametricEqManifest);
  registerEffect(envBehindWallManifest);
  registerEffect(oldVinylManifest);
  registerEffect(envStadiumManifest);
  registerEffect(telephoneManifest);
  registerEffect(walkieTalkieManifest);
  registerEffect(thoughtMonologueManifest);
  registerEffect(envMuffledManifest);
  registerEffect(voiceRadioManifest);
  registerEffect(voiceUnderwaterManifest);
  registerEffect(voiceRobotManifest);
  registerEffect(voiceShakyManifest);
}

/**
 * Converts a list of `ClipEffect` UI objects to the `VideoEffectSpec[]` array
 * consumed by both the native WGPU runner and the web WebGPU compute runner.
 * Disabled effects and audio effects are skipped.
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

// Export everything for convenience
export * from './core/registry';
export * from './video-manifests';
export * from './audio/compressor/manifest';
export * from './audio/echo/manifest';
export * from './audio/flanger/manifest';
export * from './audio/limiter/manifest';
export * from './audio/phaser/manifest';
export * from './audio/reverb/manifest';
export * from './audio/distortion/manifest';
export * from './audio/tremolo/manifest';
export * from './audio/parametric-eq/manifest';
export * from './audio/voice-radio/manifest';
export * from './audio/voice-robot/manifest';
export * from './audio/voice-shaky/manifest';
export * from './audio/voice-underwater/manifest';
