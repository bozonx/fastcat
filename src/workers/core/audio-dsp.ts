import { clamp, clampFinite } from '~/utils/math';
import { equalPowerGains } from '../../utils/audio/crossfade';
import type { AudioEffectData } from '../../utils/audio/apply-audio-effects-offline';

/**
 * Pure, self-contained audio buffer / DSP helpers shared by the export mixer
 * (`AudioMixer.ts`). Kept side-effect free and free of mixer-domain types so
 * they can be unit-tested and reused in isolation.
 */

export const CLIP_PROCESS_BLOCK_DURATION_S = 10;

export function interleavedToPlanar(params: {
  interleaved: Float32Array;
  frames: number;
  numberOfChannels: number;
  planarOut?: Float32Array;
}): Float32Array {
  const { interleaved, frames, numberOfChannels, planarOut } = params;
  const planar = planarOut ?? new Float32Array(frames * numberOfChannels);
  for (let c = 0; c < numberOfChannels; c += 1) {
    const dstOffset = c * frames;
    let srcOffset = c;
    for (let i = 0; i < frames; i += 1) {
      planar[dstOffset + i] = interleaved[srcOffset] ?? 0;
      srcOffset += numberOfChannels;
    }
  }
  return planar;
}

export function planarToInterleaved(params: {
  planar: Float32Array;
  frames: number;
  numberOfChannels: number;
  interleavedOut?: Float32Array;
}): Float32Array {
  const { planar, frames, numberOfChannels, interleavedOut } = params;
  const interleaved = interleavedOut ?? new Float32Array(frames * numberOfChannels);
  for (let c = 0; c < numberOfChannels; c += 1) {
    const srcOffset = c * frames;
    let dstOffset = c;
    for (let i = 0; i < frames; i += 1) {
      interleaved[dstOffset] = planar[srcOffset + i] ?? 0;
      dstOffset += numberOfChannels;
    }
  }
  return interleaved;
}

export function interleaveFromPlanes(
  planes: Float32Array[],
  startFrame: number,
  frames: number,
  channels: number,
): Float32Array {
  const out = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const plane = planes[channel];
    let dst = channel;
    for (let i = 0; i < frames; i += 1) {
      out[dst] = plane?.[startFrame + i] ?? 0;
      dst += channels;
    }
  }
  return out;
}

export function normalizeSampleChannels(params: {
  planes: Float32Array[];
  sourceChannels: number;
  targetChannels: number;
  frames: number;
}): Float32Array[] {
  const { planes, sourceChannels, targetChannels, frames } = params;

  if (targetChannels <= 0 || frames <= 0) {
    return [];
  }

  if (sourceChannels === targetChannels) {
    return Array.from({ length: targetChannels }, (_, index) => {
      const plane = planes[index];
      if (plane && plane.length >= frames) {
        return plane;
      }
      const fallback = new Float32Array(frames);
      if (plane) {
        fallback.set(plane.subarray(0, Math.min(frames, plane.length)));
      }
      return fallback;
    });
  }

  if (sourceChannels <= 1 && targetChannels === 2) {
    const mono = planes[0] ?? new Float32Array(frames);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      const value = mono[i] ?? 0;
      left[i] = value;
      right[i] = value;
    }
    return [left, right];
  }

  if (sourceChannels >= 2 && targetChannels === 1) {
    const left = planes[0] ?? new Float32Array(frames);
    const right = planes[1] ?? left;
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      mono[i] = ((left[i] ?? 0) + (right[i] ?? 0)) * 0.5;
    }
    return [mono];
  }

  return Array.from({ length: targetChannels }, (_, index) => {
    const sourceIndex = Math.min(index, Math.max(0, sourceChannels - 1));
    const sourcePlane = planes[sourceIndex] ?? planes[0];
    const nextPlane = new Float32Array(frames);
    if (sourcePlane) {
      nextPlane.set(sourcePlane.subarray(0, Math.min(frames, sourcePlane.length)));
    }
    return nextPlane;
  });
}

export async function resampleChannelsOfflineAudioContext(params: {
  planes: Float32Array[];
  sourceSampleRate: number;
  targetSampleRate: number;
  sourceFrames: number;
  targetFrames: number;
  channels: number;
  createOfflineAudioContext?: typeof OfflineAudioContext;
}): Promise<Float32Array[]> {
  const { planes, sourceSampleRate, targetSampleRate, sourceFrames, targetFrames, channels } =
    params;
  const OfflineCtx =
    params.createOfflineAudioContext ??
    globalThis.OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) {
    throw new Error('OfflineAudioContext not supported');
  }
  const offlineCtx = new OfflineCtx(channels, targetFrames, targetSampleRate);
  const buffer = offlineCtx.createBuffer(channels, sourceFrames, sourceSampleRate);
  for (let i = 0; i < channels; i += 1) {
    if (planes[i]) {
      buffer.copyToChannel(planes[i] as unknown as Float32Array<ArrayBuffer>, i, 0);
    }
  }
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const renderedBuffer = await offlineCtx.startRendering();
  try {
    source.disconnect();
  } catch {
    /* no-op */
  }
  const resampledPlanes: Float32Array[] = [];
  for (let i = 0; i < channels; i += 1) {
    resampledPlanes.push(renderedBuffer.getChannelData(i));
  }
  return resampledPlanes;
}

/**
 * Performs resample + time-stretch (via playbackRate) in a single
 * OfflineAudioContext pass. playbackRate=2 makes a clip play twice as fast,
 * matching the convention used by AudioBufferSourceNode.
 */
export async function resampleAndStretchOffline(params: {
  planes: Float32Array[];
  sourceSampleRate: number;
  sourceFrames: number;
  targetSampleRate: number;
  targetFrames: number;
  channels: number;
  playbackRate: number;
  createOfflineAudioContext?: typeof OfflineAudioContext;
}): Promise<Float32Array[]> {
  const {
    planes,
    sourceSampleRate,
    sourceFrames,
    targetSampleRate,
    targetFrames,
    channels,
    playbackRate,
    createOfflineAudioContext,
  } = params;
  const OfflineCtx =
    createOfflineAudioContext ??
    globalThis.OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) {
    throw new Error('OfflineAudioContext not supported');
  }
  const safePlaybackRate =
    Number.isFinite(playbackRate) && playbackRate > 0
      ? Math.max(0.01, Math.min(100, playbackRate))
      : 1;
  const offlineCtx = new OfflineCtx(channels, Math.max(1, targetFrames), targetSampleRate);
  const buffer = offlineCtx.createBuffer(
    channels,
    Math.max(1, sourceFrames),
    Math.max(1, sourceSampleRate),
  );
  for (let i = 0; i < channels; i += 1) {
    const plane = planes[i];
    if (plane) {
      buffer.copyToChannel(plane as unknown as Float32Array<ArrayBuffer>, i, 0);
    }
  }
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = safePlaybackRate;
  source.connect(offlineCtx.destination);
  source.start(0);
  const renderedBuffer = await offlineCtx.startRendering();
  try {
    source.disconnect();
  } catch {
    /* no-op */
  }
  const out: Float32Array[] = [];
  for (let i = 0; i < channels; i += 1) {
    out.push(renderedBuffer.getChannelData(i));
  }
  return out;
}

export interface StereoPanMatrix {
  ll: number;
  lr: number;
  rl: number;
  rr: number;
}

/**
 * Equal-power stereo pan matrix matching the W3C StereoPannerNode formula
 * (used by the monitor): for pan ∈ [-1, 0] the right channel attenuates by
 * cos(angle) and is folded into the left by sin(angle); for pan ∈ (0, 1]
 * the left channel does the same toward the right. This is the per-frame
 * mixing that StereoPannerNode performs internally — keeping render in sync
 * with preview.
 *
 * The native Tauri mixer (`src-tauri/src/audio/mix.rs`) now uses the same
 * equal-power law, so web and native renders are aligned. Center is unity on
 * both channels (no ~3 dB dip), so applying it on both the layer and the bus is
 * a no-op at default balance.
 */
export function getStereoPanMatrix(audioBalance: number): StereoPanMatrix {
  const pan = Math.max(-1, Math.min(1, Number.isFinite(audioBalance) ? audioBalance : 0));
  const clean = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value);
  if (pan <= 0) {
    const t = -pan;
    return {
      ll: 1,
      lr: clean(Math.sin((t * Math.PI) / 2)),
      rl: 0,
      rr: clean(Math.cos((t * Math.PI) / 2)),
    };
  }
  const t = pan;
  return {
    ll: clean(Math.cos((t * Math.PI) / 2)),
    lr: 0,
    rl: clean(Math.sin((t * Math.PI) / 2)),
    rr: 1,
  };
}

export function estimateEffectTailS(effect: AudioEffectData): number {
  if (!effect.enabled || effect.target !== 'audio') return 0;

  switch (effect.type) {
    case 'audio-reverb':
    case 'reverb':
      return (
        clamp(clampFinite(effect.decay, 2.5), 0.1, 10) +
        clamp(clampFinite(effect.preDelay, 0.01), 0, 0.5)
      );
    case 'audio-env-stadium': {
      const size = clamp(clampFinite(effect.size, 80), 0, 100);
      return 1 + (size / 100) * 4;
    }
    case 'audio-thought-monologue':
      return 2.2;
    case 'audio-env-behind-wall':
      return 1;
    case 'audio-echo':
    case 'echo': {
      const delayTime = clamp(clampFinite(effect.delayTime, 0.25), 0.02, 1);
      const feedback = clamp(clampFinite(effect.feedback, 0.35), 0, 0.9);
      return Math.min(8, delayTime * Math.max(2, Math.ceil(1 / Math.max(0.1, 1 - feedback))));
    }
    case 'audio-flanger':
    case 'audio-voice-robot':
      return 0.08;
    case 'audio-old-vinyl':
      return 0.12;
    case 'audio-compressor':
      return 0.4;
    case 'audio-phaser':
      return 0.2;
    default:
      return 0;
  }
}

export function estimateClipProcessingOverlapS(effects: AudioEffectData[]): number {
  const enabledEffects = effects.filter((effect) => effect.enabled && effect.target === 'audio');
  if (enabledEffects.length === 0) return 0;
  const maxTailS = Math.max(0, ...enabledEffects.map(estimateEffectTailS));
  return Math.min(CLIP_PROCESS_BLOCK_DURATION_S, Math.max(0.05, maxTailS));
}

export function trimOrPadPlanes(params: {
  planes: Float32Array[];
  channels: number;
  frames: number;
}): Float32Array[] {
  const { planes, channels, frames } = params;
  return Array.from({ length: channels }, (_, channel) => {
    const plane = planes[channel] ?? new Float32Array(0);
    if (plane.length === frames) return plane;
    const fixed = new Float32Array(frames);
    fixed.set(plane.subarray(0, Math.min(plane.length, frames)));
    return fixed;
  });
}

export function slicePlanes(params: {
  planes: Float32Array[];
  startFrame: number;
  frames: number;
  channels: number;
}): Float32Array[] {
  const { planes, startFrame, frames, channels } = params;
  return Array.from({ length: channels }, (_, channel) => {
    const plane = planes[channel] ?? new Float32Array(0);
    const out = new Float32Array(frames);
    if (frames > 0 && startFrame < plane.length) {
      out.set(plane.subarray(startFrame, Math.min(plane.length, startFrame + frames)));
    }
    return out;
  });
}

export interface PendingProcessedTail {
  startFrame: number;
  planes: Float32Array[];
}

export function crossfadePendingTailIntoBlock(params: {
  pendingTail: PendingProcessedTail | null;
  blockPlanes: Float32Array[];
  channels: number;
}) {
  const { pendingTail, blockPlanes, channels } = params;
  if (!pendingTail) return;

  const overlapFrames = Math.min(pendingTail.planes[0]?.length ?? 0, blockPlanes[0]?.length ?? 0);
  if (overlapFrames <= 0) return;

  for (let channel = 0; channel < channels; channel += 1) {
    const pending = pendingTail.planes[channel];
    const block = blockPlanes[channel];
    if (!pending || !block) continue;

    for (let i = 0; i < overlapFrames; i += 1) {
      if (overlapFrames <= 1) {
        block[i] = block[i] ?? 0;
        continue;
      }
      const progress = i / (overlapFrames - 1);
      const { out: previousGain, in: currentGain } = equalPowerGains(progress);
      block[i] = (pending[i] ?? 0) * previousGain + (block[i] ?? 0) * currentGain;
    }
  }
}

/**
 * Per-channel FIFO that lets the master-bus streamer retain the overlap region
 * for re-processing while dropping already-emitted frames. Compacts/grows in
 * place so appends stay amortised O(1).
 */
export class PlanarFifo {
  private data: Float32Array[];
  private start = 0;
  private end = 0;
  private capacity: number;

  constructor(
    private readonly channels: number,
    initialCapacity: number,
  ) {
    this.capacity = Math.max(1, initialCapacity);
    this.data = Array.from({ length: channels }, () => new Float32Array(this.capacity));
  }

  get length(): number {
    return this.end - this.start;
  }

  append(planes: Float32Array[], frames: number): void {
    if (frames <= 0) return;
    if (this.end + frames > this.capacity) {
      const live = this.length;
      const nextCapacity = Math.max(live + frames, this.capacity * 2);
      const next = Array.from({ length: this.channels }, () => new Float32Array(nextCapacity));
      for (let ch = 0; ch < this.channels; ch += 1) {
        next[ch]!.set(this.data[ch]!.subarray(this.start, this.end), 0);
      }
      this.data = next;
      this.capacity = nextCapacity;
      this.end = live;
      this.start = 0;
    }
    for (let ch = 0; ch < this.channels; ch += 1) {
      const src = planes[ch];
      if (src) this.data[ch]!.set(src.subarray(0, frames), this.end);
    }
    this.end += frames;
  }

  read(count: number): Float32Array[] {
    const n = Math.min(count, this.length);
    return Array.from({ length: this.channels }, (_, ch) =>
      this.data[ch]!.slice(this.start, this.start + n),
    );
  }

  drop(count: number): void {
    this.start = Math.min(this.end, this.start + Math.max(0, count));
    if (this.start >= this.end) {
      this.start = 0;
      this.end = 0;
    }
  }
}
