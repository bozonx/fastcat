import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';

export interface OldVinylParams {
  wet: number;
  noiseLevel: number;
  wear: number;
  wow: number; // Pitch variation
}

interface OldVinylNodeGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  bandpass: BiquadFilterNode;
  waveshaper: WaveShaperNode;
  noiseGain: GainNode;
  wowOscillator: OscillatorNode;
  wowGain: GainNode;
  delay: DelayNode;
}

// Simple distortion curve for the worn vinyl sound
function makeDistortionCurve(amount: number) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// Generate pink/brown-ish noise for vinyl crackle
function createNoiseBuffer(context: BaseAudioContext, duration: number): AudioBuffer {
  const bufferSize = context.sampleRate * duration;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);

  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;

  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;

    // Pink noise approximation
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;

    // Add occasional crackles
    const crackle = Math.random() > 0.999 ? (Math.random() * 2 - 1) * 2 : 0;
    const pop = Math.random() > 0.9995 ? (Math.random() * 2 - 1) * 5 : 0;

    output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11 + crackle + pop;
    b6 = white * 0.115926;
  }

  return buffer;
}

export const oldVinylManifest: AudioEffectManifest<OldVinylParams> = {
  type: 'audio-old-vinyl',
  name: 'Old Vinyl',
  description: 'Lo-Fi vintage record player effect',
  icon: 'i-heroicons-musical-note',
  category: 'artistic',
  target: 'audio',
  defaultValues: {
    wet: 1,
    noiseLevel: 20,
    wear: 50,
    wow: 30,
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
      key: 'noiseLevel',
      label: 'Dust & Crackle',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
    {
      kind: 'slider',
      key: 'wear',
      label: 'Wear (Distortion & EQ)',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
    {
      kind: 'slider',
      key: 'wow',
      label: 'Wow & Flutter',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
  ],
  createNode(context: AudioEffectContext): OldVinylNodeGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();

    // Bandpass filter to restrict frequencies (telephone/vinyl EQ)
    const bandpass = context.audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1500;
    bandpass.Q.value = 0.5;

    // Distortion for wear
    const waveshaper = context.audioContext.createWaveShaper();
    waveshaper.curve = makeDistortionCurve(10);
    waveshaper.oversample = '4x';

    // Wow (pitch variation) using a delay line modulated by a slow LFO
    const delay = context.audioContext.createDelay(0.1);
    delay.delayTime.value = 0.05;

    const wowOscillator = context.audioContext.createOscillator();
    wowOscillator.type = 'sine';
    wowOscillator.frequency.value = 0.5; // Slow rotation (33 RPM = ~0.55 Hz)

    const wowGain = context.audioContext.createGain();
    wowGain.gain.value = 0.001;

    wowOscillator.connect(wowGain);
    wowGain.connect(delay.delayTime);
    wowOscillator.start(0);

    // Noise buffer
    // Note: In an offline context, looping a buffer source might behave differently,
    // but we can just make it long enough or rely on the buffer source loop.
    const noiseBuffer = createNoiseBuffer(context.audioContext, 2.0); // 2 seconds loop
    const noiseSource = context.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const noiseGain = context.audioContext.createGain();
    noiseGain.gain.value = 0.1;
    noiseSource.connect(noiseGain);
    noiseSource.start(0);

    // Routing
    input.connect(bandpass);
    bandpass.connect(waveshaper);
    waveshaper.connect(delay);
    delay.connect(output);
    noiseGain.connect(output);

    return { input, output, bandpass, waveshaper, noiseGain, wowOscillator, wowGain, delay };
  },
  updateNode(node, values) {
    const graph = node as OldVinylNodeGraph;

    const wear = typeof values.wear === 'number' ? Math.max(0, Math.min(100, values.wear)) : 50;
    const noiseLevel =
      typeof values.noiseLevel === 'number' ? Math.max(0, Math.min(100, values.noiseLevel)) : 20;
    const wow = typeof values.wow === 'number' ? Math.max(0, Math.min(100, values.wow)) : 30;

    // Bandpass Q tightens with wear
    graph.bandpass.Q.value = 0.5 + (wear / 100) * 1.5;

    // Distortion amount scales with wear
    graph.waveshaper.curve = makeDistortionCurve(wear * 0.5);

    // Noise volume
    graph.noiseGain.gain.value = (noiseLevel / 100) * 0.3;

    // Wow intensity
    graph.wowGain.gain.value = (wow / 100) * 0.005;

    // Slight randomization of wow frequency to simulate uneven motor
    // Only applied if we could easily trigger it, but we can just set base frequency
    graph.wowOscillator.frequency.value = 0.55 + (Math.random() * 0.1 - 0.05);
  },
};
