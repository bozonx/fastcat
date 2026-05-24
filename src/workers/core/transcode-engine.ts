import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import type { ExportOptions } from '~/composables/timeline/export/types';

export interface ReversibleAudioSample {
  data: Float32Array;
  frameCount: number;
  numberOfChannels: number;
  sampleRate: number;
}

export function createReversedAudioSamples(
  AudioSample: new (...args: any[]) => unknown,
  samples: ReversibleAudioSample[],
): unknown[] {
  const firstSample = samples[0];
  if (!firstSample) {
    return [];
  }

  const totalFrames = samples.reduce((sum, sample) => sum + sample.frameCount, 0);
  const reversedData = new Float32Array(totalFrames * firstSample.numberOfChannels);
  let writeFrameOffset = 0;

  for (const sample of [...samples].reverse()) {
    const currentSample = sample!;

    for (let frameIndex = currentSample.frameCount - 1; frameIndex >= 0; frameIndex -= 1) {
      const sourceOffset = frameIndex * currentSample.numberOfChannels;
      const targetOffset = writeFrameOffset * currentSample.numberOfChannels;

      for (
        let channelIndex = 0;
        channelIndex < currentSample.numberOfChannels;
        channelIndex += 1
      ) {
        reversedData[targetOffset + channelIndex] =
          currentSample.data[sourceOffset + channelIndex] ?? 0;
      }

      writeFrameOffset += 1;
    }
  }

  const chunkFrameCounts = samples.map((sample) => sample.frameCount).reverse();
  const reversedSamples: unknown[] = [];
  let readFrameOffset = 0;
  let timestamp = 0;

  for (const chunkFrameCount of chunkFrameCounts) {
    const chunkData = reversedData.slice(
      readFrameOffset * firstSample.numberOfChannels,
      (readFrameOffset + chunkFrameCount) * firstSample.numberOfChannels,
    );

    reversedSamples.push(
      new AudioSample({
        data: chunkData,
        format: 'f32',
        numberOfChannels: firstSample.numberOfChannels,
        sampleRate: firstSample.sampleRate,
        timestamp,
      }),
    );

    readFrameOffset += chunkFrameCount;
    timestamp += chunkFrameCount / firstSample.sampleRate;
  }

  return reversedSamples;
}

export interface AudioProcessSample {
  timestamp: number;
  duration: number;
  numberOfFrames: number;
  numberOfChannels: number;
  sampleRate: number;
  allocationSize: (options: { planeIndex: number; format: 'f32' }) => number;
  copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32' }) => void;
}

export function createAudioProcessConfig(
  options: ExportOptions,
  AudioSample: new (...args: any[]) => unknown,
) {
  if (
    !options.audioReverse ||
    options.videoCodec !== 'none' ||
    !options.audioDurationSec ||
    options.audioDurationSec <= 0
  ) {
    return {};
  }

  const bufferedSamples: ReversibleAudioSample[] = [];
  let hasEmitted = false;
  const audioDurationSec = options.audioDurationSec as number;

  return {
    forceTranscode: true,
    process(sample: AudioProcessSample) {
      const copyOptions = { planeIndex: 0, format: 'f32' as const };
      const data = new Float32Array(sample.allocationSize(copyOptions) / 4);
      sample.copyTo(data, copyOptions);

      bufferedSamples.push({
        data,
        frameCount: sample.numberOfFrames,
        numberOfChannels: sample.numberOfChannels,
        sampleRate: sample.sampleRate,
      });

      const sampleEndTime = sample.timestamp + sample.duration;
      const isLastSample = sampleEndTime >= audioDurationSec - sample.duration / 2;

      if (!isLastSample || hasEmitted) {
        return null;
      }

      hasEmitted = true;

      return createReversedAudioSamples(AudioSample, bufferedSamples);
    },
  };
}

export function ensureNotCancelled(checkCancel: () => boolean): void {
  if (!checkCancel()) return;
  const abortErr = new Error('Export was cancelled');
  abortErr.name = 'AbortError';
  throw abortErr;
}

export async function notifyPhase(
  hostClient: VideoCoreHostAPI | null,
  phase: 'encoding' | 'saving',
  taskId?: string,
): Promise<void> {
  if (!hostClient) return;
  try {
    await hostClient.onExportPhase?.(phase, taskId);
  } catch {
    // ignore
  }
}
