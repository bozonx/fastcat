import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';

export interface ThoughtMonologueParams {
  wet: number;
  clarity: number; // Boosts mids
  space: number; // Reverb amount
}

interface ThoughtMonologueGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  peaking: BiquadFilterNode;
  delay: DelayNode;
  reverb: ConvolverNode;
  dryGain: GainNode;
  spaceGain: GainNode;
  delayGain: GainNode;
}

function createSoftImpulseResponse(
  context: BaseAudioContext,
  duration: number,
  decay: number,
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = sampleRate * duration;
  const impulse = context.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i / length;
    const env = Math.exp(-n * decay) * (1 - n);
    // Darker, softer reflections
    const noiseL = (Math.random() * 2 - 1) * env;
    const noiseR = (Math.random() * 2 - 1) * env;

    // Simple lowpass for softer sound
    left[i] = noiseL * 0.5 + (i > 0 ? (left[i - 1] || 0) * 0.5 : 0);
    right[i] = noiseR * 0.5 + (i > 0 ? (right[i - 1] || 0) * 0.5 : 0);
  }

  return impulse;
}

export const thoughtMonologueManifest: AudioEffectManifest<ThoughtMonologueParams> = {
  type: 'audio-thought-monologue',
  name: 'Thought / Monologue',
  description: 'Soft echo and reverb with mid-frequency clarity boost',
  icon: 'i-heroicons-cloud',
  category: 'artistic',
  target: 'audio',
  defaultValues: {
    wet: 1,
    clarity: 50,
    space: 60,
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
      key: 'clarity',
      label: 'Clarity (Mids Boost)',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
    {
      kind: 'slider',
      key: 'space',
      label: 'Space (Reverb & Echo)',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
  ],
  createNode(context: AudioEffectContext): ThoughtMonologueGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();

    // Clarity boost
    const peaking = context.audioContext.createBiquadFilter();
    peaking.type = 'peaking';
    peaking.frequency.value = 2500; // Presence range
    peaking.Q.value = 1;

    const dryGain = context.audioContext.createGain();
    dryGain.gain.value = 0.8;

    // Soft Echo
    const delay = context.audioContext.createDelay(1.0);
    delay.delayTime.value = 0.15;
    const delayGain = context.audioContext.createGain();
    delayGain.gain.value = 0.2;

    // Volumetric Reverb
    const reverb = context.audioContext.createConvolver();
    reverb.buffer = createSoftImpulseResponse(context.audioContext, 2.0, 4.0);
    const spaceGain = context.audioContext.createGain();
    spaceGain.gain.value = 0.3;

    // Routing
    input.connect(peaking);

    // Split
    peaking.connect(dryGain);
    peaking.connect(delay);
    peaking.connect(reverb);

    delay.connect(delayGain);
    reverb.connect(spaceGain);

    // Merge
    dryGain.connect(output);
    delayGain.connect(output);
    spaceGain.connect(output);

    return { input, output, peaking, delay, reverb, dryGain, spaceGain, delayGain };
  },
  updateNode(node, values) {
    const graph = node as ThoughtMonologueGraph;

    const clarity =
      typeof values.clarity === 'number' ? Math.max(0, Math.min(100, values.clarity)) : 50;
    const space = typeof values.space === 'number' ? Math.max(0, Math.min(100, values.space)) : 60;

    // Clarity gives up to +6dB boost in presence range
    graph.peaking.gain.value = (clarity / 100) * 6;

    // Space scales echo and reverb amount
    const spaceNorm = space / 100;
    graph.spaceGain.gain.value = spaceNorm * 0.5;
    graph.delayGain.gain.value = spaceNorm * 0.3;
  },
};
