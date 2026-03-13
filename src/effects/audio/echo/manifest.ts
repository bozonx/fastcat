import type { AudioEffectManifest, AudioEffectNodeGraph } from '../../core/registry';

export interface EchoParams {
  wet: number;
  delayTime: number;
  feedback: number;
  tone: number;
}

interface EchoGraph extends AudioEffectNodeGraph {
  delay: DelayNode;
  feedbackGain: GainNode;
  toneFilter: BiquadFilterNode;
}

export const echoManifest: AudioEffectManifest<EchoParams> = {
  type: 'audio-echo',
  name: 'Echo',
  description: 'Delay echo with feedback and tone shaping',
  icon: 'i-heroicons-arrow-path-rounded-square',
  target: 'audio',
  defaultValues: {
    wet: 0.35,
    delayTime: 0.25,
    feedback: 0.35,
    tone: 6000,
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
      key: 'delayTime',
      label: 'Delay',
      min: 0.02,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(Number(v) * 1000)} ms`,
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
      key: 'tone',
      label: 'Tone',
      min: 400,
      max: 12000,
      step: 10,
      format: (v) => `${Math.round(Number(v))} Hz`,
    },
  ],
  createNode(context) {
    const input = context.audioContext.createGain();
    const delay = context.audioContext.createDelay(2);
    const feedbackGain = context.audioContext.createGain();
    const toneFilter = context.audioContext.createBiquadFilter();

    toneFilter.type = 'lowpass';

    input.connect(delay);
    delay.connect(toneFilter);
    toneFilter.connect(feedbackGain);
    feedbackGain.connect(delay);

    return {
      input,
      output: delay,
      delay,
      feedbackGain,
      toneFilter,
    } as EchoGraph;
  },
  updateNode(node, values) {
    const graph = node as EchoGraph;

    graph.delay.delayTime.value =
      typeof values.delayTime === 'number' ? Math.max(0.02, Math.min(1, values.delayTime)) : 0.25;

    graph.feedbackGain.gain.value =
      typeof values.feedback === 'number' ? Math.max(0, Math.min(0.9, values.feedback)) : 0.35;

    graph.toneFilter.frequency.value =
      typeof values.tone === 'number' ? Math.max(400, Math.min(12000, values.tone)) : 6000;
  },
};
