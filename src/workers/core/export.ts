import { createDevLogger } from '~/utils/dev-logger';
import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { VideoCompositor } from '../../utils/video-editor/VideoCompositor';
import { loadFonts } from '../../utils/video-editor/load-fonts';
import { safeDispose } from '../../utils/video-editor/utils';
import { parseVideoCodec, parseAudioCodec, getBunnyVideoCodec, getBunnyAudioCodec } from './utils';
import { buildMixedAudioTrack } from './audio';
import {
  computeExportFrameInterval,
  computeExportTotalFrames,
  computeMaxAudioDurationUs,
  getClipRangesS,
  getExportFrameTiming,
} from './export-helpers';
import { usToS } from './time';
import { yieldToEventLoop } from './yield-scheduler';
import { VIDEO_CORE_LIMITS } from '~/utils/constants';
import { initEffects } from '../../effects';
import { initTransitions } from '../../transitions';
import {
  getMediaTypeFromFilename,
  getMimeTypeFromFilename,
  BROWSER_NATIVE_IMAGE_EXTENSIONS,
} from '../../utils/media-types';
import { runResilientWorkerFileIo, acquireStreamingWorkerFileIoSlot } from './io-governor';
import { governedBlobWorker } from '~/utils/io/governed-blob-worker';
import type { ExportOptions, WorkerTimelineClip } from '~/types/worker-payload';
import type { MediaMetadata } from '~/types/media';
const log = createDevLogger('export');

interface DisposableSampleSink {
  dispose?: () => void;
  close?: () => void;
}

export async function extractMetadata(
  fileOrHandle: File | FileSystemFileHandle,
): Promise<MediaMetadata> {
  const file =
    fileOrHandle instanceof File
      ? fileOrHandle
      : await runResilientWorkerFileIo(fileOrHandle, () =>
          (fileOrHandle as FileSystemFileHandle).getFile(),
        );

  const isImage = getMediaTypeFromFilename(file.name) === 'image';

  if (isImage) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    let canDisplay: boolean;
    let width = 0;
    let height = 0;

    if (BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext)) {
      try {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
        canDisplay = width > 0 && height > 0;
      } catch {
        canDisplay = false;
      }
    } else {
      // Non-native formats (e.g. tiff) cannot be displayed by the renderer without
      // raster conversion. Mark explicitly so downstream code skips them instead of
      // assuming "unknown means OK".
      canDisplay = false;
    }

    return {
      source: {
        size: file.size,
        lastModified: file.lastModified,
      },
      mimeType: getMimeTypeFromFilename(file.name),
      container: 'image',
      duration: 0,
      image: { canDisplay, width, height },
    };
  }

  try {
    const { Input, BlobSource, ALL_FORMATS, VideoSampleSink, AudioSampleSink } =
      await import('mediabunny');
    const source = new BlobSource(governedBlobWorker(file));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = new Input({ source, formats: ALL_FORMATS } as any);

    try {
      const mimeType = typeof input.getMimeType === 'function' ? await input.getMimeType() : null;
      const format = typeof input.getFormat === 'function' ? await input.getFormat() : null;

      const durationS = await input.computeDuration();
      const vTrack = await input.getPrimaryVideoTrack();
      const aTrack = await input.getPrimaryAudioTrack();

      const meta: MediaMetadata = {
        source: {
          size: file.size,
          lastModified: file.lastModified,
        },
        mimeType: mimeType ?? getMimeTypeFromFilename(file.name),
        container: format?.name ?? format?.constructor?.name,
        duration: durationS,
      };

      if (vTrack) {
        const stats = await vTrack.computePacketStats(50);
        const codecParam = await vTrack.getCodecParameterString();
        const colorSpace =
          typeof vTrack.getColorSpace === 'function' ? await vTrack.getColorSpace() : undefined;
        let canDecodeVideo = await vTrack.canDecode();

        if (canDecodeVideo) {
          try {
            const vSink = new VideoSampleSink(vTrack);
            const firstTs =
              typeof vTrack.getFirstTimestamp === 'function' ? await vTrack.getFirstTimestamp() : 0;
            const firstSample = await (
              vSink as {
                getSample: (t: number) => Promise<{ close?: () => void } | null | undefined>;
              }
            ).getSample(firstTs);
            if (!firstSample) {
              throw new Error('No video sample decoded');
            }
            if (typeof firstSample.close === 'function') firstSample.close();
            const disposableSink = vSink as DisposableSampleSink;
            if (typeof disposableSink.dispose === 'function') disposableSink.dispose();
            else if (typeof disposableSink.close === 'function') disposableSink.close();
          } catch (e) {
            log.warn('[Worker Export] Video decoding validation failed:', (e as Error)?.message);
            canDecodeVideo = false;
          }
        }

        meta.video = {
          width: vTrack.codedWidth,
          height: vTrack.codedHeight,
          displayWidth: vTrack.displayWidth,
          displayHeight: vTrack.displayHeight,
          rotation: vTrack.rotation,
          codec: codecParam || vTrack.codec || '',
          parsedCodec: parseVideoCodec(codecParam || vTrack.codec || ''),
          fps: stats.averagePacketRate,
          bitrate: stats.averageBitrate,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          colorSpace: colorSpace as any,
          canDecode: canDecodeVideo,
        };
      }

      if (aTrack) {
        const stats = await aTrack.computePacketStats(100);
        const codecParam = await aTrack.getCodecParameterString();
        let canDecodeAudio = await aTrack.canDecode();

        if (canDecodeAudio) {
          try {
            const aSink = new AudioSampleSink(aTrack);
            let decodedAny = false;
            for await (const sampleRaw of (
              aSink as {
                samples: (
                  start: number,
                  end: number,
                ) => AsyncIterable<{ close?: () => void } | null | undefined>;
              }
            ).samples(0, 0.1)) {
              if (sampleRaw) {
                decodedAny = true;
                if (typeof sampleRaw.close === 'function') sampleRaw.close();
                break;
              }
            }
            const disposableSink = aSink as DisposableSampleSink;
            if (typeof disposableSink.dispose === 'function') disposableSink.dispose();
            else if (typeof disposableSink.close === 'function') disposableSink.close();

            if (!decodedAny) {
              throw new Error('No audio samples decoded');
            }
          } catch (e) {
            log.warn('[Worker Export] Audio decoding validation failed:', (e as Error)?.message);
            canDecodeAudio = false;
          }
        }

        meta.audio = {
          codec: codecParam || aTrack.codec || '',
          parsedCodec: parseAudioCodec(codecParam || aTrack.codec || ''),
          sampleRate: aTrack.sampleRate,
          channels: aTrack.numberOfChannels,
          bitrate: stats.averageBitrate,
          canDecode: canDecodeAudio,
        };
      }

      return meta;
    } finally {
      safeDispose(input);
    }
  } catch (err) {
    log.warn(
      '[Worker Export] Failed to extract metadata (unsupported format):',
      (err as Error)?.message,
    );
    throw err;
  }
}

export function isOpusCodec(codec: string | undefined): boolean {
  const value = String(codec ?? '').toLowerCase();
  return value.startsWith('opus');
}

export function buildMetadataTags(
  metadata: NonNullable<ExportOptions['metadata']>,
): Record<string, unknown> | null {
  const tags: Record<string, unknown> = {};
  const title = (metadata.title ?? '').trim();
  const description = (metadata.description ?? '').trim();
  const author = (metadata.author ?? '').trim();
  const tagsStr = (metadata.tags ?? '').trim();

  if (title) tags.title = title;
  if (description) tags.description = description;
  if (author) tags.artist = author;
  if (tagsStr) {
    const parsed = tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (parsed.length > 0) tags.comment = parsed.join(', ');
  }

  return Object.keys(tags).length > 0 ? tags : null;
}

export async function waitForVideoBackpressure(
  videoSource: { encodeQueueSize?: number },
  maxQueueSize: number = VIDEO_CORE_LIMITS.EXPORT_ENCODER_QUEUE_DEPTH,
) {
  let delayMs = 1;

  while (Number(videoSource?.encodeQueueSize ?? 0) >= maxQueueSize) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(8, delayMs * 2);
  }
}

export interface ExportProgressHost {
  onExportProgress?: (progress: number, taskId?: string) => Promise<void> | void;
}

export interface ExportProgressReporter {
  report: (progress: number, taskId?: string) => void;
  flush: () => Promise<void>;
}

export function createCoalescedExportProgressReporter(
  hostClient: ExportProgressHost | null,
): ExportProgressReporter {
  let inFlight: Promise<void> | null = null;
  let pending: { progress: number; taskId?: string } | null = null;

  const launch = (progress: number, taskId?: string) => {
    inFlight = Promise.resolve(hostClient?.onExportProgress?.(progress, taskId))
      .catch(() => undefined)
      .then(() => {
        inFlight = null;
        const next = pending;
        pending = null;
        if (next) {
          launch(next.progress, next.taskId);
        }
      });
  };

  return {
    report(progress, taskId) {
      if (!hostClient?.onExportProgress) return;
      if (inFlight) {
        pending = { progress, taskId };
        return;
      }
      launch(progress, taskId);
    },
    async flush() {
      while (inFlight) {
        await inFlight;
      }
    },
  };
}

export async function isVideoEncoderConfigSupported(params: {
  codec: string | undefined;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software';
}): Promise<boolean | null> {
  const codec = params.codec?.trim();
  const encoder = (globalThis as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  if (!codec || !encoder?.isConfigSupported) return null;

  try {
    const result = await encoder.isConfigSupported({
      codec,
      width: params.width,
      height: params.height,
      framerate: params.fps,
      bitrate: params.bitrate,
      hardwareAcceleration: params.hardwareAcceleration,
    });
    return !!result?.supported;
  } catch {
    return false;
  }
}

export async function runConcurrentExportWriters(params: {
  audioWriter?: (() => Promise<void>) | null;
  videoWriter?: (() => Promise<void>) | null;
  progressReporter: ExportProgressReporter;
  taskId?: string;
}): Promise<void> {
  const writers: Promise<void>[] = [];

  if (params.audioWriter) {
    writers.push(params.audioWriter());
  }
  if (params.videoWriter) {
    writers.push(params.videoWriter());
  }

  await Promise.all(writers);
  params.progressReporter.report(99, params.taskId);
  await params.progressReporter.flush();
}

function fillCanvasBlack(canvas: OffscreenCanvas | HTMLCanvasElement | undefined | null) {
  if (!canvas) return;
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) return;
  context.save();
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

interface PassthroughClip {
  fastcat?: Record<string, unknown>;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  transitionIn?: { durationUs?: number };
  transitionOut?: { durationUs?: number };
  effects?: { target?: string; enabled?: boolean }[];
  speed?: number;
  sourcePath?: string;
  source?: { path?: string };
  fileHandle?: FileSystemFileHandle;
}

export function isPassthroughCompatibleClip(
  clip: PassthroughClip,
  _options: { audioSampleRate?: number; audioChannels?: 'mono' | 'stereo' },
): { ok: true } | { ok: false; reason: string } {
  const fastcat = clip.fastcat ?? {};
  const gain = Number(clip.audioGain ?? fastcat.audioGain ?? 1);
  if (Number.isFinite(gain) && Math.abs(gain - 1) > 1e-6) {
    return { ok: false, reason: 'clip gain is not unity' };
  }
  const balance = Number(clip.audioBalance ?? fastcat.audioBalance ?? 0);
  if (Number.isFinite(balance) && Math.abs(balance) > 1e-6) {
    return { ok: false, reason: 'clip balance is not centered' };
  }
  const fadeInUs = Number(clip.audioFadeInUs ?? fastcat.audioFadeInUs ?? 0);
  const fadeOutUs = Number(clip.audioFadeOutUs ?? fastcat.audioFadeOutUs ?? 0);
  if (fadeInUs > 0 || fadeOutUs > 0) {
    return { ok: false, reason: 'clip has fade in/out' };
  }
  const transitionIn = (clip.transitionIn ?? fastcat.transitionIn) as
    | { durationUs?: unknown }
    | undefined;
  const transitionOut = (clip.transitionOut ?? fastcat.transitionOut) as
    | { durationUs?: unknown }
    | undefined;
  if (
    (transitionIn?.durationUs && Number(transitionIn.durationUs) > 0) ||
    (transitionOut?.durationUs && Number(transitionOut.durationUs) > 0)
  ) {
    return { ok: false, reason: 'clip has audio transition' };
  }
  const audioEffects = Array.isArray(clip.effects)
    ? clip.effects.filter((e) => e?.target === 'audio' && e?.enabled !== false)
    : [];
  if (audioEffects.length > 0) {
    return { ok: false, reason: 'clip has audio effects' };
  }
  const speedRaw = Number(clip.speed);
  if (Number.isFinite(speedRaw) && speedRaw !== 1) {
    return { ok: false, reason: 'clip has non-unit speed or reverse' };
  }
  // Passthrough copies encoded packets as-is; sample rate and channel count
  // are inherited from the source decoder config, so no further checks needed.
  return { ok: true };
}

async function buildPassthroughAudioTrack(params: {
  clip: PassthroughClip;
  hostClient: VideoCoreHostAPI | null;
  reportExportWarning: (message: string) => Promise<void>;
}) {
  const { clip, hostClient, reportExportWarning } = params;
  const sourcePath = clip.sourcePath || clip.source?.path;
  if (!sourcePath || !hostClient) return null;

  const fileHandle = clip.fileHandle || (await hostClient.getFileHandleByPath(sourcePath));
  if (!fileHandle) return null;

  const file =
    (await hostClient.getFileByPath?.(sourcePath)) ??
    (await runResilientWorkerFileIo(fileHandle, () => fileHandle.getFile()));
  const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink, EncodedAudioPacketSource } =
    await import('mediabunny');

  const input = new Input({
    source: new BlobSource(governedBlobWorker(file)),
    formats: ALL_FORMATS,
  } as ConstructorParameters<typeof Input>[0]);

  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) return null;

    const codecParam = await audioTrack.getCodecParameterString();
    const codec = codecParam || audioTrack.codec || '';
    if (!isOpusCodec(codec)) return null;

    // Passthrough copies encoded packets as-is with the source's decoder config,
    // so the output inherits the source's sample rate and channel count.
    // No need to validate against requestedSampleRate/requestedChannels —
    // those only apply to the re-encode path.

    const decoderConfig = await audioTrack.getDecoderConfig();
    if (!decoderConfig) {
      await reportExportWarning(
        '[Worker Export] Opus audio passthrough requires decoder config; falling back to re-encode.',
      );
      safeDispose(input);
      return null;
    }

    return {
      audioSource: new EncodedAudioPacketSource('opus'),
      packetSink: new EncodedPacketSink(audioTrack),
      decoderConfig,
      ranges: getClipRangesS(clip),
      input,
    } as const;
  } catch (error) {
    await reportExportWarning('[Worker Export] Failed to build Opus passthrough audio track.');
    throw error;
  }
}

export interface OutputFormatConstructors {
  Mp4OutputFormat: new () => unknown;
  WebMOutputFormat: new () => unknown;
  MkvOutputFormat: new () => unknown;
  AdtsOutputFormat: new () => unknown;
  OggOutputFormat: new () => unknown;
  FlacOutputFormat: new () => unknown;
  WavOutputFormat: new () => unknown;
}

/**
 * Maps the export format string to a mediabunny output-format instance. Pure:
 * the format constructors are passed in (they come from a dynamic import in the
 * caller) so this stays trivially testable and free of side effects.
 */
export function selectOutputFormat(
  format: ExportOptions['format'],
  ctors: OutputFormatConstructors,
) {
  switch (format) {
    case 'webm':
      return new ctors.WebMOutputFormat();
    case 'mkv':
      return new ctors.MkvOutputFormat();
    case 'aac':
      return new ctors.AdtsOutputFormat();
    case 'opus':
    case 'ogg':
      return new ctors.OggOutputFormat();
    case 'flac':
      return new ctors.FlacOutputFormat();
    case 'wav':
    case 'pcm':
      return new ctors.WavOutputFormat();
    case 'mp3':
      throw new Error('MP3 export is not supported in the web version');
    default:
      return new ctors.Mp4OutputFormat();
  }
}

export async function runExport(
  targetHandle: FileSystemFileHandle,
  options: ExportOptions,
  timelineClips: import('~/types/worker-payload').WorkerVideoPayloadItem[],
  audioClips: WorkerTimelineClip[],
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (msg: string, taskId?: string) => Promise<void>,
  checkCancel: () => boolean,
  taskId?: string,
  rendererPreference: 'webgl' | 'webgpu' = 'webgl',
  masterAudioEffects?: import('../../utils/audio/apply-audio-effects-offline').AudioEffectData[],
) {
  initEffects();
  initTransitions();

  const {
    Output,
    Mp4OutputFormat,
    WebMOutputFormat,
    MkvOutputFormat,
    AdtsOutputFormat,
    OggOutputFormat,
    FlacOutputFormat,
    WavOutputFormat,
    CanvasSource,
    StreamTarget,
  } = await import('mediabunny');

  function ensureNotCancelled() {
    if (!checkCancel()) return;
    const abortErr = new Error('Export was cancelled');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  async function notifyPhase(phase: 'encoding' | 'finalizing', taskId?: string) {
    if (!hostClient) return;
    try {
      await hostClient.onExportPhase?.(phase, taskId);
    } catch {
      // ignore
    }
  }

  async function createOutput(params: { format: unknown }): Promise<{
    output: {
      cancel?: () => Promise<void>;
      setMetadataTags?: (tags: Record<string, unknown>) => void;
    };
    writable: { abort?: () => Promise<void> };
    releaseSlot: () => void;
  }> {
    const release = await acquireStreamingWorkerFileIoSlot();
    try {
      const writable = await (
        targetHandle as unknown as {
          createWritable: (opts?: {
            keepExistingData?: boolean;
          }) => Promise<{ abort?: () => Promise<void> }>;
        }
      ).createWritable({ keepExistingData: false });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = new StreamTarget(writable as any, {
        chunked: true,
        chunkSize: 16 * 1024 * 1024,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = new Output({ target, format: params.format as any });
      return { output, writable, releaseSlot: release };
    } catch (err) {
      release();
      throw err;
    }
  }

  async function safeCancel(params: {
    output: { cancel?: () => Promise<void> };
    writable: { abort?: () => Promise<void> };
  }) {
    const { output, writable } = params;
    try {
      if (typeof output.cancel === 'function') {
        await output.cancel();
      }
    } catch {
      // ignore
    }

    try {
      if (typeof writable.abort === 'function') {
        await writable.abort();
      }
    } catch {
      // ignore
    }
  }

  async function writeOpusPassthroughIfNeeded(params: {
    audioPacketState: {
      audioSource: { add: (packet: unknown, opts?: { decoderConfig?: unknown }) => Promise<void> };
      packetSink: { packets: () => AsyncIterable<unknown>; close?: () => void };
      decoderConfig: unknown;
      ranges: { timelineStartS: number; sourceStartS: number; sourceEndS: number };
      input: unknown;
    } | null;
  }) {
    const audioPacketState = params.audioPacketState;
    if (!audioPacketState) return;

    const { packetSink, decoderConfig, ranges, input } = audioPacketState;
    let isFirstPacket = true;
    try {
      for await (const packetRaw of packetSink.packets()) {
        ensureNotCancelled();
        const packet = packetRaw as {
          timestamp?: number;
          duration?: number;
          clone?: (opts: { timestamp: number }) => unknown;
        };
        const packetStart = Number(packet.timestamp || 0);
        const packetDuration = Number(packet.duration || 0);
        const packetEnd = packetStart + packetDuration;
        if (packetEnd <= ranges.sourceStartS) continue;
        if (packetStart >= ranges.sourceEndS) break;
        // A packet straddling sourceStartS would produce a negative timestamp,
        // which breaks muxing. We drop it; this loses at most one Opus frame
        // (~20 ms) at the start, but keeps the stream valid.
        if (packetStart < ranges.sourceStartS) continue;

        const adjustedTimestamp = packetStart - ranges.sourceStartS + ranges.timelineStartS;
        const adjustedPacket = (
          packet as { clone?: (opts: { timestamp: number }) => unknown }
        ).clone?.({ timestamp: adjustedTimestamp });
        if (isFirstPacket) {
          await audioPacketState.audioSource.add(adjustedPacket, { decoderConfig });
          isFirstPacket = false;
        } else {
          await audioPacketState.audioSource.add(adjustedPacket);
        }
      }

      if (isFirstPacket) {
        await reportExportWarning(
          '[Worker Export] No audio packets in selected range; exporting without audio.',
        );
      }
    } finally {
      if ('close' in packetSink && typeof packetSink.close === 'function') {
        packetSink.close();
      }
      safeDispose(input);
    }
  }

  async function encodeFrames(params: {
    durationUs: number;
    fps: number;
    videoSource: { add: (timestampS: number, durationS: number) => Promise<void> };
    compositor: VideoCompositor;
    progressReporter: ExportProgressReporter;
    taskId?: string;
  }) {
    const fps = Math.max(1, Number(params.fps) || 30);
    const totalFrames = computeExportTotalFrames({ durationUs: params.durationUs, fps });

    const nowMsFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let lastYieldAtMs = nowMsFn();
    let lastProgressAtMs = lastYieldAtMs;
    const yieldIntervalMs = 16;
    const progressIntervalMs = 250;

    let emptyFrameCount = 0;
    let firstEmptyFrameTimestampS: number | null = null;

    // Per-phase timing accumulators. Used only to emit a dev-only summary so the
    // decode/composite vs encoder-backpressure split can be measured without a
    // profiler — this is what tells us whether an export is decode-bound or
    // encoder-bound before reaching for bigger pipeline changes. log.info is a
    // no-op outside dev, so this never prints in production.
    let renderMsTotal = 0;
    let backpressureMsTotal = 0;
    let encodeSubmitMsTotal = 0;
    const wallStartMs = nowMsFn();

    for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
      ensureNotCancelled();

      const frame = getExportFrameTiming({
        frameNum,
        totalFrames,
        durationUs: params.durationUs,
        fps,
      });
      const renderStartMs = nowMsFn();
      const generatedCanvas = await params.compositor.renderFrame(frame.timeUs);
      renderMsTotal += nowMsFn() - renderStartMs;
      if (!generatedCanvas) {
        fillCanvasBlack(params.compositor.canvas);
        if (emptyFrameCount === 0) {
          firstEmptyFrameTimestampS = frame.timestampS;
        }
        emptyFrameCount++;
      }
      const backpressureStartMs = nowMsFn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await waitForVideoBackpressure(params.videoSource as any);
      const encodeSubmitStartMs = nowMsFn();
      backpressureMsTotal += encodeSubmitStartMs - backpressureStartMs;
      await params.videoSource.add(frame.timestampS, frame.durationS);
      encodeSubmitMsTotal += nowMsFn() - encodeSubmitStartMs;

      const progress = Math.min(99, Math.round(((frameNum + 1) / totalFrames) * 99));
      const nowProgressMs = nowMsFn();
      const shouldReport =
        frameNum + 1 === totalFrames || nowProgressMs - lastProgressAtMs >= progressIntervalMs;
      if (shouldReport) {
        lastProgressAtMs = nowProgressMs;
        params.progressReporter.report(progress, params.taskId);
      }

      const nowMs = nowMsFn();
      if (nowMs - lastYieldAtMs >= yieldIntervalMs) {
        lastYieldAtMs = nowMs;
        // A MessageChannel macrotask still flushes progress posts and lets cancel
        // messages land, but skips the ~4 ms minimum-delay clamp a nested worker
        // setTimeout(0) would pay on every yield (pure idle on fast/cached
        // frames). See yield-scheduler.ts.
        await yieldToEventLoop();
      }
    }

    if (totalFrames > 0) {
      const wallMs = nowMsFn() - wallStartMs;
      log.info(
        `[Worker Export] encode timing: ${totalFrames} frames in ${wallMs.toFixed(0)}ms ` +
          `(${(wallMs / totalFrames).toFixed(1)}ms/frame) — ` +
          `render/decode ${renderMsTotal.toFixed(0)}ms, ` +
          `encoder-backpressure ${backpressureMsTotal.toFixed(0)}ms, ` +
          `encode-submit ${encodeSubmitMsTotal.toFixed(0)}ms`,
      );
    }

    if (emptyFrameCount > 0) {
      await reportExportWarning(
        `[Worker Export] ${emptyFrameCount} frame(s) rendered empty (first at ${firstEmptyFrameTimestampS?.toFixed(3) ?? '0'}s); substituted with black.`,
      );
    }
  }

  await loadFonts();
  const localCompositor = options.videoCodec !== 'none' ? new VideoCompositor() : null;
  if (localCompositor) {
    await localCompositor.init(options.width, options.height, '#000', true, undefined, {
      rendererPreference,
    });
  }

  try {
    let maxVideoDurationUs = 0;
    if (localCompositor) {
      maxVideoDurationUs = await localCompositor.loadTimeline(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        timelineClips as any,
        {
          getFileHandleByPath: async (path) => {
            if (!hostClient) return null;
            return hostClient.getFileHandleByPath(path);
          },
          getFileByPath: async (path: string) => {
            if (!hostClient?.getFileByPath) return null;
            return hostClient.getFileByPath(path);
          },
          getCurrentProjectId: async () => {
            if (!hostClient) return null;
            return await hostClient.getCurrentProjectId();
          },
          ensureVectorImageRaster: async (params) => {
            if (!hostClient) return null;
            return await hostClient.ensureVectorImageRaster(params);
          },
        },
        checkCancel,
      );
      const requiresCompute = timelineClips.some((item) => {
        if (!item || typeof item !== 'object') return false;
        if (item.kind === 'meta') {
          return Array.isArray(item.masterEffects) && item.masterEffects.length > 0;
        }
        if (item.kind === 'track') {
          return Array.isArray(item.effects) && item.effects.length > 0;
        }
        return (
          (Array.isArray(item.effects) && item.effects.length > 0) ||
          Boolean(item.transitionIn || item.transitionOut)
        );
      });
      if (requiresCompute && !localCompositor.supportsComputeEffects()) {
        throw new Error(
          'WebGPU is required to export timelines with video effects or shader transitions.',
        );
      }
    }

    const maxAudioDurationUs = options.audio ? computeMaxAudioDurationUs(audioClips) : 0;

    const maxDurationUs = Math.max(maxVideoDurationUs, maxAudioDurationUs);

    if (maxDurationUs <= 0) throw new Error('No clips to export');

    const durationS = usToS(maxDurationUs);
    const hasAnyAudio = options.audio && audioClips.length > 0;

    const format = selectOutputFormat(options.format, {
      Mp4OutputFormat,
      WebMOutputFormat,
      MkvOutputFormat,
      AdtsOutputFormat,
      OggOutputFormat,
      FlacOutputFormat,
      WavOutputFormat,
    });

    // Builds the output's audio track: tries Opus passthrough for a single
    // compatible clip, otherwise falls back to a re-encoded mixed track. Adds
    // the chosen source to `output` and returns the handles the encode loop
    // needs.
    async function setupAudioTracks(output: { addAudioTrack: (source: unknown) => void }): Promise<{
      audioSource: unknown;
      writeMixedAudioToSource: (() => Promise<void>) | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioPacketState: any;
    }> {
      let audioSource: unknown = null;
      let writeMixedAudioToSource: (() => Promise<void>) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let audioPacketState: any = null;

      if (!(options.audio && hasAnyAudio)) {
        return { audioSource, writeMixedAudioToSource, audioPacketState };
      }

      if (options.audioPassthrough && audioClips.length === 1 && audioClips[0] !== undefined) {
        const compat = isPassthroughCompatibleClip(audioClips[0], options);
        if (!compat.ok) {
          await reportExportWarning(
            `[Worker Export] Opus audio passthrough disabled (${compat.reason}); re-encoding audio.`,
          );
        } else {
          audioPacketState = await buildPassthroughAudioTrack({
            clip: audioClips[0] as PassthroughClip,
            hostClient,
            reportExportWarning,
          });
          if (audioPacketState) {
            audioSource = audioPacketState.audioSource;
            output.addAudioTrack(audioSource);
          } else {
            await reportExportWarning(
              '[Worker Export] Opus audio passthrough not available; falling back to re-encode.',
            );
          }
        }
      }

      if (!audioSource) {
        const audioTrack = await buildMixedAudioTrack(
          options,
          audioClips,
          durationS,
          hostClient,
          reportExportWarning,
          checkCancel,
          masterAudioEffects,
        );
        if (audioTrack) {
          audioSource = audioTrack.audioSource;
          writeMixedAudioToSource = audioTrack.writeMixedToSource;
          output.addAudioTrack(audioSource);
        } else {
          await reportExportWarning(
            '[Worker Export] No decodable audio track found; exporting without audio.',
          );
        }
      }

      return { audioSource, writeMixedAudioToSource, audioPacketState };
    }

    async function runExportWithHardwareAcceleration(
      preference: 'prefer-hardware' | 'prefer-software',
      fallbackCodecString = true,
    ) {
      await notifyPhase('encoding', taskId);

      const { output, writable, releaseSlot } = await createOutput({ format });

      if (options.metadata) {
        const tags = buildMetadataTags(options.metadata);
        if (tags && typeof output.setMetadataTags === 'function') {
          output.setMetadataTags(tags);
        }
      }

      const fullCodecString =
        fallbackCodecString && options.videoCodec ? options.videoCodec : undefined;
      const fps = Math.max(1, Number(options.fps) || 30);
      const keyFrameInterval = computeExportFrameInterval({
        intervalSec: options.keyframeIntervalSec,
        fps,
      });
      const progressReporter = createCoalescedExportProgressReporter(hostClient);

      const formatSupportsAlpha =
        options.format === 'webm' ||
        (options.format === 'mkv' && options.videoCodec === 'vp09.00.10.08');
      if (options.exportAlpha && !formatSupportsAlpha) {
        await reportExportWarning(
          `[Worker Export] Alpha channel is not supported by ${options.format.toUpperCase()}; exporting without alpha.`,
        );
      }

      const videoSource =
        options.videoCodec !== 'none' && localCompositor
          ? new CanvasSource(localCompositor.canvas as unknown as HTMLCanvasElement, {
              codec: getBunnyVideoCodec(options.videoCodec),
              fullCodecString,
              bitrate: options.bitrate,
              alpha: options.exportAlpha && formatSupportsAlpha ? 'keep' : 'discard',
              bitrateMode: options.bitrateMode === 'constant' ? 'constant' : 'variable',
              keyFrameInterval,
              hardwareAcceleration: preference,
            })
          : null;
      if (videoSource) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (output as any).addVideoTrack(videoSource);
      }

      const { audioSource, writeMixedAudioToSource, audioPacketState } = await setupAudioTracks(
        output as unknown as { addAudioTrack: (source: unknown) => void },
      );

      let finalized = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (output as any).start();

        let audioWriter: (() => Promise<void>) | null = null;

        if (audioSource && writeMixedAudioToSource) {
          audioWriter = writeMixedAudioToSource;
        } else if (audioPacketState) {
          audioWriter = () => writeOpusPassthroughIfNeeded({ audioPacketState });
        }

        const videoWriter =
          videoSource && localCompositor
            ? () =>
                encodeFrames({
                  durationUs: maxDurationUs,
                  fps: options.fps,
                  videoSource,
                  compositor: localCompositor,
                  progressReporter,
                  taskId,
                })
            : null;

        await runConcurrentExportWriters({
          audioWriter,
          videoWriter,
          progressReporter,
          taskId,
        });

        await notifyPhase('finalizing', taskId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (output as any).finalize();
        progressReporter.report(100, taskId);
        await progressReporter.flush();
        finalized = true;
      } finally {
        if (!finalized) {
          await safeCancel({ output, writable });
        }
        releaseSlot();
        safeDispose(audioSource);
        safeDispose(videoSource);
      }
    }

    async function runDefaultHardwareAfterExactFailure(error?: unknown) {
      if (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        log.warn('[Worker Export] Hardware acceleration export with exact profile failed:', error);
      }
      await reportExportWarning(
        '[Worker Export] Hardware acceleration export with exact profile failed, retrying with default HW profile.',
      );
      try {
        await runExportWithHardwareAcceleration('prefer-hardware', false);
      } catch (e2) {
        if (e2 instanceof Error && e2.name === 'AbortError') throw e2;
        log.warn(
          '[Worker Export] Hardware acceleration export failed completely, retrying with software:',
          e2,
        );
        await reportExportWarning(
          '[Worker Export] Hardware acceleration export failed completely, retrying with software.',
        );
        await runExportWithHardwareAcceleration('prefer-software', false);
      }
    }

    const exactHardwareSupport =
      options.videoCodec !== 'none'
        ? await isVideoEncoderConfigSupported({
            codec: options.videoCodec,
            width: options.width,
            height: options.height,
            fps: options.fps,
            bitrate: options.bitrate,
            hardwareAcceleration: 'prefer-hardware',
          })
        : null;

    if (exactHardwareSupport === false) {
      await runDefaultHardwareAfterExactFailure();
    } else {
      try {
        await runExportWithHardwareAcceleration('prefer-hardware', true);
      } catch (e) {
        await runDefaultHardwareAfterExactFailure(e);
      }
    }
  } finally {
    if (localCompositor) {
      await localCompositor.destroy();
    }
  }
}

export async function extractAudioStream(
  sourcePath: string,
  targetPath: string,
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (msg: string) => Promise<void>,
  checkCancel: () => boolean,
) {
  if (!hostClient) throw new Error('Host API not set');
  const sourceHandle = await hostClient.getFileHandleByPath(sourcePath);
  if (!sourceHandle) throw new Error('Source file not found');
  const targetHandle = await hostClient.getFileHandleByPath(targetPath);
  if (!targetHandle) throw new Error('Target file handle not found');

  const sourceFile = await runResilientWorkerFileIo(sourceHandle, () => sourceHandle.getFile());
  const {
    Input,
    BlobSource,
    ALL_FORMATS,
    Output,
    StreamTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
    MkvOutputFormat,
    EncodedAudioPacketSource,
    EncodedPacketSink,
  } = await import('mediabunny');

  const input = new Input({
    source: new BlobSource(governedBlobWorker(sourceFile)),
    formats: ALL_FORMATS,
  } as ConstructorParameters<typeof Input>[0]);

  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) throw new Error('No audio track found in source file');

  const inputCodecStr = (await audioTrack.getCodecParameterString()) || audioTrack.codec || '';
  const lowercaseCodec = inputCodecStr.toLowerCase();

  let format: unknown;
  if (lowercaseCodec.startsWith('mp4a') || lowercaseCodec.includes('aac')) {
    format = new Mp4OutputFormat();
  } else if (lowercaseCodec.includes('opus')) {
    format = new WebMOutputFormat();
  } else {
    format = new MkvOutputFormat();
  }

  const release = await acquireStreamingWorkerFileIoSlot();
  try {
    const writable = await (
      targetHandle as unknown as {
        createWritable: (opts?: {
          keepExistingData?: boolean;
        }) => Promise<{ abort?: () => Promise<void> }>;
      }
    ).createWritable({ keepExistingData: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = new StreamTarget(writable as any, { chunked: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = new Output({ target, format: format as any });

    // Fallback if missing decoderConfig in audioTrack extraction
    const decoderConfig = await audioTrack.getDecoderConfig();

    const packetSource = new EncodedAudioPacketSource(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getBunnyAudioCodec((lowercaseCodec === 'mulaw' ? 'alaw' : lowercaseCodec) as any) as any,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (output as any).addAudioTrack(packetSource);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (output as any).start();
    const packetSink = new EncodedPacketSink(audioTrack);

    let isFirstPacket = true;
    for await (const packet of packetSink.packets()) {
      if (checkCancel()) {
        const err = new Error('Extraction cancelled');
        (err as Error).name = 'AbortError';
        throw err;
      }
      if (isFirstPacket) {
        await packetSource.add(packet, { decoderConfig: decoderConfig || undefined });
        isFirstPacket = false;
      } else {
        await packetSource.add(packet);
      }
    }

    const closeFn = (packetSource as { close?: () => void }).close;
    if (typeof closeFn === 'function') {
      closeFn.call(packetSource);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (output as any).finalize();
  } catch (err) {
    log.error('[Worker Export] Failed to extract audio:', err);
    throw err;
  } finally {
    release();
    safeDispose(input);
  }
}
