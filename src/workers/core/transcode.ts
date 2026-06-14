import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import type { TranscodeOptions } from '~/composables/timeline/export/types';
import { runResilientWorkerFileIo, acquireStreamingWorkerFileIoSlot } from './io-governor';
import { governedBlobWorker } from '~/utils/io/governed-blob-worker';
import { createDevLogger } from '~/utils/dev-logger';
import { getBunnyVideoCodec, getBunnyAudioCodec } from './utils';
import { createAudioProcessConfig, ensureNotCancelled, notifyPhase } from './transcode-engine';

const log = createDevLogger('Worker Transcode');

type FileSystemWritableLike = WritableStream<never>;

interface FileSystemWritableHandleLike {
  createWritable: (opts?: { keepExistingData?: boolean }) => Promise<FileSystemWritableLike>;
}

interface BunnyFormatLike {
  supportsVideoRotationMetadata?: boolean;
  getSupportedVideoCodecs?: () => string[];
  getSupportedAudioCodecs?: () => string[];
}

interface BunnyOutputLike {
  addVideoTrack: (source: unknown, metadata?: Record<string, unknown>) => void;
  cancel?: () => Promise<void>;
}

interface BunnyConversionProcess {
  isValid: boolean;
  discardedTracks?: { reason: string }[];
  onProgress?: (progress: number, processedTime?: number) => unknown;
  execute?: () => Promise<void>;
  cancel?: () => void | Promise<void>;
}

export async function runTranscode(
  sourceFile: File | FileSystemFileHandle,
  targetHandle: FileSystemFileHandle,
  options: TranscodeOptions,
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

  // 1. Setup Input
  const source =
    sourceFile instanceof File
      ? new BlobSource(governedBlobWorker(sourceFile))
      : new BlobSource(
          governedBlobWorker(
            await runResilientWorkerFileIo(sourceFile, () => sourceFile.getFile()),
          ),
        );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = new Input({ source, formats: ALL_FORMATS } as any);

  // 2. Setup Output
  const format =
    options.format === 'webm'
      ? new WebMOutputFormat()
      : options.format === 'mkv'
        ? new MkvOutputFormat()
        : new Mp4OutputFormat();

  const release = await acquireStreamingWorkerFileIoSlot();
  const writable = await (targetHandle as FileSystemWritableHandleLike).createWritable({
    keepExistingData: false,
  });
  const target = new StreamTarget(writable, {
    chunked: true,
    chunkSize: 16 * 1024 * 1024,
  });
  const output = new Output({ target, format });
  const bunnyOutput = output as BunnyOutputLike;
  const bunnyFormat = format as BunnyFormatLike;

  // WORKAROUND: mediabunny's Conversion._processVideoTrack accidentally passes rotation synchronously
  // to addVideoTrack before its async block resets outputTrackRotation to 0.
  // When exporting to MKV, this causes a crash since MKV doesn't support rotation metadata.
  // We intercept addVideoTrack and strip the rotation.
  const originalAddVideoTrack = bunnyOutput.addVideoTrack.bind(output);
  bunnyOutput.addVideoTrack = (source, metadata = {}) => {
    if ('rotation' in metadata && !bunnyFormat.supportsVideoRotationMetadata) {
      metadata.rotation = 0;
    }
    return originalAddVideoTrack(source, metadata);
  };

  let conversionProcess: BunnyConversionProcess | null = null;
  let outputCancelled = false;

  async function safeCancelOutput() {
    if (outputCancelled) return;
    outputCancelled = true;

    try {
      await bunnyOutput.cancel?.();
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

    const supportedVideoCodecs = bunnyFormat.getSupportedVideoCodecs?.();
    const supportedAudioCodecs = bunnyFormat.getSupportedAudioCodecs?.();

    const preferredVideoCodec =
      options.videoCodec === 'none' ? null : getBunnyVideoCodec(options.videoCodec);
    const preferredAudioCodec = options.audio ? getBunnyAudioCodec(options.audioCodec) : null;

    const resolvedVideoCodec = preferredVideoCodec
      ? await getFirstEncodableVideoCodec(
          (supportedVideoCodecs?.includes(preferredVideoCodec)
            ? [
                preferredVideoCodec,
                ...supportedVideoCodecs.filter((codec: string) => codec !== preferredVideoCodec),
              ]
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
              supportedVideoCodecs) as any,
          {
            width: options.width,
            height: options.height,
            bitrate: options.bitrate,
          },
        )
      : null;

    const resolvedAudioCodec = preferredAudioCodec
      ? await getFirstEncodableAudioCodec(
          (supportedAudioCodecs?.includes(preferredAudioCodec)
            ? [
                preferredAudioCodec,
                ...supportedAudioCodecs.filter((codec: string) => codec !== preferredAudioCodec),
              ]
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
              supportedAudioCodecs) as any,
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
            ...createAudioProcessConfig(options, AudioSample),
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

    const initProcess = await Conversion.init({
      input,
      output,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      video: videoConfig as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audio: audioConfig as any,
      showWarnings: false,
    });

    if (!initProcess) {
      throw new Error('Failed to initialize conversion process');
    }
    conversionProcess = initProcess as unknown as BunnyConversionProcess;

    if (!conversionProcess.isValid) {
      let reasons = '';
      if (conversionProcess.discardedTracks && conversionProcess.discardedTracks.length > 0) {
        reasons = conversionProcess.discardedTracks
          .map((t: { reason: string }) => t.reason)
          .join(', ');
      }
      throw new Error(`Conversion setup is invalid. Reasons: ${reasons}`);
    }

    await notifyPhase(hostClient, 'encoding', taskId);

    let lastProgressAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const progressIntervalMs = 250;
    const yieldIntervalMs = 32;

    conversionProcess.onProgress = (progress: number) => {
      ensureNotCancelled(checkCancel);

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
        if (conversionProcess) {
          void conversionProcess.cancel?.();
        }
      }
    }, yieldIntervalMs);

    try {
      await conversionProcess.execute?.();
    } finally {
      clearInterval(cancelInterval);
    }

    await notifyPhase(hostClient, 'finalizing', taskId);
  } catch (e) {
    try {
      if (conversionProcess) {
        await conversionProcess.cancel?.();
      }
    } catch (cleanupError) {
      log.debug('Ignored conversion cancel failure during transcode cleanup', cleanupError);
    }
    try {
      await safeCancelOutput();
    } catch (cleanupError) {
      log.debug('Ignored output cancel failure during transcode cleanup', cleanupError);
    }
    try {
      writable.abort?.();
    } catch (cleanupError) {
      log.debug('Ignored writable abort failure during transcode cleanup', cleanupError);
    }
    throw e;
  } finally {
    release();
    if (input && typeof input.dispose === 'function') {
      try {
        input.dispose();
      } catch (cleanupError) {
        log.debug('Ignored input dispose failure during transcode cleanup', cleanupError);
      }
    }
  }
}
