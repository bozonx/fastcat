import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';

export interface WalkieTalkieParams {
  wet: number;
  noise: number;
}

interface WalkieTalkieNodeGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  bandpass: BiquadFilterNode;
  distortion: WaveShaperNode;
  noiseGain: GainNode;
  compressor: DynamicsCompressorNode;
}

function makeHardClippingCurve(amount: number) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    // Hard clipping
    curve[i] = Math.max(-1, Math.min(1, x * (1 + k / 10)));
  }
  return curve;
}

function createWhiteNoiseBuffer(context: BaseAudioContext, duration: number): AudioBuffer {
  const bufferSize = context.sampleRate * duration;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export const walkieTalkieManifest: AudioEffectManifest<WalkieTalkieParams> = {
  type: 'audio-walkie-talkie',
  name: 'Walkie-Talkie',
  description: 'Narrow range with hard clipping and radio noise',
  icon: 'i-heroicons-signal',
  category: 'artistic',
  target: 'audio',
  defaultValues: {
    wet: 1,
    noise: 30,
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
      key: 'noise',
      label: 'Radio Static',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
  ],
  createNode(context: AudioEffectContext): WalkieTalkieNodeGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();

    // Very narrow bandpass
    const bandpass = context.audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1000;
    bandpass.Q.value = 1.5;

    // Hard clipping
    const distortion = context.audioContext.createWaveShaper();
    distortion.curve = makeHardClippingCurve(40);

    // Static noise
    const noiseBuffer = createWhiteNoiseBuffer(context.audioContext, 2.0);
    const noiseSource = context.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    // Filter the noise to sound more like radio static
    const noiseFilter = context.audioContext.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 2500;
    noiseFilter.Q.value = 1.0;

    const noiseGain = context.audioContext.createGain();
    noiseGain.gain.value = 0.05;

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseSource.start(0);

    // Compress the output heavily
    const compressor = context.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 0;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.1;

    // Routing
    input.connect(bandpass);
    bandpass.connect(distortion);

    distortion.connect(compressor);
    noiseGain.connect(compressor);

    compressor.connect(output);

    return { input, output, bandpass, distortion, noiseGain, compressor };
  },
  updateNode(node, values) {
    const graph = node as WalkieTalkieNodeGraph;
    const noise = typeof values.noise === 'number' ? Math.max(0, Math.min(100, values.noise)) : 30;

    graph.noiseGain.gain.value = (noise / 100) * 0.15;
  },
};
