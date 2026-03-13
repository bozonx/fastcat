import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';

export interface EnvStadiumParams {
  wet: number;
  size: number; // 0-100, maps to delay time and decay
}

interface StadiumNodeGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  reverb: ConvolverNode;
  delay: DelayNode;
  feedbackGain: GainNode;
}

// Generate a large space impulse response
function createStadiumImpulseResponse(
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
    // Exponential decay with some pre-delay/diffusion characteristics
    const env = Math.exp(-n * decay) * (1 - n);
    // Lower density of reflections at the start to simulate large space
    const density = Math.min(1, n * 5);

    if (Math.random() < density) {
      left[i] = (Math.random() * 2 - 1) * env;
      right[i] = (Math.random() * 2 - 1) * env;
    } else {
      left[i] = 0;
      right[i] = 0;
    }
  }

  return impulse;
}

export const envStadiumManifest: AudioEffectManifest<EnvStadiumParams> = {
  type: 'audio-env-stadium',
  name: 'Stadium / Hangar',
  description: 'Huge reverberation and echo for massive spaces',
  icon: 'i-heroicons-speaker-wave',
  category: 'artistic',
  target: 'audio',
  defaultValues: {
    wet: 0.6,
    size: 80,
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
      key: 'size',
      label: 'Space Size',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
  ],
  createNode(context: AudioEffectContext): StadiumNodeGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();

    const reverb = context.audioContext.createConvolver();
    reverb.buffer = createStadiumImpulseResponse(context.audioContext, 3.0, 3.0);

    const delay = context.audioContext.createDelay(1.0);
    delay.delayTime.value = 0.3; // Base slapback delay

    const feedbackGain = context.audioContext.createGain();
    feedbackGain.gain.value = 0.4;

    // Parallel processing:
    // Input -> Reverb -> Output
    // Input -> Delay -> Output
    //          Delay <-> FeedbackGain

    input.connect(reverb);
    reverb.connect(output);

    input.connect(delay);
    delay.connect(output);
    delay.connect(feedbackGain);
    feedbackGain.connect(delay);

    return { input, output, reverb, delay, feedbackGain };
  },
  updateNode(node, values, context) {
    const graph = node as StadiumNodeGraph;

    const size = typeof values.size === 'number' ? Math.max(0, Math.min(100, values.size)) : 80;

    // Scale delay time: 0.1s to 0.6s
    const delayTime = 0.1 + (size / 100) * 0.5;
    graph.delay.delayTime.value = delayTime;

    // Scale feedback: 0.2 to 0.6
    graph.feedbackGain.gain.value = 0.2 + (size / 100) * 0.4;

    // We could regenerate the IR for size changes, but for performance
    // it's usually better to just rely on the delay changes for "size" feel,
    // or regenerate it only occasionally.
    const duration = 1.0 + (size / 100) * 4.0; // 1s to 5s tail
    const decay = 8.0 - (size / 100) * 6.0; // 8 to 2
    graph.reverb.buffer = createStadiumImpulseResponse(context.audioContext, duration, decay);
  },
};
