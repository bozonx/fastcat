import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import type { ExportOptions } from '../../utils/video-editor/worker-rpc';
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
  } = await import('mediabunny');

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

  try {
    const videoConfig =
      options.videoCodec === 'none'
        ? { discard: true }
        : {
            width: options.width,
            height: options.height,
            frameRate: options.fps,
            codec: getBunnyVideoCodec(options.videoCodec),
            bitrate: options.bitrate,
          };

    const audioConfig = !options.audio
      ? { discard: true }
      : {
          codec: getBunnyAudioCodec(options.audioCodec),
          bitrate: options.audioBitrate,
        };

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
    try {
      if (conversionProcess && typeof conversionProcess.cancel === 'function') {
        await conversionProcess.cancel();
      }
    } catch {}
    try {
      if (typeof (output as any).cancel === 'function') await (output as any).cancel();
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
