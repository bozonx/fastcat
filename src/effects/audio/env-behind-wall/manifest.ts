import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';

export interface EnvBehindWallParams {
  wet: number;
  muffling: number;
  roomSize: number;
}

interface BehindWallNodeGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  filter: BiquadFilterNode;
  reverb: ConvolverNode;
}

// Generate a simple impulse response for room reverb
function createRoomImpulseResponse(
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
    const n = i / length; // 0 to 1
    // Exponential decay
    const env = Math.exp(-n * decay) * (1 - n);
    left[i] = (Math.random() * 2 - 1) * env;
    right[i] = (Math.random() * 2 - 1) * env;
  }

  return impulse;
}

export const envBehindWallManifest: AudioEffectManifest<EnvBehindWallParams> = {
  type: 'audio-env-behind-wall',
  name: 'Behind the Wall',
  description: 'Simulates sound coming from another room',
  icon: 'i-heroicons-home',
  category: 'artistic',
  target: 'audio',
  defaultValues: {
    wet: 1,
    muffling: 80,
    roomSize: 50,
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
      key: 'muffling',
      label: 'Wall Thickness',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
    {
      kind: 'slider',
      key: 'roomSize',
      label: 'Room Size',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
  ],
  createNode(context: AudioEffectContext): BehindWallNodeGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();

    const filter = context.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;

    const reverb = context.audioContext.createConvolver();
    // Default IR
    reverb.buffer = createRoomImpulseResponse(context.audioContext, 0.5, 5);

    input.connect(filter);
    filter.connect(reverb);
    reverb.connect(output);

    return { input, output, filter, reverb };
  },
  updateNode(node, values, context) {
    const graph = node as BehindWallNodeGraph;
    
    // Muffling: 0 = 2000Hz (thin wall), 100 = 150Hz (thick wall)
    const muffling = typeof values.muffling === 'number' ? Math.max(0, Math.min(100, values.muffling)) : 80;
    // Logarithmic scale for frequency
    const minFreq = 150;
    const maxFreq = 2000;
    const normMuffling = 1 - (muffling / 100);
    const freq = minFreq * Math.pow(maxFreq / minFreq, normMuffling);
    graph.filter.frequency.value = freq;

    // We only update the IR if needed, but for simplicity we can just recreate it 
    // if roomSize changes significantly. For performance, we'll just set it once 
    // in a real scenario, but here we can generate a new one.
    const roomSize = typeof values.roomSize === 'number' ? Math.max(0, Math.min(100, values.roomSize)) : 50;
    const duration = 0.1 + (roomSize / 100) * 0.9; // 0.1 to 1.0 seconds
    const decay = 10 - (roomSize / 100) * 8; // 10 to 2
    
    // In a real-time system, frequently changing the convolver buffer can cause glitches.
    // For offline rendering, it's fine.
    graph.reverb.buffer = createRoomImpulseResponse(context.audioContext, duration, decay);
  },
};
