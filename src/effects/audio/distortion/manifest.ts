import type { AudioEffectManifest } from '../../core/registry';

export interface DistortionParams {
  wet: number;
  distortion: number;
  oversample: '2x' | '4x' | 'none';
}

export const distortionManifest: AudioEffectManifest<DistortionParams> = {
  type: 'audio-distortion',
  name: 'Distortion',
  description: 'Waveshaping distortion',
  icon: 'i-heroicons-bolt',
  target: 'audio',
  defaultValues: {
    wet: 1,
    distortion: 0.4,
    oversample: '2x',
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
      key: 'distortion',
      label: 'Distortion',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(Number(v) * 100)}%`,
    },
    {
      kind: 'select',
      key: 'oversample',
      label: 'Oversample',
      options: [
        { label: 'None', value: 'none' },
        { label: '2x', value: '2x' },
        { label: '4x', value: '4x' },
      ],
    },
  ],
};
