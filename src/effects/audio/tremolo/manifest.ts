import type { AudioEffectManifest, AudioEffectNodeGraph } from '../../core/registry';

export interface TremoloParams {
  wet: number;
  rate: number;
  depth: number;
}

interface TremoloGraph extends AudioEffectNodeGraph {
  lfo: OscillatorNode;
  lfoDepth: GainNode;
  modulatedGain: GainNode;
}

export const tremoloManifest: AudioEffectManifest<TremoloParams> = {
  type: 'audio-tremolo',
  name: 'Tremolo',
  description: 'Volume modulation for rhythmic pulsing',
  icon: 'i-heroicons-signal',
  target: 'audio',
  defaultValues: {
    wet: 1,
    rate: 5,
    depth: 0.6,
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
      key: 'rate',
      label: 'Rate',
      min: 0.1,
      max: 20,
      step: 0.1,
      format: (v) => `${Number(v).toFixed(1)} Hz`,
    },
    {
      kind: 'slider',
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(Number(v) * 100)}%`,
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
    } as TremoloGraph;
  },
  updateNode(node, values) {
    const graph = node as TremoloGraph;
    const rate = typeof values.rate === 'number' ? Math.max(0.1, Math.min(20, values.rate)) : 5;
    const depth = typeof values.depth === 'number' ? Math.max(0, Math.min(1, values.depth)) : 0.6;

    graph.lfo.type = 'sine';
    graph.lfo.frequency.value = rate;
    graph.modulatedGain.gain.value = 1 - depth / 2;
    graph.lfoDepth.gain.value = depth / 2;
  },
  destroyNode(node) {
    const graph = node as TremoloGraph;
    try {
      graph.lfo.stop();
      graph.lfo.disconnect();
    } catch (err) {
      // ignore
    }
  },
};
