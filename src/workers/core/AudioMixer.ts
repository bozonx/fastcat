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
    globalThis.OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext;
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
    globalThis.OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext;
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
    AudioSampleSink: new (...args: any[]) => MediabunnyAudioSampleSink;
    Input: new (...args: any[]) => MediabunnyInput;
    BlobSource: new (...args: any[]) => unknown;
    ALL_FORMATS: any;
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

interface ProcessedClipAudio {
  planes: Float32Array[];
  frames: number;
  gainEnvelope: Float32Array;
  audioBalance: number;
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
      (abortErr as any).name = 'AbortError';
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
      } else if ((sr !== sourceSampleRate || ch !== sourceChannels) && !warnedRateChange) {
        warnedRateChange = true;
        await reportExportWarning(
          '[Worker Export] Audio clip changed sample rate or channel count mid-stream; using initial format.',
        );
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

/**
 * Processes a single clip end-to-end: load -> normalize channels -> reverse ->
 * resample with time-stretch -> apply effects -> trim/pad to expected length ->
 * pre-compute gain envelope. Stateful effects (reverb, delay, compressors) and
 * resampling now see the whole clip in one pass, eliminating the per-sample
 * artefacts of the previous chunk-wise design.
 */
async function processClipAudio(args: {
  clip: PreparedClip;
  targetSampleRate: number;
  numberOfChannels: number;
  reportExportWarning: (message: string) => Promise<void>;
  checkCancel?: () => boolean;
}): Promise<ProcessedClipAudio | null> {
  const { clip, targetSampleRate, numberOfChannels, reportExportWarning, checkCancel } = args;
  // Defense in depth: prepareClips already skips reversed clips. This guard
  // keeps writeMixedToSource correct for any caller that hands in prepared
  // clips directly (tests, future re-entry).
  if (clip.reversed) return null;
  const expectedOutFrames = Math.max(0, Math.round(clip.playDurationS * targetSampleRate));
  if (expectedOutFrames <= 0) return null;

  const sourceWindowDurationS = clip.playDurationS * clip.speed;
  const sinkStartS = Math.max(0, clip.offsetS);
  const sinkEndS = Math.max(sinkStartS, sinkStartS + sourceWindowDurationS);

  const loaded = await loadClipSourcePlanes({
    sink: clip.sink,
    sinkStartS,
    sinkEndS,
    checkCancel,
    reportExportWarning,
  });
  if (!loaded) return null;

  let planes = normalizeSampleChannels({
    planes: loaded.planes,
    sourceChannels: loaded.channels,
    targetChannels: numberOfChannels,
    frames: loaded.frames,
  });
  let frames = loaded.frames;

  if (clip.reversed) {
    for (let c = 0; c < planes.length; c += 1) {
      const plane = planes[c];
      if (plane) plane.reverse();
    }
  }

  const needsResample = loaded.sampleRate !== targetSampleRate;
  const needsStretch = clip.speed !== 1;
  if (needsResample || needsStretch) {
    try {
      planes = await resampleAndStretchOffline({
        planes,
        sourceSampleRate: loaded.sampleRate,
        sourceFrames: frames,
        targetSampleRate,
        targetFrames: expectedOutFrames,
        channels: numberOfChannels,
        playbackRate: clip.speed,
      });
      frames = planes[0]?.length ?? expectedOutFrames;
    } catch (err) {
      // Falling back to the source-rate planes would mix pitch-shifted audio
      // into the output (the downstream loop assumes targetSampleRate). Prefer
      // a silent clip — the export still completes and the user is warned.
      await reportExportWarning(
        '[Worker Export] Failed to resample audio clip; substituting silence.',
      );
      planes = Array.from({ length: numberOfChannels }, () => new Float32Array(expectedOutFrames));
      frames = expectedOutFrames;
    }
  }

  if (clip.audioEffects.length > 0) {
    const processed = await applyAudioEffectsOffline({
      planes,
      sampleRate: targetSampleRate,
      frames,
      channels: numberOfChannels,
      effects: clip.audioEffects,
    });
    planes = processed.planes;
    frames = processed.frames;
  }

  // Defensive trim/pad to the timeline-expected length to avoid any drift from
  // resampler rounding or an effect that changes block length.
  if (frames !== expectedOutFrames) {
    const fixed: Float32Array[] = [];
    for (let c = 0; c < numberOfChannels; c += 1) {
      const plane = planes[c] ?? new Float32Array(frames);
      if (plane.length === expectedOutFrames) {
        fixed.push(plane);
        continue;
      }
      const next = new Float32Array(expectedOutFrames);
      const copyLen = Math.min(plane.length, expectedOutFrames);
      next.set(plane.subarray(0, copyLen), 0);
      fixed.push(next);
    }
    planes = fixed;
    frames = expectedOutFrames;
  }

  const gainEnvelope = new Float32Array(frames);
  if (clip.audioFadeInS === 0 && clip.audioFadeOutS === 0) {
    gainEnvelope.fill(clip.audioGain);
  } else {
    gainEnvelope.fill(clip.audioGain);

    const applyEnvelopeRange = (startFrame: number, endFrame: number) => {
      const start = Math.max(0, Math.min(frames, startFrame));
      const end = Math.max(start, Math.min(frames, endFrame));
      for (let i = start; i < end; i += 1) {
        gainEnvelope[i] = getGainAtClipTime({
          clipDurationS: clip.playDurationS,
          fadeInS: clip.audioFadeInS,
          fadeOutS: clip.audioFadeOutS,
          fadeInCurve: clip.audioFadeInCurve,
          fadeOutCurve: clip.audioFadeOutCurve,
          baseGain: clip.audioGain,
          tClipS: i / targetSampleRate,
        });
      }
    };

    if (clip.audioFadeInS > 0) {
      applyEnvelopeRange(0, Math.ceil(clip.audioFadeInS * targetSampleRate));
    }

    if (clip.audioFadeOutS > 0) {
      const fadeOutStartS = Math.max(0, clip.playDurationS - clip.audioFadeOutS);
      applyEnvelopeRange(
        Math.floor(fadeOutStartS * targetSampleRate),
        Math.ceil(clip.playDurationS * targetSampleRate),
      );
    }

    const clipEndFrame = Math.max(
      0,
      Math.min(frames, Math.ceil(clip.playDurationS * targetSampleRate)),
    );
    if (clipEndFrame < frames) {
      gainEnvelope.fill(0, clipEndFrame);
    }

    if (clip.audioFadeInS > 0 && clip.audioFadeInS >= clip.playDurationS) {
      for (let i = 0; i < frames; i += 1) {
        gainEnvelope[i] = getGainAtClipTime({
          clipDurationS: clip.playDurationS,
          fadeInS: clip.audioFadeInS,
          fadeOutS: clip.audioFadeOutS,
          fadeInCurve: clip.audioFadeInCurve,
          fadeOutCurve: clip.audioFadeOutCurve,
          baseGain: clip.audioGain,
          tClipS: i / targetSampleRate,
        });
      }
    } else if (clip.audioFadeOutS > 0 && clip.audioFadeOutS >= clip.playDurationS) {
      for (let i = 0; i < frames; i += 1) {
        gainEnvelope[i] = getGainAtClipTime({
          clipDurationS: clip.playDurationS,
          fadeInS: clip.audioFadeInS,
          fadeOutS: clip.audioFadeOutS,
          fadeInCurve: clip.audioFadeInCurve,
          fadeOutCurve: clip.audioFadeOutCurve,
          baseGain: clip.audioGain,
          tClipS: i / targetSampleRate,
        });
      }
    }
  }

  return { planes, frames, gainEnvelope, audioBalance: clip.audioBalance };
}

interface AdjacencyMap {
  prev: Map<AudioClipData, AudioClipData | null>;
  next: Map<AudioClipData, AudioClipData | null>;
}

function buildAdjacencyMap(audioClips: AudioClipData[]): AdjacencyMap {
  const byTrack = new Map<unknown, AudioClipData[]>();
  for (const clip of audioClips) {
    const trackId = (clip as any).trackId;
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

export class AudioMixer {
  static async prepareClips(params: AudioMixerPrepareParams): Promise<PreparedClip[]> {
    const { audioClips, hostClient, reportExportWarning, checkCancel } = params;
    const { AudioSampleSink, Input, BlobSource, ALL_FORMATS } = params.mediabunny;

    const adjacency = buildAdjacencyMap(audioClips);
    const prepared: PreparedClip[] = [];

    for (const clipData of audioClips) {
      if (checkCancel?.()) {
        const abortErr = new Error('Export was cancelled');
        (abortErr as any).name = 'AbortError';
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
        file = (await hostClient?.getFileByPath?.(sourcePath)) ?? (await fileHandle.getFile());
      } catch {
        await reportExportWarning('[Worker Export] Failed to read audio file handle');
        continue;
      }

      const startUs = clipData.startUs ?? clipData.timelineRange?.startUs ?? 0;
      const sourceStartUs = clipData.sourceStartUs ?? clipData.sourceRange?.startUs ?? 0;
      const sourceDurationUs = clipData.sourceDurationUs ?? clipData.sourceRange?.durationUs ?? 0;
      const durationUs = clipData.durationUs ?? clipData.timelineRange?.durationUs ?? 0;

      const speedRaw = Number((clipData as any).speed);
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

      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS } as any);
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
        const trackDurationS = (aTrack as any).duration;
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
      (abortErr as any).name = 'AbortError';
      throw abortErr;
    }

    const sortedClips = prepared.slice().sort((a, b) => a.clipStartS - b.clipStartS);
    const processedByClip = new Map<PreparedClip, ProcessedClipAudio | null>();
    let nextLoadIndex = 0;
    let clippedFrames = 0;

    const chunkFrames = Math.ceil(sampleRate * chunkDurationS);
    const totalFrames = Math.ceil(durationS * sampleRate);
    const totalChunks = Math.max(1, Math.ceil(totalFrames / chunkFrames));

    const mixedInterleavedPool = new Float32Array(chunkFrames * numberOfChannels);
    const planarOutPool = new Float32Array(chunkFrames * numberOfChannels);

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        ensureNotCancelled();

        const chunkStartS = chunkIndex * chunkDurationS;
        const chunkEndS = Math.min(durationS, chunkStartS + chunkDurationS);
        const framesInChunk = Math.min(chunkFrames, totalFrames - chunkIndex * chunkFrames);
        if (framesInChunk <= 0) continue;

        // Lazy-load any clips that start before the end of this chunk.
        while (nextLoadIndex < sortedClips.length) {
          const clip = sortedClips[nextLoadIndex]!;
          if (clip.clipStartS >= chunkEndS) break;
          ensureNotCancelled();
          try {
            const processed = await processClipAudio({
              clip,
              targetSampleRate: sampleRate,
              numberOfChannels,
              reportExportWarning,
              checkCancel,
            });
            processedByClip.set(clip, processed);
          } catch (err: any) {
            if (err?.name === 'AbortError') throw err;
            await reportExportWarning('[Worker Export] Failed to decode audio clip');
            safeDispose(clip.sink);
            safeDispose(clip.input);
            processedByClip.set(clip, null);
          }
          nextLoadIndex += 1;
        }

        const mixedInterleaved = mixedInterleavedPool.subarray(0, framesInChunk * numberOfChannels);
        mixedInterleaved.fill(0);

        for (const [clip, processed] of processedByClip) {
          if (!processed) continue;
          ensureNotCancelled();

          const clipGlobalStartS = clip.clipStartS;
          const clipGlobalEndS = clipGlobalStartS + clip.playDurationS;
          if (clipGlobalEndS <= chunkStartS) continue;
          if (clipGlobalStartS >= chunkEndS) continue;

          const overlapStartS = Math.max(chunkStartS, clipGlobalStartS);
          const overlapEndS = Math.min(chunkEndS, clipGlobalEndS);
          if (overlapEndS <= overlapStartS) continue;

          const writeStartFrame = Math.max(
            0,
            Math.floor((overlapStartS - chunkStartS) * sampleRate),
          );
          const sourceStartFrame = Math.max(
            0,
            Math.floor((overlapStartS - clipGlobalStartS) * sampleRate),
          );
          const sourceFramesAvailable = Math.max(0, processed.frames - sourceStartFrame);
          const writeFramesAvailable = Math.max(0, framesInChunk - writeStartFrame);
          const overlapEndFrame = Math.floor((overlapEndS - chunkStartS) * sampleRate);
          const framesInOverlap = Math.max(0, overlapEndFrame - writeStartFrame);
          const framesToWrite = Math.min(
            framesInOverlap,
            sourceFramesAvailable,
            writeFramesAvailable,
          );
          if (framesToWrite <= 0) continue;

          const { gainEnvelope } = processed;

          if (numberOfChannels === 2) {
            const planeL = processed.planes[0];
            const planeR = processed.planes[1];
            if (!planeL || !planeR) continue;
            const { ll, lr, rl, rr } = getStereoPanMatrix(processed.audioBalance);
            for (let i = 0; i < framesToWrite; i += 1) {
              const srcIdx = sourceStartFrame + i;
              const dstFrame = writeStartFrame + i;
              const g = gainEnvelope[srcIdx] ?? 0;
              if (g === 0) continue;
              const L = (planeL[srcIdx] ?? 0) * g;
              const R = (planeR[srcIdx] ?? 0) * g;
              const idxL = dstFrame * 2;
              // Sum all clip contributions first, clip once at chunk end so
              // that A=+1.5 followed by B=-1.0 still yields the correct 0.5.
              mixedInterleaved[idxL] = (mixedInterleaved[idxL] ?? 0) + (ll * L + lr * R);
              mixedInterleaved[idxL + 1] = (mixedInterleaved[idxL + 1] ?? 0) + (rl * L + rr * R);
            }
          } else {
            const plane = processed.planes[0];
            if (!plane) continue;
            for (let i = 0; i < framesToWrite; i += 1) {
              const srcIdx = sourceStartFrame + i;
              const dstFrame = writeStartFrame + i;
              const v = (plane[srcIdx] ?? 0) * (gainEnvelope[srcIdx] ?? 0);
              mixedInterleaved[dstFrame] = (mixedInterleaved[dstFrame] ?? 0) + v;
            }
          }
        }

        // Final clip pass — counts each clipped sample exactly once, regardless
        // of how many sources contributed to it.
        const mixLen = mixedInterleaved.length;
        for (let i = 0; i < mixLen; i += 1) {
          const v = mixedInterleaved[i] ?? 0;
          const clamped = clampFloat32(v);
          if (v !== clamped) clippedFrames += 1;
          mixedInterleaved[i] = clamped;
        }

        // Drop processed clips whose end is now behind the chunk to free memory.
        for (const [clip, processed] of processedByClip) {
          if (!processed) {
            processedByClip.delete(clip);
            continue;
          }
          if (clip.clipStartS + clip.playDurationS <= chunkEndS) {
            processedByClip.delete(clip);
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
          timestamp: chunkStartS,
        });

        try {
          await (audioSource as any).add(audioSample);
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
      for (const clip of prepared) {
        safeDispose(clip.sink);
        safeDispose(clip.input);
      }
    }
  }
}
