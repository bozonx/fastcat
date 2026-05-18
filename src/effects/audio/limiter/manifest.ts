import type { AudioEffectManifest } from '../../core/registry';
import { clampAudioParam } from '../../../utils/audio/clamp';

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

    graph.input.threshold.value = clampAudioParam(values.threshold, -12, 0, -1);
    graph.input.knee.value = clampAudioParam(values.knee, 0, 20, 0);
    graph.input.ratio.value = 20;
    graph.input.attack.value = 0.001;
    graph.input.release.value = clampAudioParam(values.release, 0.01, 0.5, 0.1);
    graph.output.gain.value = clampAudioParam(values.makeupGain, 0.5, 2, 1);
  },
  destroyNode(node) {
    const graph = node as { input: DynamicsCompressorNode; output: GainNode };
    try {
      graph.input.disconnect();
      graph.output.disconnect();
    } catch {}
  },
};
