import type { AudioEffectManifest, AudioEffectNodeGraph } from '../../core/registry';

export interface FlangerParams {
  wet: number;
  rate: number;
  depth: number;
  delayTime: number;
  feedback: number;
}

interface FlangerGraph extends AudioEffectNodeGraph {
  delay: DelayNode;
  feedbackGain: GainNode;
  lfo: OscillatorNode;
  lfoDepth: GainNode;
}

export const flangerManifest: AudioEffectManifest<FlangerParams> = {
  type: 'audio-flanger',
  name: 'Flanger',
  description: 'Short modulated delay for swirling motion',
  icon: 'i-heroicons-arrow-path',
  target: 'audio',
  defaultValues: {
    wet: 0.5,
    rate: 0.25,
    depth: 0.002,
    delayTime: 0.003,
    feedback: 0.35,
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
      max: 0.01,
      step: 0.0001,
      format: (v) => `${Number(v).toFixed(4)} s`,
    },
    {
      kind: 'slider',
      key: 'delayTime',
      label: 'Delay',
      min: 0.0005,
      max: 0.01,
      step: 0.0001,
      format: (v) => `${Number(v).toFixed(4)} s`,
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
  ],
  createNode(context) {
    const input = context.audioContext.createGain();
    const delay = context.audioContext.createDelay(0.05);
    const feedbackGain = context.audioContext.createGain();
    const lfo = context.audioContext.createOscillator();
    const lfoDepth = context.audioContext.createGain();

    input.connect(delay);
    delay.connect(feedbackGain);
    feedbackGain.connect(delay);

    lfo.connect(lfoDepth);
    lfoDepth.connect(delay.delayTime);
    lfo.start();

    return {
      input,
      output: delay,
      delay,
      feedbackGain,
      lfo,
      lfoDepth,
    } as FlangerGraph;
  },
  updateNode(node, values) {
    const graph = node as FlangerGraph;
    const rate = typeof values.rate === 'number' ? Math.max(0.05, Math.min(5, values.rate)) : 0.25;
    const depth =
      typeof values.depth === 'number' ? Math.max(0, Math.min(0.01, values.depth)) : 0.002;
    const delayTime =
      typeof values.delayTime === 'number'
        ? Math.max(0.0005, Math.min(0.01, values.delayTime))
        : 0.003;

    graph.delay.delayTime.value = delayTime;
    graph.feedbackGain.gain.value =
      typeof values.feedback === 'number' ? Math.max(0, Math.min(0.9, values.feedback)) : 0.35;
    graph.lfo.type = 'sine';
    graph.lfo.frequency.value = rate;
    graph.lfoDepth.gain.value = depth;
  },
  destroyNode(node) {
    const graph = node as FlangerGraph;
    try {
      graph.lfo.stop();
      graph.lfo.disconnect();
      graph.delay.disconnect();
      graph.feedbackGain.disconnect();
    } catch (err) {
      // ignore
    }
  },
};
