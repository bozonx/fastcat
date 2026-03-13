import type { AudioEffectManifest, AudioEffectNodeGraph } from '../../core/registry';

export interface VoiceRobotParams {
  wet: number;
  rate: number;
  depth: number;
  delayTime: number;
  feedback: number;
}

interface VoiceRobotGraph extends AudioEffectNodeGraph {
  delay: DelayNode;
  feedbackGain: GainNode;
  lfo: OscillatorNode;
  lfoDepth: GainNode;
}

export const voiceRobotManifest: AudioEffectManifest<VoiceRobotParams> = {
  type: 'audio-voice-robot',
  name: 'Robot / Alien Voice',
  description: 'Metallic modulated delay for robotic and alien voices',
  icon: 'i-heroicons-cpu-chip',
  target: 'audio',
  category: 'artistic',
  defaultValues: {
    wet: 0.75,
    rate: 1.2,
    depth: 0.0018,
    delayTime: 0.004,
    feedback: 0.25,
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
      max: 8,
      step: 0.1,
      format: (value) => `${Number(value).toFixed(1)} Hz`,
    },
    {
      kind: 'slider',
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 0.006,
      step: 0.0001,
      format: (value) => `${Number(value).toFixed(4)} s`,
    },
    {
      kind: 'slider',
      key: 'delayTime',
      label: 'Delay',
      min: 0.0005,
      max: 0.02,
      step: 0.0001,
      format: (value) => `${Number(value).toFixed(4)} s`,
    },
    {
      kind: 'slider',
      key: 'feedback',
      label: 'Feedback',
      min: 0,
      max: 0.9,
      step: 0.01,
      format: (value) => `${Math.round(Number(value) * 100)}%`,
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
    } as VoiceRobotGraph;
  },
  updateNode(node, values) {
    const graph = node as VoiceRobotGraph;
    graph.delay.delayTime.value =
      typeof values.delayTime === 'number' ? Math.max(0.0005, Math.min(0.02, values.delayTime)) : 0.004;
    graph.feedbackGain.gain.value =
      typeof values.feedback === 'number' ? Math.max(0, Math.min(0.9, values.feedback)) : 0.25;
    graph.lfo.type = 'triangle';
    graph.lfo.frequency.value =
      typeof values.rate === 'number' ? Math.max(0.1, Math.min(8, values.rate)) : 1.2;
    graph.lfoDepth.gain.value =
      typeof values.depth === 'number' ? Math.max(0, Math.min(0.006, values.depth)) : 0.0018;
  },
};
