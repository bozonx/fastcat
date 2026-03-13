import type { AudioEffectManifest, AudioEffectNodeGraph } from '../../core/registry';

export interface PhaserParams {
  wet: number;
  rate: number;
  depth: number;
  feedback: number;
  baseFrequency: number;
}

interface PhaserGraph extends AudioEffectNodeGraph {
  filters: BiquadFilterNode[];
  feedbackGain: GainNode;
  lfo: OscillatorNode;
  lfoDepth: GainNode;
}

export const phaserManifest: AudioEffectManifest<PhaserParams> = {
  type: 'audio-phaser',
  name: 'Phaser',
  description: 'Sweeping phase effect based on all-pass filters',
  icon: 'i-heroicons-sparkles',
  target: 'audio',
  defaultValues: {
    wet: 0.5,
    rate: 0.3,
    depth: 800,
    feedback: 0.25,
    baseFrequency: 700,
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
      min: 0.05,
      max: 5,
      step: 0.01,
      format: (v) => `${Number(v).toFixed(2)} Hz`,
    },
    {
      kind: 'slider',
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 2000,
      step: 10,
      format: (v) => `${Math.round(Number(v))} Hz`,
    },
    {
      kind: 'slider',
      key: 'feedback',
      label: 'Feedback',
      min: 0,
      max: 0.9,
      step: 0.01,
      format: (v) => `${Math.round(Number(v) * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'baseFrequency',
      label: 'Base frequency',
      min: 100,
      max: 2000,
      step: 10,
      format: (v) => `${Math.round(Number(v))} Hz`,
    },
  ],
  createNode(context) {
    const input = context.audioContext.createGain();
    const feedbackGain = context.audioContext.createGain();
    const lfo = context.audioContext.createOscillator();
    const lfoDepth = context.audioContext.createGain();
    const filters = Array.from({ length: 4 }, () => {
      const filter = context.audioContext.createBiquadFilter();
      filter.type = 'allpass';
      filter.Q.value = 0.7;
      return filter;
    });
    const firstFilter = filters[0];
    const lastFilter = filters[filters.length - 1];

    if (!firstFilter || !lastFilter) {
      throw new Error('Failed to create phaser filters');
    }

    input.connect(firstFilter);

    for (let index = 0; index < filters.length - 1; index += 1) {
      const currentFilter = filters[index];
      const nextFilter = filters[index + 1];
      if (!currentFilter || !nextFilter) {
        continue;
      }
      currentFilter.connect(nextFilter);
    }

    lastFilter.connect(feedbackGain);
    feedbackGain.connect(firstFilter);

    lfo.connect(lfoDepth);
    filters.forEach((filter) => {
      lfoDepth.connect(filter.frequency);
    });
    lfo.start();

    return {
      input,
      output: lastFilter,
      filters,
      feedbackGain,
      lfo,
      lfoDepth,
    } as PhaserGraph;
  },
  updateNode(node, values) {
    const graph = node as PhaserGraph;
    const rate = typeof values.rate === 'number' ? Math.max(0.05, Math.min(5, values.rate)) : 0.3;
    const depth =
      typeof values.depth === 'number' ? Math.max(0, Math.min(2000, values.depth)) : 800;
    const baseFrequency =
      typeof values.baseFrequency === 'number'
        ? Math.max(100, Math.min(2000, values.baseFrequency))
        : 700;

    graph.filters.forEach((filter) => {
      filter.frequency.value = baseFrequency;
    });
    graph.feedbackGain.gain.value =
      typeof values.feedback === 'number' ? Math.max(0, Math.min(0.9, values.feedback)) : 0.25;
    graph.lfo.type = 'sine';
    graph.lfo.frequency.value = rate;
    graph.lfoDepth.gain.value = depth;
  },
};
