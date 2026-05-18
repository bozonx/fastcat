import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';
import { clampAudioParam } from '../../../utils/audio/clamp';

export interface EnvMuffledParams {
  wet: number;
  intensity: number;
}

interface MuffledNodeGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  lowpass: BiquadFilterNode;
}

export const envMuffledManifest: AudioEffectManifest<EnvMuffledParams> = {
  type: 'audio-env-muffled',
  name: 'Muffled',
  description: 'Softly pushes audio to the background',
  icon: 'i-heroicons-archive-box',
  category: 'artistic',
  target: 'audio',
  defaultValues: {
    wet: 1,
    intensity: 70,
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
      key: 'intensity',
      label: 'Muffle Intensity',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
  ],
  createNode(context: AudioEffectContext): MuffledNodeGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();

    const lowpass = context.audioContext.createBiquadFilter();
    lowpass.type = 'lowpass';
    // Very low Q for a soft, musical roll-off
    lowpass.Q.value = 0.3;

    input.connect(lowpass);
    lowpass.connect(output);

    return { input, output, lowpass };
  },
  updateNode(node, values) {
    const graph = node as MuffledNodeGraph;

    const intensity = clampAudioParam(values.intensity, 0, 100, 70);

    // Intensity: 0 = 5000Hz (barely muffled), 100 = 300Hz (very muffled)
    const minFreq = 300;
    const maxFreq = 5000;
    const normIntensity = 1 - intensity / 100;
    const freq = minFreq * Math.pow(maxFreq / minFreq, normIntensity);

    graph.lowpass.frequency.value = freq;
    graph.input.gain.value = clampAudioParam(values.wet, 0, 1, 1);
  },
  destroyNode(node) {
    const graph = node as MuffledNodeGraph;
    try {
      graph.input.disconnect();
      graph.lowpass.disconnect();
      graph.output.disconnect();
    } catch {}
  },
};
