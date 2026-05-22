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
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  async function notifyPhase(phase: 'encoding' | 'saving', taskId?: string) {
    if (!hostClient) return;
    try {
      await hostClient.onExportPhase?.(phase, taskId);
    } catch {
      // ignore
    }
  }

  // 1. Setup Input
  const source =
    sourceFile instanceof File
      ? new BlobSource(sourceFile)
      : new BlobSource(await sourceFile.getFile());
  const input = new Input({ source, formats: ALL_FORMATS } as unknown);

  // 2. Setup Output
  const format =
    options.format === 'webm'
      ? new WebMOutputFormat()
      : options.format === 'mkv'
        ? new MkvOutputFormat()
        : new Mp4OutputFormat();

  const writable = await (
    targetHandle as unknown as {
      createWritable: (opts?: {
        keepExistingData?: boolean;
      }) => Promise<{ abort?: () => Promise<void> }>;
    }
  ).createWritable({ keepExistingData: false });
  const target = new StreamTarget(writable, {
    chunked: true,
    chunkSize: 16 * 1024 * 1024,
  });
  const output = new Output({ target, format });

  // WORKAROUND: mediabunny's Conversion._processVideoTrack accidentally passes rotation synchronously
  // to addVideoTrack before its async block resets outputTrackRotation to 0.
  // When exporting to MKV, this causes a crash since MKV doesn't support rotation metadata.
  // We intercept addVideoTrack and strip the rotation.
  const originalAddVideoTrack = (
    output as unknown as {
      addVideoTrack: (source: unknown, metadata?: Record<string, unknown>) => void;
    }
  ).addVideoTrack.bind(output);
  (
    output as unknown as {
      addVideoTrack: (source: unknown, metadata?: Record<string, unknown>) => void;
    }
  ).addVideoTrack = (source, metadata = {}) => {
    if (
      'rotation' in metadata &&
      !(format as unknown as { supportsVideoRotationMetadata?: boolean })
        .supportsVideoRotationMetadata
    ) {
      metadata.rotation = 0;
    }
    return originalAddVideoTrack(source, metadata);
  };

  let conversionProcess: { isValid: boolean; discardedTracks?: { reason: string }[] } | null = null;
  let outputCancelled = false;

  async function safeCancelOutput() {
    if (outputCancelled) return;
    outputCancelled = true;

    try {
      if (typeof (output as { cancel?: () => Promise<void> }).cancel === 'function') {
        await (output as { cancel?: () => Promise<void> }).cancel();
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

    const sourceVideoTrackAny = sourceVideoTrack as { frameRate?: number } | null;
    const sourceFrameRate = Number(sourceVideoTrackAny?.frameRate || 0);

    const supportedVideoCodecs =
      typeof (format as unknown as { getSupportedVideoCodecs?: () => string[] })
        .getSupportedVideoCodecs === 'function'
        ? (
            format as unknown as { getSupportedVideoCodecs?: () => string[] }
          ).getSupportedVideoCodecs()
        : undefined;
    const supportedAudioCodecs =
      typeof (format as unknown as { getSupportedAudioCodecs?: () => string[] })
        .getSupportedAudioCodecs === 'function'
        ? (
            format as unknown as { getSupportedAudioCodecs?: () => string[] }
          ).getSupportedAudioCodecs()
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

    const shouldChangeFrameRate =
      Boolean(sourceFrameRate) && Math.abs(sourceFrameRate - options.fps) > 0.01;

    const videoConfig =
      options.videoCodec === 'none' || !resolvedVideoCodec
        ? { discard: true }
        : {
            codec: resolvedVideoCodec,
            bitrate: options.bitrate,
            width: Math.floor(options.width / 2) * 2,
            height: Math.floor(options.height / 2) * 2,
            fit: 'contain',
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
      video: videoConfig as unknown,
      audio: audioConfig as unknown,
      showWarnings: false,
    });

    if (!conversionProcess.isValid) {
      let reasons = '';
      if (conversionProcess.discardedTracks && conversionProcess.discardedTracks.length > 0) {
        reasons = conversionProcess.discardedTracks
          .map((t: { reason: string }) => t.reason)
          .join(', ');
      }
      throw new Error(`Conversion setup is invalid. Reasons: ${reasons}`);
    }

    await notifyPhase('encoding', taskId);

    let lastProgressAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const progressIntervalMs = 250;
    const yieldIntervalMs = 32;

    conversionProcess.onProgress = (progress: number) => {
      ensureNotCancelled();

      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (nowMs - lastProgressAtMs >= progressIntervalMs) {
        lastProgressAtMs = nowMs;
        if (hostClient) {
          hostClient.onExportProgress(Math.min(99, Math.round(progress * 99)), taskId);
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

    await notifyPhase('saving', taskId);
  } catch (e) {
    try {
      if (conversionProcess && typeof conversionProcess.cancel === 'function') {
        await conversionProcess.cancel();
      }
    } catch {
      /* no-op */
    }
    try {
      await safeCancelOutput();
    } catch {
      /* no-op */
    }
    try {
      if (typeof (writable as { abort?: () => Promise<void> }).abort === 'function')
        await (writable as { abort?: () => Promise<void> }).abort();
    } catch {
      /* no-op */
    }
    throw e;
  } finally {
    if (input && typeof input.dispose === 'function') {
      try {
        input.dispose();
      } catch {
        /* no-op */
      }
    }
  }
}
