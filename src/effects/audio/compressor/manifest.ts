import type { AudioEffectManifest } from '../../core/registry';

export interface CompressorParams {
  wet: number;
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

export const compressorManifest: AudioEffectManifest<CompressorParams> = {
  type: 'audio-compressor',
  name: 'Compressor',
  description: 'Dynamics compression for more even volume',
  icon: 'i-heroicons-adjustments-horizontal',
  target: 'audio',
  defaultValues: {
    wet: 1,
    threshold: -24,
    knee: 30,
    ratio: 4,
    attack: 0.003,
    release: 0.25,
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
      key: 'threshold',
      label: 'Threshold',
      min: -100,
      max: 0,
      step: 1,
      format: (v) => `${Math.round(Number(v))} dB`,
    },
    {
      kind: 'slider',
      key: 'knee',
      label: 'Knee',
      min: 0,
      max: 40,
      step: 1,
      format: (v) => `${Math.round(Number(v))} dB`,
    },
    {
      kind: 'slider',
      key: 'ratio',
      label: 'Ratio',
      min: 1,
      max: 20,
      step: 0.1,
      format: (v) => `${Number(v).toFixed(1)}:1`,
    },
    {
      kind: 'slider',
      key: 'attack',
      label: 'Attack',
      min: 0,
      max: 1,
      step: 0.001,
      format: (v) => `${Math.round(Number(v) * 1000)} ms`,
    },
    {
      kind: 'slider',
      key: 'release',
      label: 'Release',
      min: 0,
      max: 1,
      step: 0.001,
      format: (v) => `${Math.round(Number(v) * 1000)} ms`,
    },
  ],
  createNode(context) {
    return context.audioContext.createDynamicsCompressor();
  },
  updateNode(node, values) {
    const compressor = node as DynamicsCompressorNode;
    compressor.threshold.value =
      typeof values.threshold === 'number' ? Math.max(-100, Math.min(0, values.threshold)) : -24;
    compressor.knee.value =
      typeof values.knee === 'number' ? Math.max(0, Math.min(40, values.knee)) : 30;
    compressor.ratio.value =
      typeof values.ratio === 'number' ? Math.max(1, Math.min(20, values.ratio)) : 4;
    compressor.attack.value =
      typeof values.attack === 'number' ? Math.max(0, Math.min(1, values.attack)) : 0.003;
    compressor.release.value =
      typeof values.release === 'number' ? Math.max(0, Math.min(1, values.release)) : 0.25;
  },
};
