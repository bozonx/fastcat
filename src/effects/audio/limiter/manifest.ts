import type { AudioEffectManifest } from '../../core/registry';

export interface LimiterParams {
  wet: number;
  threshold: number;
  knee: number;
  release: number;
  makeupGain: number;
}

export const limiterManifest: AudioEffectManifest<LimiterParams> = {
  type: 'audio-limiter',
  name: 'Limiter',
  description: 'Peak limiting with fast compression and makeup gain',
  icon: 'i-heroicons-shield-check',
  target: 'audio',
  defaultValues: {
    wet: 1,
    threshold: -1,
    knee: 0,
    release: 0.1,
    makeupGain: 1,
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
      min: -12,
      max: 0,
      step: 0.1,
      format: (v) => `${Number(v).toFixed(1)} dB`,
    },
    {
      kind: 'slider',
      key: 'knee',
      label: 'Knee',
      min: 0,
      max: 20,
      step: 0.1,
      format: (v) => `${Number(v).toFixed(1)} dB`,
    },
    {
      kind: 'slider',
      key: 'release',
      label: 'Release',
      min: 0.01,
      max: 0.5,
      step: 0.001,
      format: (v) => `${Math.round(Number(v) * 1000)} ms`,
    },
    {
      kind: 'slider',
      key: 'makeupGain',
      label: 'Makeup gain',
      min: 0.5,
      max: 2,
      step: 0.01,
      format: (v) => `${Number(v).toFixed(2)}x`,
    },
  ],
  createNode(context) {
    const input = context.audioContext.createDynamicsCompressor();
    const output = context.audioContext.createGain();

    input.connect(output);

    return {
      input,
      output,
    };
  },
  updateNode(node, values) {
    const graph = node as { input: DynamicsCompressorNode; output: GainNode };

    graph.input.threshold.value =
      typeof values.threshold === 'number' ? Math.max(-12, Math.min(0, values.threshold)) : -1;
    graph.input.knee.value =
      typeof values.knee === 'number' ? Math.max(0, Math.min(20, values.knee)) : 0;
    graph.input.ratio.value = 20;
    graph.input.attack.value = 0.001;
    graph.input.release.value =
      typeof values.release === 'number' ? Math.max(0.01, Math.min(0.5, values.release)) : 0.1;
    graph.output.gain.value =
      typeof values.makeupGain === 'number' ? Math.max(0.5, Math.min(2, values.makeupGain)) : 1;
  },
};
