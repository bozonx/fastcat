import { MAX_AUDIO_FILE_BYTES } from '../../utils/constants';
import { safeDispose } from '../../utils/video-editor/utils';
import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
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

export interface PreparedClip {
  clipStartS: number;
  offsetS: number;
  playDurationS: number;
  input: any;
  sink: any;
  sourcePath: string;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInS?: number;
  audioFadeOutS?: number;
}

export interface AudioMixerPrepareParams {
  audioClips: any[];
  hostClient: VideoCoreHostAPI | null;
  reportExportWarning: (message: string) => Promise<void>;
  checkCancel?: () => boolean;
  mediabunny: {
    AudioSampleSink: any;
    Input: any;
    BlobSource: any;
    ALL_FORMATS: any;
  };
}

export interface AudioMixerWriteParams {
  prepared: PreparedClip[];
  durationS: number;
  audioSource: any;
  chunkDurationS: number;
  sampleRate: number;
  numberOfChannels: number;
  reportExportWarning: (message: string) => Promise<void>;
  checkCancel?: () => boolean;
  AudioSample: any;
}

export class AudioMixer {
  static async prepareClips(params: AudioMixerPrepareParams): Promise<PreparedClip[]> {
    const { audioClips, hostClient, reportExportWarning, checkCancel } = params;
    const { AudioSampleSink, Input, BlobSource, ALL_FORMATS } = params.mediabunny;

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
        file = await fileHandle.getFile();
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

      const audioFadeInUs = clipData.audioFadeInUs ?? clipData.gran?.audioFadeInUs ?? 0;
      const audioFadeOutUs = clipData.audioFadeOutUs ?? clipData.gran?.audioFadeOutUs ?? 0;
      const audioGainRaw = clipData.audioGain ?? clipData.gran?.audioGain ?? 1;
      const audioBalanceRaw = clipData.audioBalance ?? clipData.gran?.audioBalance ?? 0;

      const clipStartS = Math.max(0, usToS(Number(startUs)));
      const rawOffsetS = Math.max(0, usToS(Number(sourceStartUs)));
      const sourceDurationS = Math.max(0, usToS(Number(sourceDurationUs)));
      const timelineDurationS = Math.max(0, usToS(Number(durationUs)));
      const clipDurationS = Math.max(
        0,
        Math.min(sourceDurationS || Number.POSITIVE_INFINITY, timelineDurationS || sourceDurationS),
      );
      if (clipDurationS <= 0) continue;

      const audioFadeInS = Math.min(clipDurationS, Math.max(0, usToS(Number(audioFadeInUs) || 0)));
      const audioFadeOutS = Math.min(
        clipDurationS,
        Math.max(0, usToS(Number(audioFadeOutUs) || 0)),
      );
      const audioGain =
        typeof audioGainRaw === 'number' && Number.isFinite(audioGainRaw)
          ? Math.max(0, Math.min(10, Number(audioGainRaw)))
          : 1;

      const audioBalance =
        typeof audioBalanceRaw === 'number' && Number.isFinite(audioBalanceRaw)
          ? Math.max(-1, Math.min(1, Number(audioBalanceRaw)))
          : 0;

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

      const fadeInS =
        typeof clip.audioFadeInS === 'number' && Number.isFinite(clip.audioFadeInS)
          ? Math.max(0, clip.audioFadeInS)
          : 0;
      const fadeOutS =
        typeof clip.audioFadeOutS === 'number' && Number.isFinite(clip.audioFadeOutS)
          ? Math.max(0, clip.audioFadeOutS)
          : 0;

      const audioGain =
        typeof clip.audioGain === 'number' && Number.isFinite(clip.audioGain)
          ? Math.max(0, Math.min(10, clip.audioGain))
          : 1;

      const audioBalance =
        typeof clip.audioBalance === 'number' && Number.isFinite(clip.audioBalance)
          ? Math.max(-1, Math.min(1, clip.audioBalance))
          : 0;

      const hasStereoPan = numberOfChannels === 2;
      const leftScale = hasStereoPan ? Math.max(0, Math.min(1, 1 - Math.max(0, audioBalance))) : 1;
      const rightScale = hasStereoPan ? Math.max(0, Math.min(1, 1 + Math.min(0, audioBalance))) : 1;

      function gainAtClipTimeS(tClipS: number): number {
        const t = Math.max(0, Math.min(clip.playDurationS, tClipS));
        let g = audioGain;
        if (fadeInS > 0 && t < fadeInS) {
          g *= t / fadeInS;
        }
        if (fadeOutS > 0 && t > clip.playDurationS - fadeOutS) {
          g *= (clip.playDurationS - t) / fadeOutS;
        }
        return Math.max(0, Math.min(10, g));
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
        for await (const sampleRaw of (clip.sink as any).samples(sinkStartS, sinkEndS)) {
          ensureNotCancelled();

          const sample = sampleRaw as any;
          try {
            const frames = Number(sample.numberOfFrames) || 0;
            const sr = Number(sample.sampleRate) || 0;
            const ch = Number(sample.numberOfChannels) || 0;

            if (frames <= 0) continue;
            if (sr !== sampleRate || ch !== numberOfChannels) {
              await reportExportWarning(
                '[Worker Export] Audio clip sample format mismatch; skipping some audio.',
              );
              continue;
            }

            const timelineTimeS = clip.clipStartS + (Number(sample.timestamp) - clip.offsetS);
            if (!Number.isFinite(timelineTimeS)) continue;

            const startFrameGlobal = Math.floor(timelineTimeS * sampleRate);
            const startFrameInChunkGlobal = Math.floor(chunkStartS * sampleRate);
            const writeOffsetFrames = startFrameGlobal - startFrameInChunkGlobal;
            if (writeOffsetFrames >= framesInChunk) continue;

            const tmpPlanes: Float32Array[] = [];
            for (let planeIndex = 0; planeIndex < numberOfChannels; planeIndex += 1) {
              const bytesNeeded = sample.allocationSize({
                format: 'f32-planar',
                planeIndex,
              });
              const plane = new Float32Array(bytesNeeded / 4);
              sample.copyTo(plane, { format: 'f32-planar', planeIndex });
              tmpPlanes.push(plane);
            }

            for (let i = 0; i < frames; i += 1) {
              const dstFrame = writeOffsetFrames + i;
              if (dstFrame < 0) continue;
              if (dstFrame >= framesInChunk) break;

              const tClipS = timelineTimeS + i / sampleRate - clip.clipStartS;
              const gain = gainAtClipTimeS(tClipS);

              for (let c = 0; c < numberOfChannels; c += 1) {
                const plane = tmpPlanes[c];
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
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        ensureNotCancelled();

        const chunkStartS = chunkIndex * chunkDurationS;
        const chunkEndS = Math.min(durationS, chunkStartS + chunkDurationS);
        const framesInChunk = Math.min(chunkFrames, totalFrames - chunkIndex * chunkFrames);
        if (framesInChunk <= 0) continue;

        const mixedInterleaved = new Float32Array(framesInChunk * numberOfChannels);

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
