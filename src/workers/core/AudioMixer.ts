import { TICKS_PER_SECOND } from '~/utils/time';
import { createDevLogger } from '~/utils/dev-logger';
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
import { ticksToSecondsClamped } from './time';
import { runResilientWorkerFileIo } from './io-governor';
import { governedBlobWorker } from '~/utils/io/governed-blob-worker';
import type { ClipAnimations } from '~/timeline/types';
import { evalTrackAt } from '~/timeline/animation/evaluate';
import {
  CLIP_PROCESS_BLOCK_DURATION_S,
  crossfadePendingTailIntoBlock,
  estimateClipProcessingOverlapS,
  getStereoPanMatrix,
  interleaveFromPlanes,
  interleavedToPlanar,
  normalizeSampleChannels,
  PlanarFifo,
  resampleAndStretchOffline,
  slicePlanes,
  trimOrPadPlanes,
  type PendingProcessedTail,
} from './audio-dsp';

const log = createDevLogger('AudioMixer');

// Re-export the pure DSP helpers so existing import sites (and tests) that
// reference them via `AudioMixer` keep working after the extraction into
// `audio-dsp.ts`.
export {
  interleavedToPlanar,
  planarToInterleaved,
  normalizeSampleChannels,
  resampleChannelsOfflineAudioContext,
  resampleAndStretchOffline,
  getStereoPanMatrix,
  trimOrPadPlanes,
  slicePlanes,
  type StereoPanMatrix,
} from './audio-dsp';

export interface PreparedClip {
  clipStartS: number;
  offsetS: number;
  playDurationS: number;
  input: MediabunnyInput;
  sink: MediabunnyAudioSampleSink;
  sourcePath: string;
  speed: number;
  audioGain: number;
  audioBalance: number;
  animations?: ClipAnimations;
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
  animations?: ClipAnimations;
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
    animations?: ClipAnimations;
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
  masterAudioEffects?: import('../../utils/audio/apply-audio-effects-offline').AudioEffectData[];
  onProgress?: (progress: number) => void;
}

interface ProcessedClipChunk {
  startFrame: number;
  planes: Float32Array[];
  frames: number;
  gainEnvelope: Float32Array;
  panEnvelope: Float32Array;
}

interface ActiveProcessedClip {
  clip: PreparedClip;
  iterator: AsyncIterator<ProcessedClipChunk>;
  current: ProcessedClipChunk | null;
  done: boolean;
}

export async function pullNextProcessedChunk(
  active: ActiveProcessedClip,
): Promise<ProcessedClipChunk | null> {
  const next = await active.iterator.next();
  if (next.done) {
    active.done = true;
    active.current = null;
    return null;
  }
  active.current = next.value as ProcessedClipChunk;
  return active.current;
}

export async function getProcessedChunkForFrame(
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

export function mixProcessedChunk(params: {
  processed: ProcessedClipChunk;
  sourceStartFrame: number;
  sourceEndFrame: number;
  writeStartFrame: number;
  mixedInterleaved: Float32Array;
  numberOfChannels: number;
}): number {
  const {
    processed,
    sourceStartFrame,
    sourceEndFrame,
    writeStartFrame,
    mixedInterleaved,
    numberOfChannels,
  } = params;
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
    for (let i = 0; i < framesToWrite; i += 1) {
      const srcIdx = sourceOffsetFrame + i;
      const dstFrame = writeOffsetFrame + i;
      const g = processed.gainEnvelope[srcIdx] ?? 0;
      if (g === 0) continue;
      const { ll, lr, rl, rr } = getStereoPanMatrix(processed.panEnvelope[srcIdx] ?? 0);
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

export function buildGainEnvelope(params: {
  frames: number;
  startFrame: number;
  targetSampleRate: number;
  clip: PreparedClip;
}): Float32Array {
  const { frames, startFrame, targetSampleRate, clip } = params;
  const gainEnvelope = new Float32Array(frames);
  const volumeTrack = clip.animations?.['audio.volume'];
  if (clip.audioFadeInS === 0 && clip.audioFadeOutS === 0 && !volumeTrack?.keyframes.length) {
    gainEnvelope.fill(clip.audioGain);
    return gainEnvelope;
  }

  gainEnvelope.fill(clip.audioGain);

  const applyEnvelopeRange = (startFrameInClip: number, endFrameInClip: number) => {
    const start = Math.max(0, Math.min(frames, startFrameInClip - startFrame));
    const end = Math.max(start, Math.min(frames, endFrameInClip - startFrame));
    for (let i = start; i < end; i += 1) {
      const frameInClip = startFrame + i;
      const animatedGain = evalTrackAt(
        volumeTrack,
        Math.round((clip.offsetS + (frameInClip / targetSampleRate) * clip.speed) * TICKS_PER_SECOND),
      );
      const baseGain =
        animatedGain === undefined ? clip.audioGain : Math.max(0, Math.min(10, animatedGain));
      gainEnvelope[i] = getGainAtClipTime({
        clipDurationS: clip.playDurationS,
        fadeInS: clip.audioFadeInS,
        fadeOutS: clip.audioFadeOutS,
        fadeInCurve: clip.audioFadeInCurve,
        fadeOutCurve: clip.audioFadeOutCurve,
        baseGain,
        tClipS: frameInClip / targetSampleRate,
      });
    }
  };

  if (
    (clip.audioFadeInS > 0 && clip.audioFadeInS >= clip.playDurationS) ||
    (clip.audioFadeOutS > 0 && clip.audioFadeOutS >= clip.playDurationS) ||
    !!volumeTrack?.keyframes.length
  ) {
    applyEnvelopeRange(startFrame, startFrame + frames);
    return gainEnvelope;
  }

  // Use Math.ceil for the fade-in upper bound so the boundary frame (where
  // frame_time/sr < fadeInS but floor(fadeIn*sr) equals the frame index) still
  // gets evaluated through getGainAtClipTime; it returns baseGain past the
  // fade so the extra iteration is a no-op but the in-fade boundary frame is
  // no longer left at baseGain when playDurationS*sr is fractional.
  if (clip.audioFadeInS > 0) {
    applyEnvelopeRange(0, Math.ceil(clip.audioFadeInS * targetSampleRate));
  }

  // Same idea on the trailing edge: Math.floor for the upper bound would skip
  // the last frame whenever playDurationS*sr rounds up (e.g. 1.4995 → 1500
  // expected frames but floor = 1499), leaving that final frame at baseGain
  // and producing a sub-millisecond click at the clip tail.
  if (clip.audioFadeOutS > 0) {
    const fadeOutStartS = Math.max(0, clip.playDurationS - clip.audioFadeOutS);
    applyEnvelopeRange(
      Math.floor(fadeOutStartS * targetSampleRate),
      Math.ceil(clip.playDurationS * targetSampleRate),
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

function buildPanEnvelope(params: {
  frames: number;
  startFrame: number;
  targetSampleRate: number;
  clip: PreparedClip;
}): Float32Array {
  const { frames, startFrame, targetSampleRate, clip } = params;
  const panEnvelope = new Float32Array(frames);
  const panTrack = clip.animations?.['audio.pan'];
  if (!panTrack?.keyframes.length) {
    panEnvelope.fill(clip.audioBalance);
    return panEnvelope;
  }
  for (let i = 0; i < frames; i += 1) {
    const frameInClip = startFrame + i;
    const value = evalTrackAt(
      panTrack,
      Math.round((clip.offsetS + (frameInClip / targetSampleRate) * clip.speed) * TICKS_PER_SECOND),
    );
    panEnvelope[i] = Math.max(-1, Math.min(1, value ?? clip.audioBalance));
  }
  return panEnvelope;
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
        log.error('[Worker Export] Resample audio clip block failed:', err);
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
        panEnvelope: buildPanEnvelope({
          frames: emitFrames,
          startFrame: blockStartFrame,
          targetSampleRate,
          clip,
        }),
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
        panEnvelope: buildPanEnvelope({
          frames,
          startFrame: pendingTail.startFrame,
          targetSampleRate,
          clip,
        }),
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

interface EmittedInterleavedChunk {
  interleaved: Float32Array;
  frames: number;
  startFrame: number;
}

/**
 * Streams master-bus audio effects over the mixed signal in large overlapping
 * blocks with an equal-power crossfade between blocks — the same technique the
 * per-clip path uses. This keeps time-based master effects (reverb/echo/delay
 * tails, compressor/limiter envelopes) continuous across the whole render,
 * instead of resetting effect state on every output chunk (which gated reverb
 * tails and pumped dynamics on each output-chunk boundary).
 */
class MasterEffectStreamer {
  private readonly channels: number;
  private readonly sampleRate: number;
  private readonly effects: AudioEffectData[];
  private readonly emitChunkFrames: number;
  private readonly emitBlockFrames: number;
  private readonly overlapFrames: number;
  private readonly fifo: PlanarFifo;
  private pendingTail: PendingProcessedTail | null = null;
  private consumedFrames = 0;

  constructor(params: {
    channels: number;
    sampleRate: number;
    effects: AudioEffectData[];
    emitChunkFrames: number;
  }) {
    this.channels = params.channels;
    this.sampleRate = params.sampleRate;
    this.effects = params.effects;
    this.emitChunkFrames = Math.max(1, params.emitChunkFrames);
    this.emitBlockFrames = Math.max(
      1,
      Math.round(CLIP_PROCESS_BLOCK_DURATION_S * params.sampleRate),
    );
    this.overlapFrames = Math.min(
      this.emitBlockFrames,
      Math.round(estimateClipProcessingOverlapS(params.effects) * params.sampleRate),
    );
    this.fifo = new PlanarFifo(
      params.channels,
      this.emitBlockFrames + this.overlapFrames + this.emitChunkFrames,
    );
  }

  async push(interleaved: Float32Array, frames: number): Promise<EmittedInterleavedChunk[]> {
    if (frames > 0) {
      const planarContig = interleavedToPlanar({
        interleaved,
        frames,
        numberOfChannels: this.channels,
      });
      const planes: Float32Array[] = [];
      for (let ch = 0; ch < this.channels; ch += 1) {
        planes.push(planarContig.subarray(ch * frames, (ch + 1) * frames));
      }
      this.fifo.append(planes, frames);
    }
    return this.drain(false);
  }

  async flush(): Promise<EmittedInterleavedChunk[]> {
    return this.drain(true);
  }

  private async drain(flush: boolean): Promise<EmittedInterleavedChunk[]> {
    const out: EmittedInterleavedChunk[] = [];
    const blockSpan = this.emitBlockFrames + this.overlapFrames;

    while (this.fifo.length > 0 && (flush || this.fifo.length >= blockSpan)) {
      const take = Math.min(blockSpan, this.fifo.length);
      const blockPlanes = this.fifo.read(take);

      const processed = await applyAudioEffectsOffline({
        planes: blockPlanes,
        sampleRate: this.sampleRate,
        frames: take,
        channels: this.channels,
        effects: this.effects,
      });
      const outPlanes = trimOrPadPlanes({
        planes: processed.planes,
        channels: this.channels,
        frames: take,
      });

      crossfadePendingTailIntoBlock({
        pendingTail: this.pendingTail,
        blockPlanes: outPlanes,
        channels: this.channels,
      });
      this.pendingTail = null;

      const emitFrames = Math.min(this.emitBlockFrames, take);
      for (let off = 0; off < emitFrames; off += this.emitChunkFrames) {
        const n = Math.min(this.emitChunkFrames, emitFrames - off);
        out.push({
          interleaved: interleaveFromPlanes(outPlanes, off, n, this.channels),
          frames: n,
          startFrame: this.consumedFrames + off,
        });
      }

      const tailFrames = Math.min(this.overlapFrames, take - emitFrames);
      if (tailFrames > 0) {
        this.pendingTail = {
          startFrame: this.consumedFrames + emitFrames,
          planes: slicePlanes({
            planes: outPlanes,
            startFrame: emitFrames,
            frames: tailFrames,
            channels: this.channels,
          }),
        };
      }

      this.fifo.drop(emitFrames);
      this.consumedFrames += emitFrames;
    }

    return out;
  }
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

      // Reversed (negative-speed) clips are intentionally muted: they are not
      // played in the monitor and must not be exported either. Skip before any
      // file I/O so we don't decode audio that will be silenced anyway.
      const speedSign = Number(clipData.speed);
      if (Number.isFinite(speedSign) && speedSign < 0) continue;

      let fileHandle: FileSystemFileHandle | null = clipData.fileHandle || null;
      if (!fileHandle && hostClient) {
        fileHandle = await hostClient.getFileHandleByPath(sourcePath);
      }
      if (!fileHandle) continue;

      let file: File;
      try {
        file =
          (await hostClient?.getFileByPath?.(sourcePath)) ??
          (await runResilientWorkerFileIo(fileHandle, () => fileHandle.getFile()));
      } catch (err) {
        log.error('[Worker Export] Failed to read audio file handle:', err);
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

      const previousClip = adjacency.prev.get(clipData) ?? null;
      const nextClip = adjacency.next.get(clipData) ?? null;
      // Fade math is done in timeline-space: source duration must be scaled by
      // 1/speed before comparing with timeline duration so the clamp doesn't
      // chop fades short when speed < 1.
      const timelineDurationS = ticksToSecondsClamped(Number(durationUs));
      const sourceTimelineDurationS = ticksToSecondsClamped(Number(sourceDurationUs)) / speed;
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

      const clipStartS = Math.max(0, ticksToSecondsClamped(Number(startUs)));
      const rawOffsetS = Math.max(0, ticksToSecondsClamped(Number(sourceStartUs)));

      const baseClipDurationS = Math.max(
        0,
        Math.min(
          ticksToSecondsClamped(Number(sourceDurationUs)) / speed,
          ticksToSecondsClamped(Number(durationUs)) || ticksToSecondsClamped(Number(sourceDurationUs)) / speed,
        ),
      );

      // Extend duration and adjust start for adjacent transitions (handles).
      let playDurationS = baseClipDurationS;
      let effectiveClipStartS = clipStartS;
      let effectiveOffsetS = rawOffsetS;

      const transitionOut = clipData.transitionOut ?? clipData.fastcat?.transitionOut;
      if (
        transitionOut?.durationUs &&
        Number(transitionOut.durationUs) > 0 &&
        transitionOut.mode === 'adjacent'
      ) {
        const outExtensionS = ticksToSecondsClamped(Number(transitionOut.durationUs));
        playDurationS += outExtensionS;
      }

      const transitionIn = clipData.transitionIn ?? clipData.fastcat?.transitionIn;
      if (
        transitionIn?.durationUs &&
        Number(transitionIn.durationUs) > 0 &&
        transitionIn.mode === 'adjacent'
      ) {
        const inExtensionS = ticksToSecondsClamped(Number(transitionIn.durationUs));
        playDurationS += inExtensionS;
        effectiveClipStartS = Math.max(0, clipStartS - inExtensionS);
        effectiveOffsetS = Math.max(0, effectiveOffsetS - inExtensionS * speed);
      }

      if (playDurationS <= 0) continue;

      const audioGain = normalizeGain(clipData.audioGain ?? clipData.fastcat?.audioGain, 1);
      const audioBalance = normalizeBalance(
        clipData.audioBalance ?? clipData.fastcat?.audioBalance,
        0,
      );
      const animations = clipData.animations ?? clipData.fastcat?.animations;

      const input = new Input({
        source: new BlobSource(governedBlobWorker(file)),
        formats: ALL_FORMATS,
      } as unknown);
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
        const sourceWindowBaseS = playDurationS * speed;
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
          audioGain,
          audioBalance,
          animations,
          audioFadeInS,
          audioFadeOutS,
          audioFadeInCurve: fadeInCurve,
          audioFadeOutCurve: fadeOutCurve,
          audioEffects: (clipData.effects ?? []).filter((effect) => effect?.target === 'audio'),
        });
      } catch (err) {
        log.error('[Worker Export] Failed to decode audio clip:', err);
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
      masterAudioEffects,
      onProgress,
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

    // Master effects must run continuously across the whole render, so they are
    // applied over large overlapping blocks instead of per output chunk. Without
    // a streamer the dry mix is emitted chunk-by-chunk as before.
    const masterStreamer =
      masterAudioEffects && masterAudioEffects.length > 0
        ? new MasterEffectStreamer({
            channels: numberOfChannels,
            sampleRate,
            effects: masterAudioEffects,
            emitChunkFrames: chunkFrames,
          })
        : null;

    // Final-stage emit: hard-clip to [-1, 1], count clipped frames once per
    // frame (even for stereo), planar-pack and hand the sample to the encoder.
    const emitInterleavedChunk = async (
      interleaved: Float32Array,
      frames: number,
      startFrame: number,
    ): Promise<void> => {
      const len = interleaved.length;
      for (let frame = 0; frame < frames; frame += 1) {
        let clippedFrame = false;
        for (let channel = 0; channel < numberOfChannels; channel += 1) {
          const index = frame * numberOfChannels + channel;
          if (index >= len) continue;
          const v = interleaved[index] ?? 0;
          const clamped = clampFloat32(v);
          if (v !== clamped) clippedFrame = true;
          interleaved[index] = clamped;
        }
        if (clippedFrame) clippedFrames += 1;
      }

      const planar = interleavedToPlanar({ interleaved, frames, numberOfChannels });
      const audioSample = new AudioSample({
        data: planar,
        format: 'f32-planar',
        numberOfChannels,
        sampleRate,
        timestamp: startFrame / sampleRate,
      });
      try {
        await (audioSource as { add: (sample: unknown) => Promise<void> }).add(audioSample);
      } finally {
        safeDispose(audioSample);
      }
    };

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
                numberOfChannels,
              });
              if (nextCursorFrame <= sourceCursorFrame) break;
              sourceCursorFrame = nextCursorFrame;
            }
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err;
            log.error('[Worker Export] Failed to decode audio clip segment:', err);
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

        // Evict clips fully consumed by the end of this chunk before emitting,
        // so finished generators are released and not re-scanned next chunk.
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

        // Master effects (if any) run continuously across overlapping blocks and
        // emit on their own cadence; otherwise emit the dry chunk straight away.
        if (masterStreamer) {
          for (const emitted of await masterStreamer.push(mixedInterleaved, framesInChunk)) {
            await emitInterleavedChunk(emitted.interleaved, emitted.frames, emitted.startFrame);
          }
        } else {
          await emitInterleavedChunk(mixedInterleaved, framesInChunk, chunkStartFrame);
        }

        onProgress?.((chunkIndex + 1) / totalChunks);
      }

      if (masterStreamer) {
        for (const emitted of await masterStreamer.flush()) {
          await emitInterleavedChunk(emitted.interleaved, emitted.frames, emitted.startFrame);
        }
      }

      onProgress?.(1);

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
