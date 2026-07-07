import type { EffectManifest } from './core/registry';

export const nativeBuiltinAudioEffectTypes = [
  'audio-echo',
  'audio-distortion',
  'audio-tremolo',
  'audio-env-behind-wall',
  'audio-env-muffled',
  'audio-telephone',
  'audio-voice-underwater',
] as const;

const nativeBuiltinAudioEffectTypeSet = new Set<string>(nativeBuiltinAudioEffectTypes);

export function isNativeBuiltinAudioEffectType(type: string): boolean {
  return nativeBuiltinAudioEffectTypeSet.has(type);
}

export function isNativeAudioEffectManifestSupported(manifest: EffectManifest): boolean {
  if (isNativeBuiltinAudioEffectType(manifest.type)) {
    return true;
  }

  const values = manifest.defaultValues as Record<string, unknown>;
  return Boolean(values.plugin);
}
