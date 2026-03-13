import type { AudioEffectManifest, AudioEffectContext } from '../../core/registry';

export interface ReverbParams {
  wet: number;
  decay: number;
  preDelay: number;
}

function generateImpulseResponse(
  ctx: BaseAudioContext,
  decaySeconds: number,
  preDelaySeconds: number,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const preDelaySamples = Math.round(preDelaySeconds * sampleRate);
  const decaySamples = Math.round(decaySeconds * sampleRate);
  const totalSamples = preDelaySamples + decaySamples;
  const channels = 2;

  const buffer = ctx.createBuffer(channels, totalSamples, sampleRate);

  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = preDelaySamples; i < totalSamples; i += 1) {
      const t = (i - preDelaySamples) / decaySamples;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-6 * t);
    }
  }

  return buffer;
}

export const reverbManifest: AudioEffectManifest<ReverbParams> = {
  type: 'audio-reverb',
  name: 'Reverb',
  description: 'Convolution reverb',
  icon: 'i-heroicons-speaker-wave',
  target: 'audio',
  defaultValues: {
    wet: 0.5,
    decay: 2.5,
    preDelay: 0.01,
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
      key: 'decay',
      label: 'Decay',
      min: 0.1,
      max: 10,
      step: 0.1,
      format: (v) => `${Number(v).toFixed(1)}s`,
    },
    {
      kind: 'slider',
      key: 'preDelay',
      label: 'Pre-delay',
      min: 0,
      max: 0.5,
      step: 0.001,
      format: (v) => `${Math.round(Number(v) * 1000)}ms`,
    },
  ],
  createNode(context: AudioEffectContext) {
    return context.audioContext.createConvolver();
  },
  updateNode(node: AudioNode, values: ReverbParams, context: AudioEffectContext) {
    const convolver = node as ConvolverNode;
    const decay = typeof values.decay === 'number' ? Math.max(0.01, values.decay) : 2.5;
    const preDelay = typeof values.preDelay === 'number' ? Math.max(0, values.preDelay) : 0.01;
    convolver.buffer = generateImpulseResponse(context.audioContext, decay, preDelay);
  },
};
