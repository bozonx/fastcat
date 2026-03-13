import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';

export interface TelephoneParams {
  wet: number;
  quality: number;
}

interface TelephoneNodeGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  peaking: BiquadFilterNode;
  waveshaper: WaveShaperNode;
}

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

export const telephoneManifest: AudioEffectManifest<TelephoneParams> = {
  type: 'audio-telephone',
  name: 'Telephone',
  description: 'Extremely narrow frequency range and resonance',
  icon: 'i-heroicons-phone',
  category: 'artistic',
  target: 'audio',
  defaultValues: {
    wet: 1,
    quality: 50,
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
      key: 'quality',
      label: 'Line Quality',
      min: 0,
      max: 100,
      step: 1,
      format: (v) => `${Math.round(Number(v))}%`,
    },
  ],
  createNode(context: AudioEffectContext): TelephoneNodeGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();

    // Telephones typically cut below 300Hz and above 3400Hz
    const highpass = context.audioContext.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 400; // slightly higher for narrower effect

    const lowpass = context.audioContext.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3000; // slightly lower for narrower effect

    // Add resonant peak in the mid range
    const peaking = context.audioContext.createBiquadFilter();
    peaking.type = 'peaking';
    peaking.frequency.value = 1200;
    peaking.Q.value = 2;
    peaking.gain.value = 5;

    const waveshaper = context.audioContext.createWaveShaper();
    waveshaper.curve = makeDistortionCurve(10); // Subtle saturation

    input.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(peaking);
    peaking.connect(waveshaper);
    waveshaper.connect(output);

    return { input, output, highpass, lowpass, peaking, waveshaper };
  },
  updateNode(node, values) {
    const graph = node as TelephoneNodeGraph;
    
    const quality = typeof values.quality === 'number' ? Math.max(0, Math.min(100, values.quality)) : 50;

    // Quality affects frequency range and distortion
    // Low quality = narrower range, more distortion
    const hpfFreq = 600 - (quality / 100) * 300; // 600Hz to 300Hz
    const lpfFreq = 2000 + (quality / 100) * 1500; // 2000Hz to 3500Hz
    
    graph.highpass.frequency.value = hpfFreq;
    graph.lowpass.frequency.value = lpfFreq;

    const distortionAmount = 30 - (quality / 100) * 25; // 30 to 5
    graph.waveshaper.curve = makeDistortionCurve(distortionAmount);
    
    // Resonance sharpness
    graph.peaking.Q.value = 3 - (quality / 100) * 2; // 3 to 1
  },
};
