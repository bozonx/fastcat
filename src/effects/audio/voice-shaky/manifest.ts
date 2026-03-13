import type { AudioEffectManifest, AudioEffectNodeGraph } from '../../core/registry';

export interface VoiceShakyParams {
  wet: number;
  rate: number;
  depth: number;
}

interface VoiceShakyGraph extends AudioEffectNodeGraph {
  lfo: OscillatorNode;
  lfoDepth: GainNode;
  modulatedGain: GainNode;
}

export const voiceShakyManifest: AudioEffectManifest<VoiceShakyParams> = {
  type: 'audio-voice-shaky',
  name: 'Shaky Voice',
  description: 'Fast tremolo for fear, stress and frozen voice acting',
  icon: 'i-heroicons-bolt-slash',
  target: 'audio',
  category: 'artistic',
  defaultValues: {
    wet: 1,
    rate: 9,
    depth: 0.75,
  },
  controls: [
    {
      kind: 'slider',
      key: 'wet',
      label: 'Wet',
      min: 0,
      max: 1,
      step: 0.01,
      format: (value) => `${Math.round(Number(value) * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'rate',
      label: 'Rate',
      min: 0.1,
      max: 20,
      step: 0.1,
      format: (value) => `${Number(value).toFixed(1)} Hz`,
    },
    {
      kind: 'slider',
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 1,
      step: 0.01,
      format: (value) => `${Math.round(Number(value) * 100)}%`,
    },
  ],
  createNode(context) {
    const input = context.audioContext.createGain();
    const modulatedGain = context.audioContext.createGain();
    const lfo = context.audioContext.createOscillator();
    const lfoDepth = context.audioContext.createGain();

    input.connect(modulatedGain);
    lfo.connect(lfoDepth);
    lfoDepth.connect(modulatedGain.gain);
    lfo.start();

    return {
      input,
      output: modulatedGain,
      lfo,
      lfoDepth,
      modulatedGain,
    } as VoiceShakyGraph;
  },
  updateNode(node, values) {
    const graph = node as VoiceShakyGraph;
    const rate = typeof values.rate === 'number' ? Math.max(0.1, Math.min(20, values.rate)) : 9;
    const depth = typeof values.depth === 'number' ? Math.max(0, Math.min(1, values.depth)) : 0.75;

    graph.lfo.type = 'triangle';
    graph.lfo.frequency.value = rate;
    graph.modulatedGain.gain.value = 1 - depth / 2;
    graph.lfoDepth.gain.value = depth / 2;
  },
};
