import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { VideoCompositor } from '../../utils/video-editor/VideoCompositor';
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
import { initEffects } from '../../effects';
import { initTransitions } from '../../transitions';
import {
  getMediaTypeFromFilename,
  getMimeTypeFromFilename,
  BROWSER_NATIVE_IMAGE_EXTENSIONS,
} from '../../utils/media-types';
import type { ExportOptions, WorkerTimelineClip } from '~/composables/timeline/export/types';
import type { MediaMetadata } from '~/stores/media.store';

export async function extractMetadata(
  fileOrHandle: File | FileSystemFileHandle,
): Promise<MediaMetadata> {
  const file =
    fileOrHandle instanceof File
      ? fileOrHandle
      : await (fileOrHandle as FileSystemFileHandle).getFile();

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
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const source = new BlobSource(file);
    const input = new Input({ source, formats: ALL_FORMATS } as unknown);

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
        const canDecodeVideo = await vTrack.canDecode();

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
          colorSpace: colorSpace as unknown,
          canDecode: canDecodeVideo,
        };
      }

      if (aTrack) {
        const stats = await aTrack.computePacketStats(100);
        const codecParam = await aTrack.getCodecParameterString();
        const canDecodeAudio = await aTrack.canDecode();
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
    console.warn(
      '[Worker Export] Failed to extract metadata (unsupported format):',
      (err as Error)?.message,
    );
    throw err;
  }
}

function isOpusCodec(codec: string | undefined): boolean {
  const value = String(codec ?? '').toLowerCase();
  return value.startsWith('opus');
}

function buildMetadataTags(
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

async function waitForVideoBackpressure(videoSource: { encodeQueueSize?: number }) {
  const maxQueueSize = 4;

  while (Number(videoSource?.encodeQueueSize ?? 0) >= maxQueueSize) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function fillCanvasBlack(canvas: OffscreenCanvas | HTMLCanvasElement | undefined | null) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
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
  const transitionIn = clip.transitionIn ?? fastcat.transitionIn;
  const transitionOut = clip.transitionOut ?? fastcat.transitionOut;
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
  // Output sampleRate/channels are checked once we have decoder info; we still
  // record the request for the caller to compare against.
  return { ok: true };
}

async function buildPassthroughAudioTrack(params: {
  clip: PassthroughClip;
  hostClient: VideoCoreHostAPI | null;
  reportExportWarning: (message: string) => Promise<void>;
  options: { audioSampleRate?: number; audioChannels?: 'mono' | 'stereo' };
}) {
  const { clip, hostClient, reportExportWarning, options } = params;
  const sourcePath = clip.sourcePath || clip.source?.path;
  if (!sourcePath || !hostClient) return null;

  const fileHandle = clip.fileHandle || (await hostClient.getFileHandleByPath(sourcePath));
  if (!fileHandle) return null;

  const file = (await hostClient.getFileByPath?.(sourcePath)) ?? (await fileHandle.getFile());
  const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink, EncodedAudioPacketSource } =
    await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS } as unknown);

  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) return null;

    const codecParam = await audioTrack.getCodecParameterString();
    const codec = codecParam || audioTrack.codec || '';
    if (!isOpusCodec(codec)) return null;

    const requestedSampleRate = Number(options.audioSampleRate) || 48000;
    const requestedChannels = options.audioChannels === 'mono' ? 1 : 2;
    const sourceSampleRate =
      Number((audioTrack as unknown as { sampleRate?: number }).sampleRate) || 0;
    const sourceChannels =
      Number((audioTrack as unknown as { numberOfChannels?: number }).numberOfChannels) || 0;
    if (sourceSampleRate > 0 && sourceSampleRate !== requestedSampleRate) {
      await reportExportWarning(
        `[Worker Export] Opus passthrough disabled: source sample rate ${sourceSampleRate}Hz differs from requested ${requestedSampleRate}Hz.`,
      );
      safeDispose(input);
      return null;
    }
    if (sourceChannels > 0 && sourceChannels !== requestedChannels) {
      await reportExportWarning(
        `[Worker Export] Opus passthrough disabled: source has ${sourceChannels} channel(s); requested ${requestedChannels}.`,
      );
      safeDispose(input);
      return null;
    }

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

export async function runExport(
  targetHandle: FileSystemFileHandle,
  options: ExportOptions,
  timelineClips: import('~/composables/timeline/export/types').WorkerVideoPayloadItem[],
  audioClips: WorkerTimelineClip[],
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (msg: string, taskId?: string) => Promise<void>,
  checkCancel: () => boolean,
  taskId?: string,
  rendererPreference: 'webgl' | 'webgpu' = 'webgl',
) {
  initEffects();
  initTransitions();

  const { Output, Mp4OutputFormat, WebMOutputFormat, MkvOutputFormat, CanvasSource, StreamTarget } =
    await import('mediabunny');

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

  async function createOutput(params: { format: unknown }): Promise<{
    output: {
      cancel?: () => Promise<void>;
      setMetadataTags?: (tags: Record<string, unknown>) => void;
    };
    writable: { abort?: () => Promise<void> };
  }> {
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
    const output = new Output({ target, format: params.format });
    return { output, writable };
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
      for await (const packet of packetSink.packets()) {
        ensureNotCancelled();
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
        const adjustedPacket = packet.clone({ timestamp: adjustedTimestamp });
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
    taskId?: string;
  }) {
    const fps = Math.max(1, Number(params.fps) || 30);
    const totalFrames = computeExportTotalFrames({ durationUs: params.durationUs, fps });

    let lastYieldAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let lastProgressAtMs = lastYieldAtMs;
    const yieldIntervalMs = 16;
    const progressIntervalMs = 250;

    let emptyFrameCount = 0;
    let firstEmptyFrameTimestampS: number | null = null;

    for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
      ensureNotCancelled();

      const frame = getExportFrameTiming({
        frameNum,
        totalFrames,
        durationUs: params.durationUs,
        fps,
      });
      const generatedCanvas = await params.compositor.renderFrame(frame.timeUs);
      if (!generatedCanvas) {
        fillCanvasBlack(params.compositor.canvas);
        if (emptyFrameCount === 0) {
          firstEmptyFrameTimestampS = frame.timestampS;
        }
        emptyFrameCount++;
      }
      await waitForVideoBackpressure(params.videoSource);
      await params.videoSource.add(frame.timestampS, frame.durationS);

      const progress = Math.min(99, Math.round(((frameNum + 1) / totalFrames) * 99));
      const nowProgressMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const shouldReport =
        frameNum + 1 === totalFrames || nowProgressMs - lastProgressAtMs >= progressIntervalMs;
      if (hostClient && shouldReport) {
        lastProgressAtMs = nowProgressMs;
        await hostClient.onExportProgress(progress, params.taskId);
      }

      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (nowMs - lastYieldAtMs >= yieldIntervalMs) {
        lastYieldAtMs = nowMs;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    if (emptyFrameCount > 0) {
      await reportExportWarning(
        `[Worker Export] ${emptyFrameCount} frame(s) rendered empty (first at ${firstEmptyFrameTimestampS?.toFixed(3) ?? '0'}s); substituted with black.`,
      );
    }
  }

  const localCompositor = new VideoCompositor();
  await localCompositor.init(options.width, options.height, '#000', true, undefined, {
    rendererPreference,
  });

  try {
    const maxVideoDurationUs = await localCompositor.loadTimeline(
      timelineClips,
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

    const maxAudioDurationUs = options.audio ? computeMaxAudioDurationUs(audioClips) : 0;

    const maxDurationUs = Math.max(maxVideoDurationUs, maxAudioDurationUs);

    if (maxDurationUs <= 0) throw new Error('No clips to export');

    const durationS = usToS(maxDurationUs);
    const hasAnyAudio = options.audio && audioClips.length > 0;

    const format =
      options.format === 'webm'
        ? new WebMOutputFormat()
        : options.format === 'mkv'
          ? new MkvOutputFormat()
          : new Mp4OutputFormat();

    async function runExportWithHardwareAcceleration(
      preference: 'prefer-hardware' | 'prefer-software',
      fallbackCodecString = true,
    ) {
      await notifyPhase('encoding', taskId);

      const { output, writable } = await createOutput({ format });

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

      const formatSupportsAlpha = options.format === 'webm' || options.format === 'mkv';
      if (options.exportAlpha && !formatSupportsAlpha) {
        await reportExportWarning(
          `[Worker Export] Alpha channel is not supported by ${options.format.toUpperCase()}; exporting without alpha.`,
        );
      }

      const videoSource = new CanvasSource(localCompositor.canvas as unknown as HTMLCanvasElement, {
        codec: getBunnyVideoCodec(options.videoCodec),
        fullCodecString,
        bitrate: options.bitrate,
        alpha: options.exportAlpha && formatSupportsAlpha ? 'keep' : 'discard',
        bitrateMode: options.bitrateMode === 'constant' ? 'constant' : 'variable',
        keyFrameInterval,
        hardwareAcceleration: preference,
      });
      output.addVideoTrack(videoSource);

      let audioSource: unknown = null;
      let writeMixedAudioToSource: (() => Promise<void>) | null = null;
      let audioPacketState: {
        audioSource: {
          add: (packet: unknown, opts?: { decoderConfig?: unknown }) => Promise<void>;
        };
        packetSink: { packets: () => AsyncIterable<unknown>; close?: () => void };
        decoderConfig: unknown;
        ranges: { timelineStartS: number; sourceStartS: number; sourceEndS: number };
        input: unknown;
      } | null = null;
      if (options.audio && hasAnyAudio) {
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
              options,
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
      }

      let finalized = false;
      try {
        await output.start();

        await writeOpusPassthroughIfNeeded({ audioPacketState });

        if (audioSource && writeMixedAudioToSource) {
          await writeMixedAudioToSource();
        }

        await encodeFrames({
          durationUs: maxDurationUs,
          fps: options.fps,
          videoSource,
          compositor: localCompositor,
          taskId,
        });

        await notifyPhase('saving', taskId);

        await output.finalize();
        if (hostClient) {
          await hostClient.onExportProgress(100, taskId);
        }
        finalized = true;
      } finally {
        if (!finalized) {
          await safeCancel({ output, writable });
        }
        safeDispose(audioSource);
        safeDispose(videoSource);
      }
    }

    try {
      await runExportWithHardwareAcceleration('prefer-hardware', true);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      await reportExportWarning(
        '[Worker Export] Hardware acceleration export with exact profile failed, retrying with default HW profile.',
      );
      try {
        await runExportWithHardwareAcceleration('prefer-hardware', false);
      } catch (e2) {
        if (e2 instanceof Error && e2.name === 'AbortError') throw e2;
        await reportExportWarning(
          '[Worker Export] Hardware acceleration export failed completely, retrying with software.',
        );
        await runExportWithHardwareAcceleration('prefer-software', false);
      }
    }
  } finally {
    localCompositor.destroy();
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

  const sourceFile = await sourceHandle.getFile();
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

  const input = new Input({ source: new BlobSource(sourceFile), formats: ALL_FORMATS } as unknown);

  try {
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

    const writable = await (
      targetHandle as unknown as {
        createWritable: (opts?: {
          keepExistingData?: boolean;
        }) => Promise<{ abort?: () => Promise<void> }>;
      }
    ).createWritable({ keepExistingData: false });
    const target = new StreamTarget(writable, { chunked: true });
    const output = new Output({ target, format });

    // Fallback if missing decoderConfig in audioTrack extraction
    const decoderConfig = await audioTrack.getDecoderConfig();

    const packetSource = new EncodedAudioPacketSource(
      getBunnyAudioCodec(
        (lowercaseCodec === 'mulaw' ? 'alaw' : lowercaseCodec) as unknown,
      ) as unknown,
    );
    output.addAudioTrack(packetSource);

    await output.start();
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

    if (typeof (packetSource as { close?: () => void }).close === 'function') {
      (packetSource as { close?: () => void }).close();
    }
    await output.finalize();
  } catch (err) {
    console.error('[Worker Export] Failed to extract audio:', err);
    throw err;
  } finally {
    safeDispose(input);
  }
}
