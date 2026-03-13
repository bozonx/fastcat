import type { AudioEffectManifest, AudioEffectContext, AudioEffectNode } from '../../core/registry';

export interface ReverbParams {
  wet: number;
  decay: number;
  preDelay: number;
}

type ReverbImpulseBuffer = NonNullable<ConvolverNode['buffer']>;

const MAX_CACHE_SIZE = 10;
const impulseResponseCache = new Map<string, ReverbImpulseBuffer>();

function normalizeDecay(value: number | undefined): number {
  return typeof value === 'number' ? Math.max(0.1, Math.min(10, value)) : 2.5;
}

function normalizePreDelay(value: number | undefined): number {
  return typeof value === 'number' ? Math.max(0.1, Math.min(0.5, value)) : 0.01;
}

function generateImpulseResponse(
  ctx: BaseAudioContext,
  decaySeconds: number,
  preDelaySeconds: number,
): ReverbImpulseBuffer {
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

function getImpulseResponse(
  ctx: BaseAudioContext,
  decaySeconds: number,
  preDelaySeconds: number,
): ReverbImpulseBuffer {
  const cacheKey = `${ctx.sampleRate}:${decaySeconds.toFixed(3)}:${preDelaySeconds.toFixed(3)}`;
  const cachedBuffer = impulseResponseCache.get(cacheKey);
  if (cachedBuffer) {
    return cachedBuffer;
  }

  const buffer = generateImpulseResponse(ctx, decaySeconds, preDelaySeconds);

  if (impulseResponseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = impulseResponseCache.keys().next().value;
    if (firstKey !== undefined) {
      impulseResponseCache.delete(firstKey);
    }
  }

  impulseResponseCache.set(cacheKey, buffer);

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
  updateNode(node: AudioEffectNode, values: ReverbParams, context: AudioEffectContext) {
    const convolver = node as ConvolverNode;
    const decay = normalizeDecay(values.decay);
    const preDelay = normalizePreDelay(values.preDelay);
    convolver.buffer = getImpulseResponse(context.audioContext, decay, preDelay);
    convolver.normalize = true;
  },
};
