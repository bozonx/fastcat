import { createDevLogger } from '~/utils/dev-logger';
import type { WorkerVideoPayloadItem } from '~/types/worker-payload';
import { getBunnyVideoCodec } from './utils';

const log = createDevLogger('ExportVideoPassthrough');

/**
 * Video passthrough: when the export is a pure remux of one untouched source
 * video (no edits, matching codec/resolution/fps), copy the encoded packets
 * instead of decoding + compositing + re-encoding every frame. This mirrors the
 * audio Opus passthrough and the native "direct" fast path in spirit; unlike
 * the native path (which still re-encodes via ffmpeg) this is a true stream
 * copy.
 *
 * v1 deliberately requires FULL source coverage (no head or tail trim): the
 * packet stream is then copied whole in decode order, which is trivially
 * correct with B-frames and open GOPs. Keyframe-aligned trims are a possible
 * follow-up, but require GOP-boundary reasoning on both ends.
 */

/** Frame-ish tolerance for duration comparisons (one 24fps frame). */
const DURATION_EPSILON_US = 42_000;

/** How far the source bitrate may exceed the requested one before passthrough
 * would violate the user's compression intent and we re-encode instead. */
const BITRATE_TOLERANCE = 1.25;

interface PassthroughExportOptions {
  videoCodec: string;
  format: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  exportAlpha?: boolean;
  videoPassthrough?: boolean;
}

type PayloadClip = Extract<WorkerVideoPayloadItem, { kind: 'clip' }>;

function isDefaultTransform(transform: unknown): boolean {
  if (transform === undefined || transform === null) return true;
  if (typeof transform !== 'object') return false;
  const t = transform as Record<string, unknown>;
  const num = (key: string, fallback: number) => {
    const value = Number(t[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  if (Math.abs(num('x', 0)) > 1e-6 || Math.abs(num('y', 0)) > 1e-6) return false;
  if (Math.abs(num('scale', 1) - 1) > 1e-6) return false;
  if (Math.abs(num('scaleX', 1) - 1) > 1e-6 || Math.abs(num('scaleY', 1) - 1) > 1e-6) return false;
  if (Math.abs(num('rotation', 0)) > 1e-6) return false;
  const crop = t.crop as Record<string, unknown> | undefined | null;
  if (crop && typeof crop === 'object') {
    for (const side of ['left', 'top', 'right', 'bottom']) {
      if (Math.abs(Number(crop[side] ?? 0)) > 1e-6) return false;
    }
  }
  return true;
}

function hasEnabledVideoEffects(clip: PayloadClip): boolean {
  const effects = (clip as { effects?: { target?: string; enabled?: boolean }[] }).effects;
  if (!Array.isArray(effects)) return false;
  return effects.some((e) => e && e.target !== 'audio' && e.enabled !== false);
}

/**
 * Pure eligibility gate over the timeline payload. Runs before any file I/O;
 * source-level checks (codec/resolution/fps/bitrate) happen later in
 * {@link buildPassthroughVideoTrack}.
 */
export function findVideoPassthroughCandidate(params: {
  timelineClips: readonly WorkerVideoPayloadItem[];
  options: PassthroughExportOptions;
  /** Full container duration (video + audio) in µs. */
  maxDurationUs: number;
}): { ok: true; clip: PayloadClip } | { ok: false; reason: string } {
  const { timelineClips, options, maxDurationUs } = params;
  if (options.videoPassthrough === false) {
    return { ok: false, reason: 'disabled by option' };
  }
  if (options.videoCodec === 'none') {
    return { ok: false, reason: 'video disabled' };
  }
  if (options.exportAlpha) {
    return { ok: false, reason: 'alpha export' };
  }

  const clips: PayloadClip[] = [];
  for (const item of timelineClips) {
    if (!item || typeof item !== 'object') continue;
    if (item.kind === 'meta') {
      if (Array.isArray(item.masterEffects) && item.masterEffects.length > 0) {
        return { ok: false, reason: 'timeline has master effects' };
      }
      continue;
    }
    if (item.kind === 'track') {
      if (Array.isArray(item.effects) && item.effects.length > 0) {
        return { ok: false, reason: 'a track has effects' };
      }
      const opacity = item.opacity;
      if (typeof opacity === 'number' && Math.abs(opacity - 1) > 1e-6) {
        return { ok: false, reason: 'a track has non-unit opacity' };
      }
      continue;
    }
    clips.push(item);
  }

  if (clips.length !== 1) {
    return { ok: false, reason: `timeline has ${clips.length} visible clips` };
  }
  const clip = clips[0]!;
  if (clip.clipType !== 'media' || !clip.source?.path) {
    return { ok: false, reason: 'the clip is not a media file' };
  }
  const speed = Number(clip.speed ?? 1);
  if (speed !== 1) {
    return { ok: false, reason: 'clip speed is not 1' };
  }
  if (typeof clip.freezeFrameSourceUs === 'number') {
    return { ok: false, reason: 'clip is a freeze frame' };
  }
  const opacity = clip.opacity;
  if (typeof opacity === 'number' && Math.abs(opacity - 1) > 1e-6) {
    return { ok: false, reason: 'clip has non-unit opacity' };
  }
  if (clip.blendMode && clip.blendMode !== 'normal') {
    return { ok: false, reason: 'clip has a blend mode' };
  }
  if (hasEnabledVideoEffects(clip)) {
    return { ok: false, reason: 'clip has video effects' };
  }
  if (clip.mask) {
    return { ok: false, reason: 'clip has a mask' };
  }
  if (!isDefaultTransform(clip.transform)) {
    return { ok: false, reason: 'clip has a transform/crop' };
  }
  const animations = clip.animations as { keyframes?: unknown[] } | unknown[] | undefined;
  const hasAnimations = Array.isArray(animations)
    ? animations.length > 0
    : animations && typeof animations === 'object' && Object.keys(animations).length > 0;
  if (hasAnimations) {
    return { ok: false, reason: 'clip has keyframe animations' };
  }
  if (clip.transitionIn || clip.transitionOut) {
    return { ok: false, reason: 'clip has transitions' };
  }
  const orientation = Number(
    (clip.sourceOrientation as { rotate?: number } | undefined)?.rotate ??
      clip.sourceOrientation ??
      0,
  );
  if (Number.isFinite(orientation) && orientation !== 0) {
    return { ok: false, reason: 'clip has source orientation rotation' };
  }

  const timelineStartUs = Number(clip.timelineRange?.startUs ?? 0);
  const timelineDurationUs = Number(clip.timelineRange?.durationUs ?? 0);
  if (timelineStartUs > DURATION_EPSILON_US) {
    return { ok: false, reason: 'clip does not start at timeline zero' };
  }
  if (timelineDurationUs + DURATION_EPSILON_US < maxDurationUs) {
    return { ok: false, reason: 'clip does not cover the whole export' };
  }

  const sourceStartUs = Number(clip.sourceRange?.startUs ?? 0);
  const sourceRangeDurationUs = Number(clip.sourceRange?.durationUs ?? 0);
  const sourceDurationUs = Number(clip.sourceDurationUs ?? 0);
  if (sourceStartUs > 0) {
    return { ok: false, reason: 'clip head is trimmed' };
  }
  if (!(sourceDurationUs > 0) || sourceRangeDurationUs + DURATION_EPSILON_US < sourceDurationUs) {
    return { ok: false, reason: 'clip tail is trimmed' };
  }

  return { ok: true, clip };
}

export interface VideoPassthroughState {
  videoSource: {
    add: (packet: unknown, meta?: { decoderConfig?: unknown }) => Promise<void>;
  };
  packetSink: {
    packets: () => AsyncIterable<unknown>;
  };
  decoderConfig: unknown;
  durationS: number;
  input: { dispose?: () => void } | unknown;
}

interface HostClientLike {
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath?: (path: string) => Promise<File | null>;
}

/**
 * Opens the source and validates the source-level passthrough gates: codec
 * family must match the requested output codec, resolution/rotation/fps must
 * match the requested output, and the source bitrate must not exceed the
 * requested one beyond {@link BITRATE_TOLERANCE} (the user asked for
 * compression). Returns `null` (with a logged reason) to fall back to the
 * re-encode path.
 */
export async function buildPassthroughVideoTrack(params: {
  clip: PayloadClip;
  options: PassthroughExportOptions;
  hostClient: HostClientLike | null;
  getFile: (path: string, handle: FileSystemFileHandle) => Promise<File>;
  openInput: (file: File) => Promise<{
    input: unknown;
    videoTrack: {
      codec: string | null;
      displayWidth: number;
      displayHeight: number;
      rotation: number;
      getDecoderConfig: () => Promise<unknown>;
      computePacketStats: (count?: number) => Promise<{
        averagePacketRate: number;
        averageBitrate: number;
      }>;
      computeDuration: () => Promise<number>;
    } | null;
    makePacketSink: (track: unknown) => { packets: () => AsyncIterable<unknown> };
    makeVideoSource: (codec: string) => VideoPassthroughState['videoSource'];
    dispose: (input: unknown) => void;
  }>;
}): Promise<VideoPassthroughState | null> {
  const { clip, options, hostClient } = params;
  const sourcePath = clip.source?.path;
  if (!sourcePath || !hostClient) return null;

  const fileHandle = await hostClient.getFileHandleByPath(sourcePath);
  if (!fileHandle) return null;
  const file = await params.getFile(sourcePath, fileHandle);

  const { input, videoTrack, makePacketSink, makeVideoSource, dispose } =
    await params.openInput(file);
  const bail = (reason: string) => {
    log.info(`video passthrough disabled: ${reason}`);
    dispose(input);
    return null;
  };

  try {
    if (!videoTrack) return bail('source has no video track');

    const requestedCodec = getBunnyVideoCodec(options.videoCodec);
    if (!videoTrack.codec || videoTrack.codec !== requestedCodec) {
      return bail(`source codec ${videoTrack.codec} != requested ${requestedCodec}`);
    }
    if (videoTrack.rotation !== 0) {
      return bail(`source carries rotation ${videoTrack.rotation}`);
    }
    if (videoTrack.displayWidth !== options.width || videoTrack.displayHeight !== options.height) {
      return bail(
        `source ${videoTrack.displayWidth}x${videoTrack.displayHeight} != requested ${options.width}x${options.height}`,
      );
    }

    const stats = await videoTrack.computePacketStats(100);
    const sourceFps = stats.averagePacketRate;
    const requestedFps = Math.max(1, Number(options.fps) || 30);
    if (!(sourceFps > 0) || Math.abs(sourceFps - requestedFps) / requestedFps > 0.005) {
      return bail(`source fps ${sourceFps?.toFixed(3)} != requested ${requestedFps}`);
    }
    const requestedBitrate = Number(options.bitrate);
    if (
      Number.isFinite(requestedBitrate) &&
      requestedBitrate > 0 &&
      stats.averageBitrate > requestedBitrate * BITRATE_TOLERANCE
    ) {
      return bail(
        `source bitrate ${Math.round(stats.averageBitrate)} exceeds requested ${requestedBitrate}`,
      );
    }

    const decoderConfig = await videoTrack.getDecoderConfig();
    if (!decoderConfig) {
      return bail('source decoder config unavailable');
    }
    const durationS = await videoTrack.computeDuration();

    log.info(
      `video passthrough ENABLED: copying ${requestedCodec} stream (${options.width}x${options.height} @ ${sourceFps.toFixed(3)}fps, ~${Math.round(stats.averageBitrate / 1000)}kbps)`,
    );
    return {
      videoSource: makeVideoSource(requestedCodec),
      packetSink: makePacketSink(videoTrack),
      decoderConfig,
      durationS,
      input,
    };
  } catch (error) {
    dispose(input);
    throw error;
  }
}

/**
 * Copies the whole packet stream (decode order, timestamps unchanged — the
 * eligibility gate guarantees an untrimmed clip starting at timeline zero).
 */
export async function writeVideoPassthrough(params: {
  state: VideoPassthroughState;
  ensureNotCancelled: () => void;
  onProgress?: (progress: number) => void;
  disposeInput: (input: unknown) => void;
}): Promise<void> {
  const { state, ensureNotCancelled, onProgress, disposeInput } = params;
  let isFirstPacket = true;
  try {
    for await (const packetRaw of state.packetSink.packets()) {
      ensureNotCancelled();
      const packet = packetRaw as { timestamp?: number; duration?: number };
      if (isFirstPacket) {
        await state.videoSource.add(packetRaw, {
          decoderConfig: state.decoderConfig as VideoDecoderConfig,
        });
        isFirstPacket = false;
      } else {
        await state.videoSource.add(packetRaw);
      }
      if (state.durationS > 0) {
        const packetEnd = Number(packet.timestamp || 0) + Number(packet.duration || 0);
        onProgress?.(Math.min(1, Math.max(0, packetEnd / state.durationS)));
      }
    }
    onProgress?.(1);
  } finally {
    disposeInput(state.input);
  }
}
