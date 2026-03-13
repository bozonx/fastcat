import type { AudioEffectManifest, AudioEffectContext } from '../../core/registry';

export interface DistortionParams {
  wet: number;
  distortion: number;
  oversample: '2x' | '4x' | 'none';
}

function makeDistortionCurve(amount: number): Float32Array {
  const samples = 256;
  const curve = new Float32Array(samples);
  const k = amount;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = k > 0 ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
  }

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
  updateNode(node: AudioNode, values: DistortionParams, context: AudioEffectContext) {
    const shaper = node as WaveShaperNode;
    const distortion =
      typeof values.distortion === 'number' ? Math.max(0, Math.min(1, values.distortion)) : 0.4;
    shaper.curve = makeDistortionCurve(distortion * 400) as unknown as Float32Array<ArrayBuffer>;
    const oversample: OverSampleType =
      values.oversample === '4x' ? '4x' : values.oversample === 'none' ? 'none' : '2x';
    shaper.oversample = oversample;
  },
};
