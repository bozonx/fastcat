import { safeDispose } from '../../utils/video-editor/utils';
import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import {
  getGainAtClipTime,
  normalizeBalance,
  normalizeGain,
  resolveEffectiveFadeDurationsSeconds,
  type AudioFadeCurve,
  type AudioTransitionEnvelope,
} from '../../utils/audio/envelope';
import {
  applyAudioEffectsOffline,
  type AudioEffectData,
} from '../../utils/audio/apply-audio-effects-offline';
import { clampFloat32 } from './utils';
import { usToS } from './time';
import { withWorkerFileIoSlotForHandle } from './io-governor';

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
}): Promise<Float32Array[]> {
  const { planes, sourceSampleRate, targetSampleRate, sourceFrames, targetFrames, channels } =
    params;
  const OfflineCtx =
    globalThis.OfflineAudioContext ||
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
}): Promise<Float32Array[]> {
  const {
    planes,
    sourceSampleRate,
    sourceFrames,
    targetSampleRate,
    targetFrames,
    channels,
    playbackRate,
  } = params;
  const OfflineCtx =
    globalThis.OfflineAudioContext ||
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

export interface PreparedClip {
  clipStartS: number;
  offsetS: number;
  playDurationS: number;
  input: MediabunnyInput;
  sink: MediabunnyAudioSampleSink;
  sourcePath: string;
  speed: number;
  reversed: boolean;
  audioGain: number;
  audioBalance: number;
  audioFadeInS: number;
  audioFadeOutS: number;
  audioFadeInCurve: AudioFadeCurve;
  audioFadeOutCurve: AudioFadeCurve;
  audioEffects: AudioEffectData[];
}

interface MediabunnyInput {
  getPrimaryAudioTrack(): Promise<MediabunnyAudioTrack | null>;
}

interface MediabunnyAudioTrack {
  canDecode(): Promise<boolean>;
  duration?: number;
}

interface MediabunnyAudioSampleSink {
  samples(startS: number, endS: number): AsyncIterable<MediabunnyAudioSample>;
}

interface MediabunnyAudioSample {
  numberOfFrames: number;
  sampleRate: number;
  numberOfChannels: number;
  timestamp: number;
  allocationSize(options: { format: 'f32-planar'; planeIndex: number }): number;
  copyTo(dst: Float32Array, options: { format: 'f32-planar'; planeIndex: number }): void;
}

interface AudioClipData {
  sourcePath?: string;
  source?: { path?: string };
  fileHandle?: FileSystemFileHandle;
  timelineRange?: { startUs?: number; durationUs?: number };
  sourceRange?: { startUs?: number; durationUs?: number };
  startUs?: number;
  durationUs?: number;
  sourceStartUs?: number;
  sourceDurationUs?: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFadeInCurve?: AudioFadeCurve;
  audioFadeOutCurve?: AudioFadeCurve;
  audioDeclickDurationUs?: number;
  defaultAudioFadeCurve?: AudioFadeCurve;
  transitionIn?: AudioTransitionEnvelope | null;
  transitionOut?: AudioTransitionEnvelope | null;
  fastcat?: {
    audioGain?: number;
    audioBalance?: number;
    audioFadeInUs?: number;
    audioFadeOutUs?: number;
    audioFadeInCurve?: AudioFadeCurve;
    audioFadeOutCurve?: AudioFadeCurve;
    audioDeclickDurationUs?: number;
    defaultAudioFadeCurve?: AudioFadeCurve;
    transitionIn?: AudioTransitionEnvelope | null;
    transitionOut?: AudioTransitionEnvelope | null;
  };
  effects?: AudioEffectData[];
}

export interface AudioMixerPrepareParams {
  audioClips: AudioClipData[];
  hostClient: VideoCoreHostAPI | null;
  reportExportWarning: (message: string) => Promise<void>;
  checkCancel?: () => boolean;
  mediabunny: {
    AudioSampleSink: new (...args: unknown[]) => MediabunnyAudioSampleSink;
    Input: new (...args: unknown[]) => MediabunnyInput;
    BlobSource: new (...args: unknown[]) => unknown;
    ALL_FORMATS: unknown;
  };
}

export interface AudioMixerWriteParams {
  prepared: PreparedClip[];
  durationS: number;
  audioSource: { add(sample: unknown): Promise<void> };
  chunkDurationS: number;
  sampleRate: number;
  numberOfChannels: number;
  reportExportWarning: (message: string) => Promise<void>;
  checkCancel?: () => boolean;
  AudioSample: new (params: {
    data: Float32Array;
    format: 'f32-planar';
    numberOfChannels: number;
    sampleRate: number;
    timestamp: number;
  }) => unknown;
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

interface ProcessedClipChunk {
  startFrame: number;
  planes: Float32Array[];
  frames: number;
  gainEnvelope: Float32Array;
  audioBalance: number;
}

interface ActiveProcessedClip {
  clip: PreparedClip;
  iterator: AsyncIterator<ProcessedClipChunk>;
  current: ProcessedClipChunk | null;
  done: boolean;
}

interface PendingProcessedTail {
  startFrame: number;
  planes: Float32Array[];
}

const CLIP_PROCESS_BLOCK_DURATION_S = 10;

function clampFiniteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

function estimateEffectTailS(effect: AudioEffectData): number {
  if (!effect.enabled || effect.target !== 'audio') return 0;

  switch (effect.type) {
    case 'audio-reverb':
    case 'reverb':
      return (
        clampFiniteNumber(effect.decay, 2.5, 0.1, 10) +
        clampFiniteNumber(effect.preDelay, 0.01, 0, 0.5)
      );
    case 'audio-env-stadium': {
      const size = clampFiniteNumber(effect.size, 80, 0, 100);
      return 1 + (size / 100) * 4;
    }
    case 'audio-thought-monologue':
      return 2.2;
    case 'audio-env-behind-wall':
      return 1;
    case 'audio-echo':
    case 'echo': {
      const delayTime = clampFiniteNumber(effect.delayTime, 0.25, 0.02, 1);
      const feedback = clampFiniteNumber(effect.feedback, 0.35, 0, 0.9);
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

function estimateClipProcessingOverlapS(effects: AudioEffectData[]): number {
  const enabledEffects = effects.filter((effect) => effect.enabled && effect.target === 'audio');
  if (enabledEffects.length === 0) return 0;
  const maxTailS = Math.max(0, ...enabledEffects.map(estimateEffectTailS));
  return Math.min(CLIP_PROCESS_BLOCK_DURATION_S, Math.max(0.05, maxTailS));
}

function trimOrPadPlanes(params: {
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

function buildGainEnvelope(params: {
  frames: number;
  startFrame: number;
  targetSampleRate: number;
  clip: PreparedClip;
}): Float32Array {
  const { frames, startFrame, targetSampleRate, clip } = params;
  const gainEnvelope = new Float32Array(frames);
  if (clip.audioFadeInS === 0 && clip.audioFadeOutS === 0) {
    gainEnvelope.fill(clip.audioGain);
    return gainEnvelope;
  }

  gainEnvelope.fill(clip.audioGain);

  const applyEnvelopeRange = (startFrameInClip: number, endFrameInClip: number) => {
    const start = Math.max(0, Math.min(frames, startFrameInClip - startFrame));
    const end = Math.max(start, Math.min(frames, endFrameInClip - startFrame));
    for (let i = start; i < end; i += 1) {
      const frameInClip = startFrame + i;
      gainEnvelope[i] = getGainAtClipTime({
        clipDurationS: clip.playDurationS,
        fadeInS: clip.audioFadeInS,
        fadeOutS: clip.audioFadeOutS,
        fadeInCurve: clip.audioFadeInCurve,
        fadeOutCurve: clip.audioFadeOutCurve,
        baseGain: clip.audioGain,
        tClipS: frameInClip / targetSampleRate,
      });
    }
  };

  if (
    (clip.audioFadeInS > 0 && clip.audioFadeInS >= clip.playDurationS) ||
    (clip.audioFadeOutS > 0 && clip.audioFadeOutS >= clip.playDurationS)
  ) {
    applyEnvelopeRange(startFrame, startFrame + frames);
    return gainEnvelope;
  }

  if (clip.audioFadeInS > 0) {
    applyEnvelopeRange(0, Math.floor(clip.audioFadeInS * targetSampleRate));
  }

  if (clip.audioFadeOutS > 0) {
    const fadeOutStartS = Math.max(0, clip.playDurationS - clip.audioFadeOutS);
    applyEnvelopeRange(
      Math.floor(fadeOutStartS * targetSampleRate),
      Math.floor(clip.playDurationS * targetSampleRate),
    );
  }

  const clipEndFrame = Math.max(
    0,
    Math.min(startFrame + frames, Math.ceil(clip.playDurationS * targetSampleRate)),
  );
  if (clipEndFrame < startFrame + frames) {
    gainEnvelope.fill(0, Math.max(0, clipEndFrame - startFrame));
  }

  return gainEnvelope;
}

function slicePlanes(params: {
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

function crossfadePendingTailIntoBlock(params: {
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
      const previousGain = Math.cos(progress * 0.5 * Math.PI);
      const currentGain = Math.sin(progress * 0.5 * Math.PI);
      block[i] = (pending[i] ?? 0) * previousGain + (block[i] ?? 0) * currentGain;
    }
  }
}

/**
 * Loads all PCM samples covering the clip's playable source window into a
 * contiguous per-channel buffer. The buffer is sized by sinkEnd-sinkStart and
 * the (variable-length) decoder samples are placed by their timestamps so any
 * gaps remain silent rather than getting glued together out of phase.
 */
async function loadClipSourcePlanes(args: {
  sink: MediabunnyAudioSampleSink;
  sinkStartS: number;
  sinkEndS: number;
  checkCancel?: () => boolean;
  reportExportWarning: (message: string) => Promise<void>;
}): Promise<{
  planes: Float32Array[];
  frames: number;
  sampleRate: number;
  channels: number;
} | null> {
  const { sink, sinkStartS, sinkEndS, checkCancel, reportExportWarning } = args;
  const windowS = Math.max(0, sinkEndS - sinkStartS);
  if (windowS <= 0) return null;

  let sourceSampleRate = 0;
  let sourceChannels = 0;
  let planes: Float32Array[] | null = null;
  let totalFrames = 0;
  let warnedFormat = false;
  let warnedRateChange = false;

  for await (const sampleRaw of sink.samples(sinkStartS, sinkEndS)) {
    if (checkCancel?.()) {
      const abortErr = new Error('Export was cancelled');
      (abortErr as Error).name = 'AbortError';
      throw abortErr;
    }
    const sample = sampleRaw as MediabunnyAudioSample;
    try {
      const frames = Number(sample.numberOfFrames) || 0;
      const sr = Number(sample.sampleRate) || 0;
      const ch = Number(sample.numberOfChannels) || 0;
      if (frames <= 0) continue;
      if (sr <= 0 || ch <= 0) {
        if (!warnedFormat) {
          warnedFormat = true;
          await reportExportWarning(
            '[Worker Export] Audio clip sample format is invalid; skipping some audio.',
          );
        }
        continue;
      }

      if (!planes) {
        sourceSampleRate = sr;
        sourceChannels = ch;
        totalFrames = Math.max(1, Math.ceil(windowS * sr));
        planes = Array.from({ length: ch }, () => new Float32Array(totalFrames));
      } else if (sr !== sourceSampleRate || ch !== sourceChannels) {
        if (!warnedRateChange) {
          warnedRateChange = true;
          await reportExportWarning(
            '[Worker Export] Audio clip changed sample rate or channel count mid-stream; skipping incompatible samples.',
          );
        }
        continue;
      }

      // A sample's timestamp can land before sinkStartS when mediabunny rewinds
      // to the nearest keyframe. We must skip the leading frames that belong to
      // the pre-window region, not write them to offset 0 (which would smear
      // unrelated audio over the first frames of the clip).
      const desiredFrameOffset = Math.round(
        (Number(sample.timestamp) - sinkStartS) * sourceSampleRate,
      );
      const skipFramesInSample = Math.max(0, -desiredFrameOffset);
      const writeFrameOffset = Math.max(0, desiredFrameOffset);
      if (writeFrameOffset >= totalFrames) continue;
      if (skipFramesInSample >= frames) continue;

      const framesAvailable = frames - skipFramesInSample;
      const framesToCopy = Math.min(framesAvailable, totalFrames - writeFrameOffset);
      if (framesToCopy <= 0) continue;

      const writableChannels = Math.min(sourceChannels, ch);
      for (let planeIndex = 0; planeIndex < writableChannels; planeIndex += 1) {
        const bytesNeeded = sample.allocationSize({ format: 'f32-planar', planeIndex });
        const sourcePlane = new Float32Array(bytesNeeded / 4);
        sample.copyTo(sourcePlane, { format: 'f32-planar', planeIndex });
        const dest = planes[planeIndex];
        if (!dest) continue;
        const copyEnd = Math.min(sourcePlane.length, skipFramesInSample + framesToCopy);
        if (copyEnd <= skipFramesInSample) continue;
        dest.set(sourcePlane.subarray(skipFramesInSample, copyEnd), writeFrameOffset);
      }
    } finally {
      safeDispose(sample);
    }
  }

  if (!planes || totalFrames === 0) return null;
  return {
    planes,
    frames: totalFrames,
    sampleRate: sourceSampleRate,
    channels: sourceChannels,
  };
}

async function* processClipAudio(args: {
  clip: PreparedClip;
  targetSampleRate: number;
  numberOfChannels: number;
  reportExportWarning: (message: string) => Promise<void>;
  checkCancel?: () => boolean;
}): AsyncGenerator<ProcessedClipChunk> {
  const { clip, targetSampleRate, numberOfChannels, reportExportWarning, checkCancel } = args;
  // Defense in depth: prepareClips already skips reversed clips. This guard
  // keeps writeMixedToSource correct for any caller that hands in prepared
  // clips directly (tests, future re-entry).
  if (clip.reversed) return;
  const expectedOutFrames = Math.max(0, Math.round(clip.playDurationS * targetSampleRate));
  if (expectedOutFrames <= 0) return;

  const blockFrames = Math.max(1, Math.round(CLIP_PROCESS_BLOCK_DURATION_S * targetSampleRate));
  const overlapFrames = Math.min(
    blockFrames,
    Math.round(estimateClipProcessingOverlapS(clip.audioEffects) * targetSampleRate),
  );
  let pendingTail: PendingProcessedTail | null = null;

  for (
    let blockStartFrame = 0;
    blockStartFrame < expectedOutFrames;
    blockStartFrame += blockFrames
  ) {
    if (checkCancel?.()) {
      const abortErr = new Error('Export was cancelled');
      (abortErr as Error).name = 'AbortError';
      throw abortErr;
    }

    const remainingFrames = expectedOutFrames - blockStartFrame;
    const targetFrames = Math.min(blockFrames + overlapFrames, remainingFrames);
    const blockStartS = blockStartFrame / targetSampleRate;
    const outputDurationS = targetFrames / targetSampleRate;
    const sourceStartS = Math.max(0, clip.offsetS + blockStartS * clip.speed);
    const sourceEndS = Math.max(sourceStartS, sourceStartS + outputDurationS * clip.speed);

    const loaded = await loadClipSourcePlanes({
      sink: clip.sink,
      sinkStartS: sourceStartS,
      sinkEndS: sourceEndS,
      checkCancel,
      reportExportWarning,
    });

    let blockPlanes: Float32Array[];
    let blockOutputFrames: number;
    if (loaded) {
      blockPlanes = normalizeSampleChannels({
        planes: loaded.planes,
        sourceChannels: loaded.channels,
        targetChannels: numberOfChannels,
        frames: loaded.frames,
      });
      blockOutputFrames = loaded.frames;
    } else {
      blockPlanes = Array.from({ length: numberOfChannels }, () => new Float32Array(targetFrames));
      blockOutputFrames = targetFrames;
    }

    if (loaded && (loaded.sampleRate !== targetSampleRate || clip.speed !== 1)) {
      try {
        blockPlanes = await resampleAndStretchOffline({
          planes: blockPlanes,
          sourceSampleRate: loaded.sampleRate,
          sourceFrames: blockOutputFrames,
          targetSampleRate,
          targetFrames,
          channels: numberOfChannels,
          playbackRate: clip.speed,
        });
        blockOutputFrames = blockPlanes[0]?.length ?? targetFrames;
      } catch (err) {
        console.error('[Worker Export] Resample audio clip block failed:', err);
        await reportExportWarning(
          '[Worker Export] Failed to resample audio clip block; substituting silence.',
        );
        blockPlanes = Array.from(
          { length: numberOfChannels },
          () => new Float32Array(targetFrames),
        );
        blockOutputFrames = targetFrames;
      }
    }

    blockPlanes = trimOrPadPlanes({
      planes: blockPlanes,
      channels: numberOfChannels,
      frames: targetFrames,
    });
    blockOutputFrames = targetFrames;

    if (clip.audioEffects.length > 0) {
      const processed = await applyAudioEffectsOffline({
        planes: blockPlanes,
        sampleRate: targetSampleRate,
        frames: blockOutputFrames,
        channels: numberOfChannels,
        effects: clip.audioEffects,
      });
      blockPlanes = trimOrPadPlanes({
        planes: processed.planes,
        channels: numberOfChannels,
        frames: targetFrames,
      });
    }

    crossfadePendingTailIntoBlock({
      pendingTail,
      blockPlanes,
      channels: numberOfChannels,
    });
    pendingTail = null;

    const emitFrames = Math.min(blockFrames, expectedOutFrames - blockStartFrame);
    if (emitFrames > 0) {
      yield {
        startFrame: blockStartFrame,
        planes: slicePlanes({
          planes: blockPlanes,
          startFrame: 0,
          frames: emitFrames,
          channels: numberOfChannels,
        }),
        frames: emitFrames,
        gainEnvelope: buildGainEnvelope({
          frames: emitFrames,
          startFrame: blockStartFrame,
          targetSampleRate,
          clip,
        }),
        audioBalance: clip.audioBalance,
      };
    }

    const tailStartInBlock = emitFrames;
    const tailFrames = Math.min(
      overlapFrames,
      Math.max(0, targetFrames - tailStartInBlock),
      Math.max(0, expectedOutFrames - blockStartFrame - emitFrames),
    );
    if (tailFrames > 0) {
      pendingTail = {
        startFrame: blockStartFrame + emitFrames,
        planes: slicePlanes({
          planes: blockPlanes,
          startFrame: tailStartInBlock,
          frames: tailFrames,
          channels: numberOfChannels,
        }),
      };
    }
  }

  if (pendingTail) {
    const frames = pendingTail.planes[0]?.length ?? 0;
    if (frames > 0) {
      yield {
        startFrame: pendingTail.startFrame,
        planes: pendingTail.planes,
        frames,
        gainEnvelope: buildGainEnvelope({
          frames,
          startFrame: pendingTail.startFrame,
          targetSampleRate,
          clip,
        }),
        audioBalance: clip.audioBalance,
      };
    }
  }
}

interface AdjacencyMap {
  prev: Map<AudioClipData, AudioClipData | null>;
  next: Map<AudioClipData, AudioClipData | null>;
}

function buildAdjacencyMap(audioClips: AudioClipData[]): AdjacencyMap {
  const byTrack = new Map<unknown, AudioClipData[]>();
  for (const clip of audioClips) {
    const trackId = (clip as { trackId: string }).trackId;
    let list = byTrack.get(trackId);
    if (!list) {
      list = [];
      byTrack.set(trackId, list);
    }
    list.push(clip);
  }

  const prev = new Map<AudioClipData, AudioClipData | null>();
  const next = new Map<AudioClipData, AudioClipData | null>();

  for (const list of byTrack.values()) {
    list.sort(
      (a, b) =>
        Number(a.startUs ?? a.timelineRange?.startUs ?? 0) -
        Number(b.startUs ?? b.timelineRange?.startUs ?? 0),
    );
    for (let i = 0; i < list.length; i += 1) {
      const clip = list[i]!;
      prev.set(clip, i > 0 ? list[i - 1]! : null);
      next.set(clip, i < list.length - 1 ? list[i + 1]! : null);
    }
  }

  return { prev, next };
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AudioMixer {
  static async prepareClips(params: AudioMixerPrepareParams): Promise<PreparedClip[]> {
    const { audioClips, hostClient, reportExportWarning, checkCancel } = params;
    const { AudioSampleSink, Input, BlobSource, ALL_FORMATS } = params.mediabunny;

    const adjacency = buildAdjacencyMap(audioClips);
    const prepared: PreparedClip[] = [];

    for (const clipData of audioClips) {
      if (checkCancel?.()) {
        const abortErr = new Error('Export was cancelled');
        (abortErr as Error).name = 'AbortError';
        throw abortErr;
      }

      const sourcePath = clipData.sourcePath || clipData.source?.path;
      if (!sourcePath) continue;

      let fileHandle: FileSystemFileHandle | null = clipData.fileHandle || null;
      if (!fileHandle && hostClient) {
        fileHandle = await hostClient.getFileHandleByPath(sourcePath);
      }
      if (!fileHandle) continue;

      let file: File;
      try {
        file =
          (await hostClient?.getFileByPath?.(sourcePath)) ??
          (await withWorkerFileIoSlotForHandle(fileHandle, () => fileHandle.getFile()));
      } catch (err) {
        console.error('[Worker Export] Failed to read audio file handle:', err);
        await reportExportWarning('[Worker Export] Failed to read audio file handle');
        continue;
      }

      const startUs = clipData.startUs ?? clipData.timelineRange?.startUs ?? 0;
      const sourceStartUs = clipData.sourceStartUs ?? clipData.sourceRange?.startUs ?? 0;
      const sourceDurationUs = clipData.sourceDurationUs ?? clipData.sourceRange?.durationUs ?? 0;
      const durationUs = clipData.durationUs ?? clipData.timelineRange?.durationUs ?? 0;

      const speedRaw = Number(clipData.speed);
      const speed =
        Number.isFinite(speedRaw) && speedRaw !== 0
          ? Math.max(0.0001, Math.min(10, Math.abs(speedRaw)))
          : 1;
      const reversed = Number.isFinite(speedRaw) && speedRaw < 0;

      // Reversed clips emit no audio — keeps preview and export in sync.
      if (reversed) continue;

      const previousClip = adjacency.prev.get(clipData) ?? null;
      const nextClip = adjacency.next.get(clipData) ?? null;
      // Fade math is done in timeline-space: source duration must be scaled by
      // 1/speed before comparing with timeline duration so the clamp doesn't
      // chop fades short when speed < 1.
      const timelineDurationS = usToS(Number(durationUs));
      const sourceTimelineDurationS = usToS(Number(sourceDurationUs)) / speed;
      const fadeClipDurationS = Math.max(
        0,
        Math.min(sourceTimelineDurationS, timelineDurationS || sourceTimelineDurationS),
      );
      const {
        fadeInS: audioFadeInS,
        fadeOutS: audioFadeOutS,
        fadeInCurve,
        fadeOutCurve,
      } = resolveEffectiveFadeDurationsSeconds({
        clipDurationS: fadeClipDurationS,
        clip: {
          audioFadeInUs: clipData.audioFadeInUs ?? clipData.fastcat?.audioFadeInUs,
          audioFadeOutUs: clipData.audioFadeOutUs ?? clipData.fastcat?.audioFadeOutUs,
          audioFadeInCurve: clipData.audioFadeInCurve ?? clipData.fastcat?.audioFadeInCurve,
          audioFadeOutCurve: clipData.audioFadeOutCurve ?? clipData.fastcat?.audioFadeOutCurve,
          audioDeclickDurationUs:
            clipData.audioDeclickDurationUs ?? clipData.fastcat?.audioDeclickDurationUs,
          transitionIn: clipData.transitionIn ?? clipData.fastcat?.transitionIn,
          transitionOut: clipData.transitionOut ?? clipData.fastcat?.transitionOut,
        },
        previousClip,
        nextClip,
        defaultAudioFadeCurve:
          clipData.defaultAudioFadeCurve ?? clipData.fastcat?.defaultAudioFadeCurve,
      });

      const clipStartS = Math.max(0, usToS(Number(startUs)));
      const rawOffsetS = Math.max(0, usToS(Number(sourceStartUs)));

      const baseClipDurationS = Math.max(
        0,
        Math.min(
          usToS(Number(sourceDurationUs)) / speed,
          usToS(Number(durationUs)) || usToS(Number(sourceDurationUs)) / speed,
        ),
      );

      // Extend duration and adjust start for adjacent transitions (handles).
      // For reversed playback the source window extends from the other end, so
      // the in-handle pushes the source-end further, not the source-start.
      let playDurationS = baseClipDurationS;
      let effectiveClipStartS = clipStartS;
      let effectiveOffsetS = rawOffsetS;
      let extraSourceTailS = 0;

      const transitionOut = clipData.transitionOut ?? clipData.fastcat?.transitionOut;
      if (
        transitionOut?.durationUs &&
        Number(transitionOut.durationUs) > 0 &&
        transitionOut.mode === 'adjacent'
      ) {
        const outExtensionS = usToS(Number(transitionOut.durationUs));
        playDurationS += outExtensionS;
        if (reversed) {
          // For reversed clips the "tail" of the timeline corresponds to the
          // start of the source, so the source-start must move earlier.
          effectiveOffsetS = Math.max(0, effectiveOffsetS - outExtensionS * speed);
        } else {
          extraSourceTailS += outExtensionS * speed;
        }
      }

      const transitionIn = clipData.transitionIn ?? clipData.fastcat?.transitionIn;
      if (
        transitionIn?.durationUs &&
        Number(transitionIn.durationUs) > 0 &&
        transitionIn.mode === 'adjacent'
      ) {
        const inExtensionS = usToS(Number(transitionIn.durationUs));
        playDurationS += inExtensionS;
        effectiveClipStartS = Math.max(0, clipStartS - inExtensionS);
        if (reversed) {
          // For reversed clips the "head" of the timeline corresponds to the
          // end of the source, so we instead need to read more from the tail.
          extraSourceTailS += inExtensionS * speed;
        } else {
          effectiveOffsetS = Math.max(0, effectiveOffsetS - inExtensionS * speed);
        }
      }

      if (playDurationS <= 0) continue;

      const audioGain = normalizeGain(clipData.audioGain ?? clipData.fastcat?.audioGain, 1);
      const audioBalance = normalizeBalance(
        clipData.audioBalance ?? clipData.fastcat?.audioBalance,
        0,
      );

      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS } as unknown);
      try {
        const aTrack = await input.getPrimaryAudioTrack();
        if (!aTrack) {
          safeDispose(input);
          continue;
        }
        if (!(await aTrack.canDecode())) {
          safeDispose(input);
          continue;
        }

        const sink = new AudioSampleSink(aTrack);

        const offsetS = Math.max(0, effectiveOffsetS);
        const trackDurationS = (aTrack as { duration?: number }).duration;
        const sourceWindowBaseS = playDurationS * speed + extraSourceTailS;
        const maxPlayableS = Math.max(
          0,
          (Number.isFinite(trackDurationS) ? Number(trackDurationS) : Number.POSITIVE_INFINITY) -
            offsetS,
        );
        const finalSourceWindowS = Math.min(sourceWindowBaseS, maxPlayableS);
        // Recompute playDurationS from whatever source window we actually have.
        playDurationS = finalSourceWindowS / speed;
        if (playDurationS <= 0) {
          safeDispose(sink);
          safeDispose(input);
          continue;
        }

        prepared.push({
          clipStartS: effectiveClipStartS,
          offsetS,
          playDurationS,
          input,
          sink,
          sourcePath,
          speed,
          reversed,
          audioGain,
          audioBalance,
          audioFadeInS,
          audioFadeOutS,
          audioFadeInCurve: fadeInCurve,
          audioFadeOutCurve: fadeOutCurve,
          audioEffects: (clipData.effects ?? []).filter((effect) => effect?.target === 'audio'),
        });
      } catch (err) {
        console.error('[Worker Export] Failed to decode audio clip:', err);
        await reportExportWarning('[Worker Export] Failed to decode audio clip');
        safeDispose(input);
      }
    }

    return prepared;
  }

  static async writeMixedToSource(params: AudioMixerWriteParams): Promise<void> {
    const {
      prepared,
      durationS,
      audioSource,
      chunkDurationS,
      sampleRate,
      numberOfChannels,
      reportExportWarning,
      checkCancel,
      AudioSample,
    } = params;

    function ensureNotCancelled() {
      if (!checkCancel?.()) return;
      const abortErr = new Error('Export was cancelled');
      (abortErr as Error).name = 'AbortError';
      throw abortErr;
    }

    const sortedClips = prepared.slice().sort((a, b) => a.clipStartS - b.clipStartS);
    const activeClips: ActiveProcessedClip[] = [];
    let nextLoadIndex = 0;
    let clippedFrames = 0;

    const chunkFrames = Math.ceil(sampleRate * chunkDurationS);
    const totalFrames = Math.round(durationS * sampleRate);
    const totalChunks = Math.max(1, Math.ceil(totalFrames / chunkFrames));

    const mixedInterleavedPool = new Float32Array(chunkFrames * numberOfChannels);
    const planarOutPool = new Float32Array(chunkFrames * numberOfChannels);

    async function pullNextProcessedChunk(
      active: ActiveProcessedClip,
    ): Promise<ProcessedClipChunk | null> {
      const next = await active.iterator.next();
      if (next.done) {
        active.done = true;
        active.current = null;
        return null;
      }
      active.current = next.value;
      return active.current;
    }

    async function getProcessedChunkForFrame(
      active: ActiveProcessedClip,
      frame: number,
    ): Promise<ProcessedClipChunk | null> {
      while (
        !active.done &&
        (!active.current || active.current.startFrame + active.current.frames <= frame)
      ) {
        await pullNextProcessedChunk(active);
      }
      return active.current;
    }

    function mixProcessedChunk(params: {
      processed: ProcessedClipChunk;
      sourceStartFrame: number;
      sourceEndFrame: number;
      writeStartFrame: number;
      mixedInterleaved: Float32Array;
    }): number {
      const { processed, sourceStartFrame, sourceEndFrame, writeStartFrame, mixedInterleaved } =
        params;
      const processedStartFrame = processed.startFrame;
      const processedEndFrame = processedStartFrame + processed.frames;
      const segmentStartFrame = Math.max(sourceStartFrame, processedStartFrame);
      const segmentEndFrame = Math.min(sourceEndFrame, processedEndFrame);
      const framesToWrite = Math.max(0, segmentEndFrame - segmentStartFrame);
      if (framesToWrite <= 0) return segmentEndFrame;

      const sourceOffsetFrame = segmentStartFrame - processedStartFrame;
      const writeOffsetFrame = writeStartFrame + (segmentStartFrame - sourceStartFrame);

      if (numberOfChannels === 2) {
        const planeL = processed.planes[0];
        const planeR = processed.planes[1];
        if (!planeL || !planeR) return segmentEndFrame;
        const { ll, lr, rl, rr } = getStereoPanMatrix(processed.audioBalance);
        for (let i = 0; i < framesToWrite; i += 1) {
          const srcIdx = sourceOffsetFrame + i;
          const dstFrame = writeOffsetFrame + i;
          const g = processed.gainEnvelope[srcIdx] ?? 0;
          if (g === 0) continue;
          const L = (planeL[srcIdx] ?? 0) * g;
          const R = (planeR[srcIdx] ?? 0) * g;
          const idxL = dstFrame * 2;
          mixedInterleaved[idxL] = (mixedInterleaved[idxL] ?? 0) + (ll * L + lr * R);
          mixedInterleaved[idxL + 1] = (mixedInterleaved[idxL + 1] ?? 0) + (rl * L + rr * R);
        }
        return segmentEndFrame;
      }

      const plane = processed.planes[0];
      if (!plane) return segmentEndFrame;
      for (let i = 0; i < framesToWrite; i += 1) {
        const srcIdx = sourceOffsetFrame + i;
        const dstFrame = writeOffsetFrame + i;
        const v = (plane[srcIdx] ?? 0) * (processed.gainEnvelope[srcIdx] ?? 0);
        mixedInterleaved[dstFrame] = (mixedInterleaved[dstFrame] ?? 0) + v;
      }

      return segmentEndFrame;
    }

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        ensureNotCancelled();

        const chunkStartFrame = chunkIndex * chunkFrames;
        const chunkEndFrame = Math.min(totalFrames, chunkStartFrame + chunkFrames);
        const framesInChunk = chunkEndFrame - chunkStartFrame;
        if (framesInChunk <= 0) continue;

        // Lazy-load any clips that start before the end of this chunk.
        while (nextLoadIndex < sortedClips.length) {
          const clip = sortedClips[nextLoadIndex]!;
          const clipStartFrame = Math.round(clip.clipStartS * sampleRate);
          if (clipStartFrame >= chunkEndFrame) break;
          ensureNotCancelled();
          activeClips.push({
            clip,
            iterator: processClipAudio({
              clip,
              targetSampleRate: sampleRate,
              numberOfChannels,
              reportExportWarning,
              checkCancel,
            }),
            current: null,
            done: false,
          });
          nextLoadIndex += 1;
        }

        const mixedInterleaved = mixedInterleavedPool.subarray(0, framesInChunk * numberOfChannels);
        mixedInterleaved.fill(0);

        for (const active of activeClips) {
          const { clip } = active;
          ensureNotCancelled();

          const clipStartFrame = Math.round(clip.clipStartS * sampleRate);
          const clipEndFrame = clipStartFrame + Math.round(clip.playDurationS * sampleRate);
          if (clipEndFrame <= chunkStartFrame) continue;
          if (clipStartFrame >= chunkEndFrame) continue;

          const overlapStartFrame = Math.max(chunkStartFrame, clipStartFrame);
          const overlapEndFrame = Math.min(chunkEndFrame, clipEndFrame);
          const framesToWrite = overlapEndFrame - overlapStartFrame;
          if (framesToWrite <= 0) continue;

          const writeStartFrame = overlapStartFrame - chunkStartFrame;
          const sourceStartFrame = overlapStartFrame - clipStartFrame;
          const sourceEndFrame = sourceStartFrame + framesToWrite;
          let sourceCursorFrame = sourceStartFrame;
          try {
            while (sourceCursorFrame < sourceEndFrame) {
              const processed = await getProcessedChunkForFrame(active, sourceCursorFrame);
              if (!processed) break;
              if (processed.startFrame > sourceCursorFrame) {
                sourceCursorFrame = Math.min(processed.startFrame, sourceEndFrame);
                continue;
              }
              const nextCursorFrame = mixProcessedChunk({
                processed,
                sourceStartFrame: sourceCursorFrame,
                sourceEndFrame,
                writeStartFrame: writeStartFrame + (sourceCursorFrame - sourceStartFrame),
                mixedInterleaved,
              });
              if (nextCursorFrame <= sourceCursorFrame) break;
              sourceCursorFrame = nextCursorFrame;
            }
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err;
            console.error('[Worker Export] Failed to decode audio clip segment:', err);
            await reportExportWarning('[Worker Export] Failed to decode audio clip');
            safeDispose(clip.sink);
            safeDispose(clip.input);
            active.done = true;
            active.current = null;
            if (typeof active.iterator.return === 'function') {
              await active.iterator.return();
            }
          }
        }

        // Final clip pass — count clipped audio frames once even for stereo.
        const mixLen = mixedInterleaved.length;
        for (let frame = 0; frame < framesInChunk; frame += 1) {
          let clippedFrame = false;
          for (let channel = 0; channel < numberOfChannels; channel += 1) {
            const index = frame * numberOfChannels + channel;
            if (index >= mixLen) continue;
            const v = mixedInterleaved[index] ?? 0;
            const clamped = clampFloat32(v);
            if (v !== clamped) clippedFrame = true;
            mixedInterleaved[index] = clamped;
          }
          if (clippedFrame) clippedFrames += 1;
        }

        for (let i = activeClips.length - 1; i >= 0; i -= 1) {
          const active = activeClips[i]!;
          const clipStartFrame = Math.round(active.clip.clipStartS * sampleRate);
          const clipEndFrame = clipStartFrame + Math.round(active.clip.playDurationS * sampleRate);
          if (clipEndFrame <= chunkEndFrame || active.done) {
            if (typeof active.iterator.return === 'function') {
              await active.iterator.return();
            }
            activeClips.splice(i, 1);
          }
        }

        const planarOut = planarOutPool.subarray(0, framesInChunk * numberOfChannels);
        const planar = interleavedToPlanar({
          interleaved: mixedInterleaved,
          frames: framesInChunk,
          numberOfChannels,
          planarOut,
        });

        const audioSample = new AudioSample({
          data: planar.slice(),
          format: 'f32-planar',
          numberOfChannels,
          sampleRate,
          timestamp: chunkStartFrame / sampleRate,
        });

        try {
          await (audioSource as { add: (sample: unknown) => Promise<void> }).add(audioSample);
        } finally {
          safeDispose(audioSample);
        }
      }

      if (clippedFrames > 0) {
        await reportExportWarning(
          `[Worker Export] Audio output clipped on ${clippedFrames} samples; consider lowering clip or track gain.`,
        );
      }
    } finally {
      for (const active of activeClips) {
        if (typeof active.iterator.return === 'function') {
          await active.iterator.return();
        }
      }
      for (const clip of prepared) {
        safeDispose(clip.sink);
        safeDispose(clip.input);
      }
    }
  }
}
