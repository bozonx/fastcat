/**
 * Worker-compatible audio effects processing via native Web Audio API.
 * Uses OfflineAudioContext and WaveShaperNode/ConvolverNode directly,
 * since Tone.js is not available in Web Workers.
 */

export interface AudioEffectData {
  id: string;
  type: string;
  enabled: boolean;
  target?: string;
  [key: string]: unknown;
}

export interface ApplyAudioEffectsOfflineParams {
  planes: Float32Array[];
  sampleRate: number;
  frames: number;
  channels: number;
  effects: AudioEffectData[];
}

export interface ApplyAudioEffectsOfflineResult {
  planes: Float32Array[];
  frames: number;
}

/**
 * Applies enabled audio effects to raw PCM planes using OfflineAudioContext.
 * Returns the processed planes. Falls back to original planes on error.
 */
export async function applyAudioEffectsOffline({
  planes,
  sampleRate,
  frames,
  channels,
  effects,
}: ApplyAudioEffectsOfflineParams): Promise<ApplyAudioEffectsOfflineResult> {
  const enabledEffects = effects.filter((e) => e.enabled && e.target === 'audio');
  if (enabledEffects.length === 0 || frames <= 0) {
    return { planes, frames };
  }

  const OfflineCtx =
    globalThis.OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext;
  if (!OfflineCtx) {
    return { planes, frames };
  }

  try {
    let currentPlanes = planes.map((plane) => new Float32Array(plane));
    let currentFrames = frames;

    for (const effect of enabledEffects) {
      const offlineCtx = new OfflineCtx(channels, currentFrames, sampleRate);
      const buffer = offlineCtx.createBuffer(channels, currentFrames, sampleRate);

      for (let c = 0; c < channels; c += 1) {
        const plane = currentPlanes[c];
        if (!plane) continue;
        buffer.copyToChannel(new Float32Array(plane), c, 0);
      }

      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;

      const inputGain = offlineCtx.createGain();
      const outputGain = offlineCtx.createGain();
      const wet = typeof effect.wet === 'number' ? Math.max(0, Math.min(1, effect.wet)) : 1;
      const dryGain = offlineCtx.createGain();
      dryGain.gain.value = 1 - wet;
      const wetGain = offlineCtx.createGain();
      wetGain.gain.value = wet;

      source.connect(inputGain);
      inputGain.connect(dryGain);
      dryGain.connect(outputGain);

      const effectNode = buildNativeEffectNode(offlineCtx, effect);
      if (effectNode) {
        inputGain.connect(effectNode);
        effectNode.connect(wetGain);
        wetGain.connect(outputGain);
      }

      outputGain.connect(offlineCtx.destination);
      source.start(0);

      const rendered = await offlineCtx.startRendering();
      currentFrames = rendered.length;
      currentPlanes = [];
      for (let c = 0; c < channels; c += 1) {
        currentPlanes.push(new Float32Array(rendered.getChannelData(c)));
      }
    }

    return { planes: currentPlanes, frames: currentFrames };
  } catch (err) {
    console.warn('[applyAudioEffectsOffline] Failed to apply effects, using raw audio', err);
    return { planes, frames };
  }
}

function buildNativeEffectNode(
  ctx: OfflineAudioContext,
  effect: AudioEffectData,
): AudioNode | null {
  if (effect.type === 'audio-reverb') {
    return buildReverbNode(ctx, effect);
  }

  if (effect.type === 'audio-distortion') {
    return buildDistortionNode(ctx, effect);
  }

  return null;
}

function buildReverbNode(ctx: OfflineAudioContext, effect: AudioEffectData): AudioNode {
  const decay = typeof effect.decay === 'number' ? Math.max(0.01, effect.decay) : 2.5;
  const preDelay = typeof effect.preDelay === 'number' ? Math.max(0, effect.preDelay) : 0.01;

  const convolver = ctx.createConvolver();
  convolver.buffer = generateImpulseResponse(ctx, decay, preDelay);
  return convolver;
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

function buildDistortionNode(ctx: OfflineAudioContext, effect: AudioEffectData): AudioNode {
  const distortion =
    typeof effect.distortion === 'number' ? Math.max(0, Math.min(1, effect.distortion)) : 0.4;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(distortion * 400) as unknown as Float32Array<ArrayBuffer>;
  const oversample: OverSampleType =
    effect.oversample === '4x' ? '4x' : effect.oversample === 'none' ? 'none' : '2x';
  shaper.oversample = oversample;
  return shaper;
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
