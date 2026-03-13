import type { AudioEffectManifest, AudioEffectNodeGraph } from '../../core/registry';

export interface VoiceRadioParams {
  wet: number;
  lowCut: number;
  highCut: number;
  distortion: number;
}

type WaveShaperCurve = NonNullable<WaveShaperNode['curve']>;

interface VoiceRadioGraph extends AudioEffectNodeGraph {
  highPass: BiquadFilterNode;
  lowPass: BiquadFilterNode;
  shaper: WaveShaperNode;
}

function makeRadioCurve(amount: number): WaveShaperCurve {
  const samples = 512;
  const curve = new Float32Array(samples);
  const drive = Math.max(0, amount);

  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = drive > 0 ? ((Math.PI + drive) * x) / (Math.PI + drive * Math.abs(x)) : x;
  }

  return curve;
}

const radioCurveCache = new Map<number, WaveShaperCurve>();

function getRadioCurve(amount: number): WaveShaperCurve {
  const normalizedAmount = Math.round(amount * 1000) / 1000;
  const cachedCurve = radioCurveCache.get(normalizedAmount);
  if (cachedCurve) {
    return cachedCurve;
  }

  const curve = makeRadioCurve(normalizedAmount);
  radioCurveCache.set(normalizedAmount, curve);

  return curve;
}

export const voiceRadioManifest: AudioEffectManifest<VoiceRadioParams> = {
  type: 'audio-voice-radio',
  name: 'Radio / Phone / Megaphone',
  description: 'Narrow mid-range voice with band-pass filtering and distortion',
  icon: 'i-heroicons-megaphone',
  target: 'audio',
  category: 'voice',
  defaultValues: {
    wet: 1,
    lowCut: 500,
    highCut: 2200,
    distortion: 0.35,
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
      key: 'lowCut',
      label: 'Low cut',
      min: 200,
      max: 1200,
      step: 10,
      format: (value) => `${Math.round(Number(value))} Hz`,
    },
    {
      kind: 'slider',
      key: 'highCut',
      label: 'High cut',
      min: 1200,
      max: 5000,
      step: 10,
      format: (value) => `${Math.round(Number(value))} Hz`,
    },
    {
      kind: 'slider',
      key: 'distortion',
      label: 'Distortion',
      min: 0,
      max: 1,
      step: 0.01,
      format: (value) => `${Math.round(Number(value) * 100)}%`,
    },
  ],
  createNode(context) {
    const input = context.audioContext.createGain();
    const highPass = context.audioContext.createBiquadFilter();
    const lowPass = context.audioContext.createBiquadFilter();
    const shaper = context.audioContext.createWaveShaper();

    highPass.type = 'highpass';
    lowPass.type = 'lowpass';
    shaper.oversample = '2x';

    input.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(shaper);

    return {
      input,
      output: shaper,
      highPass,
      lowPass,
      shaper,
    } as VoiceRadioGraph;
  },
  updateNode(node, values) {
    const graph = node as VoiceRadioGraph;
    const lowCut =
      typeof values.lowCut === 'number' ? Math.max(200, Math.min(1200, values.lowCut)) : 500;
    const highCut =
      typeof values.highCut === 'number' ? Math.max(1200, Math.min(5000, values.highCut)) : 2200;
    const distortion =
      typeof values.distortion === 'number' ? Math.max(0, Math.min(1, values.distortion)) : 0.35;

    graph.highPass.frequency.value = Math.min(lowCut, highCut - 100);
    graph.highPass.Q.value = 0.8;
    graph.lowPass.frequency.value = Math.max(highCut, lowCut + 100);
    graph.lowPass.Q.value = 1.2;
    graph.shaper.curve = getRadioCurve(distortion * 160);
  },
};
