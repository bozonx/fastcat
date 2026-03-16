import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import type { ExportOptions } from '~/composables/timeline/export/types';
import { getBunnyVideoCodec, getBunnyAudioCodec } from './utils';

export async function runTranscode(
  sourceFile: File | FileSystemFileHandle,
  targetHandle: FileSystemFileHandle,
  options: ExportOptions,
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (msg: string, taskId?: string) => Promise<void>,
  checkCancel: () => boolean,
  taskId?: string,
) {
  const {
    Output,
    Mp4OutputFormat,
    WebMOutputFormat,
    MkvOutputFormat,
    StreamTarget,
    Input,
    BlobSource,
    Conversion,
    ALL_FORMATS,
    getFirstEncodableVideoCodec,
    getFirstEncodableAudioCodec,
    AudioSample,
  } = await import('mediabunny');

  function createReversedAudioSamples(
    samples: Array<{
      data: Float32Array;
      frameCount: number;
      numberOfChannels: number;
      sampleRate: number;
    }>,
  ) {
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
    const reversedSamples: InstanceType<typeof AudioSample>[] = [];
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

  function createAudioProcessConfig() {
    if (
      !options.audioReverse ||
      options.videoCodec !== 'none' ||
      !options.audioDurationSec ||
      options.audioDurationSec <= 0
    ) {
      return {};
    }

    const bufferedSamples: Array<{
      data: Float32Array;
      frameCount: number;
      numberOfChannels: number;
      sampleRate: number;
    }> = [];
    let hasEmitted = false;
    const audioDurationSec = options.audioDurationSec as number;

    return {
      forceTranscode: true,
      process(sample: {
        timestamp: number;
        duration: number;
        numberOfFrames: number;
        numberOfChannels: number;
        sampleRate: number;
        allocationSize: (options: { planeIndex: number; format: 'f32' }) => number;
        copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32' }) => void;
      }) {
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

        return createReversedAudioSamples(bufferedSamples);
      },
    };
  }

  function ensureNotCancelled() {
    if (!checkCancel()) return;
    const abortErr = new Error('Export was cancelled');
    (abortErr as any).name = 'AbortError';
    throw abortErr;
  }

  async function notifyPhase(phase: string, taskId?: string) {
    if (!hostClient) return;
    try {
      await (hostClient as any).onExportPhase?.(phase, taskId);
    } catch {
      // ignore
    }
  }

  // 1. Setup Input
  const source =
    sourceFile instanceof File
      ? new BlobSource(sourceFile)
      : new BlobSource(await sourceFile.getFile());
  const input = new Input({ source, formats: ALL_FORMATS } as any);

  // 2. Setup Output
  const format =
    options.format === 'webm'
      ? new WebMOutputFormat()
      : options.format === 'mkv'
        ? new MkvOutputFormat()
        : new Mp4OutputFormat();

  const writable = await (targetHandle as any).createWritable({ keepExistingData: false });
  const target = new StreamTarget(writable, {
    chunked: true,
    chunkSize: 16 * 1024 * 1024,
  });
  const output = new Output({ target, format });

  let conversionProcess: any = null;
  let outputCancelled = false;

  async function safeCancelOutput() {
    if (outputCancelled) return;
    outputCancelled = true;

    try {
      if (typeof (output as any).cancel === 'function') {
        await (output as any).cancel();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already been canceled')) {
        throw error;
      }
    }
  }

  try {
    const sourceVideoTrack =
      options.videoCodec === 'none' ? null : await input.getPrimaryVideoTrack().catch(() => null);
    const sourceAudioTrack = options.audio
      ? await input.getPrimaryAudioTrack().catch(() => null)
      : null;

    const sourceDecoderConfig =
      sourceVideoTrack && typeof sourceVideoTrack.getDecoderConfig === 'function'
        ? await sourceVideoTrack.getDecoderConfig().catch(() => null)
        : null;
    const sourceDecoderConfigAny = sourceDecoderConfig as {
      codedWidth?: number;
      codedHeight?: number;
      displayWidth?: number;
      displayHeight?: number;
    } | null;
    const sourceVideoTrackAny = sourceVideoTrack as { frameRate?: number } | null;
    const sourceWidth = Number(
      sourceDecoderConfigAny?.codedWidth || sourceDecoderConfigAny?.displayWidth || 0,
    );
    const sourceHeight = Number(
      sourceDecoderConfigAny?.codedHeight || sourceDecoderConfigAny?.displayHeight || 0,
    );
    const sourceFrameRate = Number(sourceVideoTrackAny?.frameRate || 0);

    const supportedVideoCodecs =
      typeof (format as any).getSupportedVideoCodecs === 'function'
        ? (format as any).getSupportedVideoCodecs()
        : undefined;
    const supportedAudioCodecs =
      typeof (format as any).getSupportedAudioCodecs === 'function'
        ? (format as any).getSupportedAudioCodecs()
        : undefined;

    const preferredVideoCodec =
      options.videoCodec === 'none' ? null : getBunnyVideoCodec(options.videoCodec);
    const preferredAudioCodec = options.audio ? getBunnyAudioCodec(options.audioCodec) : null;

    const resolvedVideoCodec = preferredVideoCodec
      ? await getFirstEncodableVideoCodec(
          supportedVideoCodecs?.includes(preferredVideoCodec)
            ? [
                preferredVideoCodec,
                ...supportedVideoCodecs.filter((codec: string) => codec !== preferredVideoCodec),
              ]
            : supportedVideoCodecs,
          {
            width: options.width,
            height: options.height,
            bitrate: options.bitrate,
          },
        )
      : null;

    const resolvedAudioCodec = preferredAudioCodec
      ? await getFirstEncodableAudioCodec(
          supportedAudioCodecs?.includes(preferredAudioCodec)
            ? [
                preferredAudioCodec,
                ...supportedAudioCodecs.filter((codec: string) => codec !== preferredAudioCodec),
              ]
            : supportedAudioCodecs,
          {
            sampleRate: options.audioSampleRate,
          },
        )
      : null;

    const shouldResizeVideo =
      Boolean(sourceWidth && sourceHeight) &&
      (Math.round(sourceWidth) !== Math.round(options.width) ||
        Math.round(sourceHeight) !== Math.round(options.height));
    const shouldChangeFrameRate =
      Boolean(sourceFrameRate) && Math.abs(sourceFrameRate - options.fps) > 0.01;

    const videoConfig =
      options.videoCodec === 'none' || !resolvedVideoCodec
        ? { discard: true }
        : {
            codec: resolvedVideoCodec,
            bitrate: options.bitrate,
            ...(shouldResizeVideo
              ? {
                  width: options.width,
                  height: options.height,
                  fit: 'contain',
                }
              : {}),
            ...(shouldChangeFrameRate ? { frameRate: options.fps } : {}),
          };

    const audioConfig =
      !options.audio || !resolvedAudioCodec
        ? { discard: true }
        : {
            codec: resolvedAudioCodec,
            bitrate: options.audioBitrate,
            numberOfChannels:
              options.audioChannels === 'mono'
                ? 1
                : options.audioChannels === 'stereo'
                  ? 2
                  : undefined,
            sampleRate: options.audioSampleRate,
            ...createAudioProcessConfig(),
          };

    if (
      options.videoCodec !== 'none' &&
      !resolvedVideoCodec &&
      (!options.audio || !sourceAudioTrack || !resolvedAudioCodec)
    ) {
      throw new Error(
        `No encodable target codec available for ${options.format} in this browser environment`,
      );
    }

    conversionProcess = await Conversion.init({
      input,
      output,
      video: videoConfig as any,
      audio: audioConfig as any,
      showWarnings: false,
    });

    if (!conversionProcess.isValid) {
      let reasons = '';
      if (conversionProcess.discardedTracks && conversionProcess.discardedTracks.length > 0) {
        reasons = conversionProcess.discardedTracks.map((t: any) => t.reason).join(', ');
      }
      throw new Error(`Conversion setup is invalid. Reasons: ${reasons}`);
    }

    await notifyPhase('encoding', taskId);

    let lastProgressAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let lastYieldAtMs = lastProgressAtMs;
    const progressIntervalMs = 250;
    const yieldIntervalMs = 32;

    conversionProcess.onProgress = (progress: number) => {
      ensureNotCancelled();

      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (nowMs - lastProgressAtMs >= progressIntervalMs) {
        lastProgressAtMs = nowMs;
        if (hostClient) {
          hostClient.onExportProgress(Math.round(progress * 100), taskId);
        }
      }
    };

    // We can wrap execute in a promise that also checks for cancellation periodically if execute is fully blocking
    // mediabunny's execute is typically async, but we can call our checkCancel inside the onProgress

    // Create an interval to yield/check cancel
    const cancelInterval = setInterval(() => {
      if (checkCancel()) {
        if (conversionProcess && typeof conversionProcess.cancel === 'function') {
          conversionProcess.cancel();
        }
      }
    }, yieldIntervalMs);

    try {
      await conversionProcess.execute();
    } finally {
      clearInterval(cancelInterval);
    }

    if (hostClient) {
      await hostClient.onExportProgress(100, taskId);
    }

    await notifyPhase('saving', taskId);
  } catch (e) {
    if (e instanceof Error && e.message === 'Assertion failed.') {
      throw new Error(
        'Video conversion failed in the worker rendering pipeline. The browser worker could not create a 2D OffscreenCanvas context for frame processing.',
      );
    }
    try {
      if (conversionProcess && typeof conversionProcess.cancel === 'function') {
        await conversionProcess.cancel();
      }
    } catch {}
    try {
      await safeCancelOutput();
    } catch {}
    try {
      if (typeof (writable as any).abort === 'function') await (writable as any).abort();
    } catch {}
    throw e;
  } finally {
    if (input && typeof input.dispose === 'function') {
      try {
        input.dispose();
      } catch {}
    }
  }
}
