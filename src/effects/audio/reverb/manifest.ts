import type { AudioEffectManifest } from '../../core/registry';

export interface ReverbParams {
  wet: number;
  decay: number;
  preDelay: number;
}

export const reverbManifest: AudioEffectManifest<ReverbParams> = {
  type: 'audio-reverb',
  name: 'Reverb',
  description: 'Convolution reverb',
  icon: 'i-heroicons-speaker-wave',
  target: 'audio',
  defaultValues: {
    wet: 0.5,
    decay: 2.5,
    preDelay: 0.01,
  },
  controls: [
    {
      kind: 'slider',
      key: 'wet',
      label: 'Wet',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(Number(v) * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'decay',
      label: 'Decay',
      min: 0.1,
      max: 10,
      step: 0.1,
      format: (v) => `${Number(v).toFixed(1)}s`,
    },
    {
      kind: 'slider',
      key: 'preDelay',
      label: 'Pre-delay',
      min: 0,
      max: 0.5,
      step: 0.001,
      format: (v) => `${Math.round(Number(v) * 1000)}ms`,
    },
  ],
};
