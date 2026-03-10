import { MAX_AUDIO_FILE_BYTES } from '../../utils/constants';
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
import { clampFloat32 } from './utils';
import { usToS } from './time';

export function interleavedToPlanar(params: {
  interleaved: Float32Array;
  frames: number;
  numberOfChannels: number;
}): Float32Array {
  const { interleaved, frames, numberOfChannels } = params;
  const planar = new Float32Array(frames * numberOfChannels);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < numberOfChannels; c += 1) {
      planar[c * frames + i] = interleaved[i * numberOfChannels + c] ?? 0;
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

export interface PreparedClip {
  clipStartS: number;
  offsetS: number;
  playDurationS: number;
  input: MediabunnyInput;
  sink: MediabunnyAudioSampleSink;
  sourcePath: string;
  audioGain: number;
  audioBalance: number;
  audioFadeInS: number;
  audioFadeOutS: number;
  audioFadeInCurve: AudioFadeCurve;
  audioFadeOutCurve: AudioFadeCurve;
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
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFadeInCurve?: AudioFadeCurve;
  audioFadeOutCurve?: AudioFadeCurve;
  audioDeclickDurationUs?: number;
  transitionIn?: AudioTransitionEnvelope | null;
  transitionOut?: AudioTransitionEnvelope | null;
  gran?: {
    audioGain?: number;
    audioBalance?: number;
    audioFadeInUs?: number;
    audioFadeOutUs?: number;
    audioFadeInCurve?: AudioFadeCurve;
    audioFadeOutCurve?: AudioFadeCurve;
    audioDeclickDurationUs?: number;
    transitionIn?: AudioTransitionEnvelope | null;
    transitionOut?: AudioTransitionEnvelope | null;
  };
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

export class AudioMixer {
  private static getAdjacentClips(audioClips: AudioClipData[], currentIndex: number) {
    const current = audioClips[currentIndex];
    if (!current) {
      return { previousClip: null, nextClip: null };
    }

    const currentTrackId = (current as any).trackId;
    const currentStartUs = Number(current.startUs ?? current.timelineRange?.startUs ?? 0);
    const sameTrack = audioClips
      .filter((candidate) => (candidate as any).trackId === currentTrackId)
      .slice()
      .sort(
        (a, b) =>
          Number(a.startUs ?? a.timelineRange?.startUs ?? 0) -
          Number(b.startUs ?? b.timelineRange?.startUs ?? 0),
      );

    const idx = sameTrack.findIndex(
      (candidate) =>
        Number(candidate.startUs ?? candidate.timelineRange?.startUs ?? 0) === currentStartUs,
    );

    return {
      previousClip: idx > 0 ? (sameTrack[idx - 1] ?? null) : null,
      nextClip: idx >= 0 ? (sameTrack[idx + 1] ?? null) : null,
    };
  }

  static async prepareClips(params: AudioMixerPrepareParams): Promise<PreparedClip[]> {
    const { audioClips, hostClient, reportExportWarning, checkCancel } = params;
    const { AudioSampleSink, Input, BlobSource, ALL_FORMATS } = params.mediabunny;

    const prepared: PreparedClip[] = [];

    for (const [clipIndex, clipData] of audioClips.entries()) {
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

      if (file.size > MAX_AUDIO_FILE_BYTES) {
        await reportExportWarning(
          '[Worker Export] Audio file is too large to decode in memory; skipping audio clip.',
        );
        continue;
      }

      const startUs = clipData.startUs ?? clipData.timelineRange?.startUs ?? 0;
      const sourceStartUs = clipData.sourceStartUs ?? clipData.sourceRange?.startUs ?? 0;
      const sourceDurationUs = clipData.sourceDurationUs ?? clipData.sourceRange?.durationUs ?? 0;
      const durationUs = clipData.durationUs ?? clipData.timelineRange?.durationUs ?? 0;

      const { previousClip, nextClip } = AudioMixer.getAdjacentClips(audioClips, clipIndex);
      const {
        fadeInS: audioFadeInS,
        fadeOutS: audioFadeOutS,
        fadeInCurve,
        fadeOutCurve,
      } = resolveEffectiveFadeDurationsSeconds({
        clipDurationS: Math.max(
          0,
          Math.min(
            usToS(Number(sourceDurationUs)),
            usToS(Number(durationUs)) || usToS(Number(sourceDurationUs)),
          ),
        ),
        clip: {
          audioFadeInUs: clipData.audioFadeInUs ?? clipData.gran?.audioFadeInUs,
          audioFadeOutUs: clipData.audioFadeOutUs ?? clipData.gran?.audioFadeOutUs,
          audioFadeInCurve: clipData.audioFadeInCurve ?? clipData.gran?.audioFadeInCurve,
          audioFadeOutCurve: clipData.audioFadeOutCurve ?? clipData.gran?.audioFadeOutCurve,
          audioDeclickDurationUs:
            clipData.audioDeclickDurationUs ?? clipData.gran?.audioDeclickDurationUs,
          transitionIn: clipData.transitionIn ?? clipData.gran?.transitionIn,
          transitionOut: clipData.transitionOut ?? clipData.gran?.transitionOut,
        },
        previousClip,
        nextClip,
      });

      const clipStartS = Math.max(0, usToS(Number(startUs)));
      const rawOffsetS = Math.max(0, usToS(Number(sourceStartUs)));
      const clipDurationS = Math.max(
        0,
        Math.min(
          usToS(Number(sourceDurationUs)),
          usToS(Number(durationUs)) || usToS(Number(sourceDurationUs)),
        ),
      );
      if (clipDurationS <= 0) continue;

      const audioGain = normalizeGain(clipData.audioGain ?? clipData.gran?.audioGain, 1);
      const audioBalance = normalizeBalance(
        clipData.audioBalance ?? clipData.gran?.audioBalance,
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

        const offsetS = Math.max(0, rawOffsetS);
        const trackDurationS = (aTrack as any).duration;
        const maxPlayableS = Math.max(
          0,
          (Number.isFinite(trackDurationS) ? Number(trackDurationS) : Number.POSITIVE_INFINITY) -
            offsetS,
        );
        const playDurationS = Math.min(clipDurationS, maxPlayableS);
        if (playDurationS <= 0) {
          safeDispose(sink);
          safeDispose(input);
          continue;
        }

        prepared.push({
          clipStartS,
          offsetS,
          playDurationS,
          input,
          sink,
          sourcePath,
          audioGain,
          audioBalance,
          audioFadeInS,
          audioFadeOutS,
          audioFadeInCurve: fadeInCurve,
          audioFadeOutCurve: fadeOutCurve,
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

    const chunkFrames = sampleRate * chunkDurationS;
    const totalFrames = Math.ceil(durationS * sampleRate);
    const totalChunks = Math.max(1, Math.ceil(totalFrames / chunkFrames));

    function ensureNotCancelled() {
      if (!checkCancel?.()) return;
      const abortErr = new Error('Export was cancelled');
      (abortErr as any).name = 'AbortError';
      throw abortErr;
    }

    async function mixClipIntoChunk(args: {
      clip: PreparedClip;
      chunkStartS: number;
      chunkEndS: number;
      framesInChunk: number;
      mixedInterleaved: Float32Array;
    }) {
      const { clip, chunkStartS, chunkEndS, framesInChunk, mixedInterleaved } = args;

      const fadeInS = clip.audioFadeInS;
      const fadeOutS = clip.audioFadeOutS;
      const fadeInCurve = clip.audioFadeInCurve;
      const fadeOutCurve = clip.audioFadeOutCurve;

      const audioGain = clip.audioGain;
      const audioBalance = clip.audioBalance;

      const hasStereoPan = numberOfChannels === 2;
      const leftScale = hasStereoPan ? Math.max(0, Math.min(1, 1 - Math.max(0, audioBalance))) : 1;
      const rightScale = hasStereoPan ? Math.max(0, Math.min(1, 1 + Math.min(0, audioBalance))) : 1;

      function gainAtClipTimeS(tClipS: number): number {
        return getGainAtClipTime({
          clipDurationS: clip.playDurationS,
          fadeInS,
          fadeOutS,
          fadeInCurve,
          fadeOutCurve,
          baseGain: audioGain,
          tClipS,
        });
      }

      const clipGlobalStartS = clip.clipStartS;
      const clipGlobalEndS = clip.clipStartS + clip.playDurationS;
      const overlapStartS = Math.max(chunkStartS, clipGlobalStartS);
      const overlapEndS = Math.min(chunkEndS, clipGlobalEndS);
      if (overlapEndS <= overlapStartS) return;

      const clipLocalStartS = overlapStartS - clipGlobalStartS;
      const clipLocalEndS = overlapEndS - clipGlobalStartS;
      const sinkStartS = clip.offsetS + clipLocalStartS;
      const sinkEndS = clip.offsetS + clipLocalEndS;

      try {
        for await (const sampleRaw of clip.sink.samples(sinkStartS, sinkEndS)) {
          ensureNotCancelled();

          const sample = sampleRaw as MediabunnyAudioSample;
          try {
            const frames = Number(sample.numberOfFrames) || 0;
            const sr = Number(sample.sampleRate) || 0;
            const ch = Number(sample.numberOfChannels) || 0;

            if (frames <= 0) continue;
            if (sr <= 0 || ch <= 0) {
              await reportExportWarning(
                '[Worker Export] Audio clip sample format is invalid; skipping some audio.',
              );
              continue;
            }

            const timelineTimeS = clip.clipStartS + (Number(sample.timestamp) - clip.offsetS);
            if (!Number.isFinite(timelineTimeS)) continue;

            const startFrameGlobal = Math.floor(timelineTimeS * sampleRate);
            const startFrameInChunkGlobal = Math.floor(chunkStartS * sampleRate);
            const writeOffsetFrames = startFrameGlobal - startFrameInChunkGlobal;
            if (writeOffsetFrames >= framesInChunk) continue;

            const sourcePlanes: Float32Array[] = [];
            for (let planeIndex = 0; planeIndex < ch; planeIndex += 1) {
              const bytesNeeded = sample.allocationSize({
                format: 'f32-planar',
                planeIndex,
              });
              const plane = new Float32Array(bytesNeeded / 4);
              sample.copyTo(plane, { format: 'f32-planar', planeIndex });
              sourcePlanes.push(plane);
            }

            let normalizedPlanes = normalizeSampleChannels({
              planes: sourcePlanes,
              sourceChannels: ch,
              targetChannels: numberOfChannels,
              frames,
            });
            let normalizedFrames = frames;

            if (sr !== sampleRate) {
              normalizedFrames = Math.max(1, Math.round((frames * sampleRate) / sr));
              normalizedPlanes = await resampleChannelsOfflineAudioContext({
                planes: normalizedPlanes,
                sourceSampleRate: sr,
                targetSampleRate: sampleRate,
                sourceFrames: frames,
                targetFrames: normalizedFrames,
                channels: numberOfChannels,
              });
            } else if (ch !== numberOfChannels) {
              await reportExportWarning(
                '[Worker Export] Audio clip channel mismatch; normalizing channel layout.',
              );
            }

            for (let i = 0; i < normalizedFrames; i += 1) {
              const dstFrame = writeOffsetFrames + i;
              if (dstFrame < 0) continue;
              if (dstFrame >= framesInChunk) break;

              const tClipS = timelineTimeS + i / sampleRate - clip.clipStartS;
              const gain = gainAtClipTimeS(tClipS);

              for (let c = 0; c < numberOfChannels; c += 1) {
                const plane = normalizedPlanes[c];
                const panScale =
                  hasStereoPan && c === 0 ? leftScale : hasStereoPan && c === 1 ? rightScale : 1;
                const v = (plane ? (plane[i] ?? 0) : 0) * gain * panScale;
                const idx = dstFrame * numberOfChannels + c;
                mixedInterleaved[idx] = clampFloat32(mixedInterleaved[idx]! + v);
              }
            }
          } finally {
            safeDispose(sample);
          }
        }
      } catch (err) {
        await reportExportWarning('[Worker Export] Failed to decode audio clip');
      }
    }

    try {
      const maxFramesInChunk = Math.ceil(sampleRate * chunkDurationS);
      const mixedInterleavedPool = new Float32Array(maxFramesInChunk * numberOfChannels);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        ensureNotCancelled();

        const chunkStartS = chunkIndex * chunkDurationS;
        const chunkEndS = Math.min(durationS, chunkStartS + chunkDurationS);
        const framesInChunk = Math.min(chunkFrames, totalFrames - chunkIndex * chunkFrames);
        if (framesInChunk <= 0) continue;

        const mixedInterleaved = mixedInterleavedPool.subarray(0, framesInChunk * numberOfChannels);
        mixedInterleaved.fill(0);

        for (const clip of prepared) {
          ensureNotCancelled();
          await mixClipIntoChunk({ clip, chunkStartS, chunkEndS, framesInChunk, mixedInterleaved });
        }

        const planar = interleavedToPlanar({
          interleaved: mixedInterleaved,
          frames: framesInChunk,
          numberOfChannels,
        });

        const audioSample = new AudioSample({
          data: planar,
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
    } finally {
      for (const clip of prepared) {
        safeDispose(clip.sink);
        safeDispose(clip.input);
      }
    }
  }
}
