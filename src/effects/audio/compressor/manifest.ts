import type { AudioEffectManifest } from '../../core/registry';
import { clampAudioParam } from '../../../utils/audio/clamp';

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
    compressor.threshold.value = clampAudioParam(values.threshold, -100, 0, -24);
    compressor.knee.value = clampAudioParam(values.knee, 0, 40, 30);
    compressor.ratio.value = clampAudioParam(values.ratio, 1, 20, 4);
    compressor.attack.value = clampAudioParam(values.attack, 0, 1, 0.003);
    compressor.release.value = clampAudioParam(values.release, 0, 1, 0.25);
  },
};
