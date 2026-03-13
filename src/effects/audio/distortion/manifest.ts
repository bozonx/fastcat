import type { AudioEffectManifest, AudioEffectContext, AudioEffectNode } from '../../core/registry';

export interface DistortionParams {
  wet: number;
  distortion: number;
  oversample: '2x' | '4x' | 'none';
}

type WaveShaperCurve = NonNullable<WaveShaperNode['curve']>;

function makeDistortionCurve(amount: number): WaveShaperCurve {
  const samples = 256;
  const curve = new Float32Array(samples);
  const k = amount;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = k > 0 ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
  }

  return curve;
}

const distortionCurveCache = new Map<number, WaveShaperCurve>();

function getDistortionCurve(amount: number): WaveShaperCurve {
  const normalizedAmount = Math.round(amount * 1000) / 1000;
  const cachedCurve = distortionCurveCache.get(normalizedAmount);
  if (cachedCurve) {
    return cachedCurve;
  }

  const curve = makeDistortionCurve(normalizedAmount);
  distortionCurveCache.set(normalizedAmount, curve);

  return curve;
}

export const distortionManifest: AudioEffectManifest<DistortionParams> = {
  type: 'audio-distortion',
  name: 'Distortion',
  description: 'Waveshaping distortion',
  icon: 'i-heroicons-bolt',
  target: 'audio',
  defaultValues: {
    wet: 1,
    distortion: 0.4,
    oversample: '2x',
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
      key: 'distortion',
      label: 'Distortion',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(Number(v) * 100)}%`,
    },
    {
      kind: 'select',
      key: 'oversample',
      label: 'Oversample',
      options: [
        { label: 'None', value: 'none' },
        { label: '2x', value: '2x' },
        { label: '4x', value: '4x' },
      ],
    },
  ],
  createNode(context: AudioEffectContext) {
    return context.audioContext.createWaveShaper();
  },
  updateNode(node: AudioEffectNode, values: DistortionParams) {
    const shaper = node as WaveShaperNode;
    const distortion =
      typeof values.distortion === 'number' ? Math.max(0, Math.min(1, values.distortion)) : 0.4;
    shaper.curve = getDistortionCurve(distortion * 400);
    const oversample: OverSampleType =
      values.oversample === '4x' ? '4x' : values.oversample === 'none' ? 'none' : '2x';
    shaper.oversample = oversample;
  },
};
