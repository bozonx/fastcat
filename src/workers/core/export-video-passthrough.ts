import { ticksToSeconds } from '~/utils/time';
import { createDevLogger } from '~/utils/dev-logger';
import type { WorkerVideoPayloadItem } from '~/types/worker-payload';
import { getBunnyVideoCodec } from './utils';

const log = createDevLogger('ExportVideoPassthrough');

/**
 * Video passthrough: when the export renders one unmodified source video (no
 * effects/transform/speed, matching codec/resolution/fps), copy the encoded
 * packets instead of decoding + compositing + re-encoding every frame. This
 * mirrors the audio Opus passthrough; unlike the native "direct" fast path
 * (which still re-encodes via ffmpeg) this is a true stream copy.
 *
 * v2 trim support:
 * - head trim is allowed when the trim point lands on a keyframe (within half
 *   a frame) — the copy then starts at that keyframe and timestamps shift to
 *   zero. A mid-GOP head trim falls back to re-encode: packets before the cut
 *   would be needed as references but must not be shown, and splicing a
 *   re-encoded head GOP onto copied packets would need a second decoder config.
 * - tail trim is always allowed: a metadata-only prescan (no packet data reads)
 *   finds the last decode-order packet whose presentation time is inside the
 *   range, and everything up to it is copied. Forward references that display
 *   past the cut are kept (dropping them would corrupt trailing B-frames), so
 *   the output may run a reorder-window (~2–4 frames) longer than requested —
 *   never a whole GOP.
 */

/** Frame-ish tolerance for duration comparisons (one 24fps frame). */
const DURATION_EPSILON_US = 42_000;

/** How far the source bitrate may exceed the requested one before passthrough
 * would violate the user's compression intent and we re-encode instead. */
const BITRATE_TOLERANCE = 1.25;

/**
 * How far (s) past the trim end the metadata prescan keeps scanning for
 * late-decode-order packets that still display inside the range. Frame
 * reordering windows are a handful of frames; anything beyond this is
 * pathological and simply loses those frames at the cut.
 */
const TAIL_SCAN_LOOKAHEAD_S = 2;

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

/**
 * Timeline end (µs) of the video payload, computed purely from the payload so
 * the passthrough decision can run before (and instead of) the compositor's
 * `loadTimeline`.
 */
export function computePayloadVideoEndUs(timelineClips: readonly WorkerVideoPayloadItem[]): number {
  let end = 0;
  for (const item of timelineClips) {
    if (!item || typeof item !== 'object' || item.kind !== 'clip') continue;
    const start = Number(item.timelineRange?.startUs ?? 0);
    const duration = Number(item.timelineRange?.durationUs ?? 0);
    if (Number.isFinite(start) && Number.isFinite(duration)) {
      end = Math.max(end, start + duration);
    }
  }
  return end;
}

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
 * source-level checks (codec/resolution/fps/bitrate/keyframe alignment) happen
 * later in {@link buildPassthroughVideoTrack}.
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

  // With speed 1 the timeline and source windows must agree; a mismatch means
  // some engine-side stretching/holding would happen that a copy can't express.
  const sourceRangeDurationUs = Number(clip.sourceRange?.durationUs ?? 0);
  if (Math.abs(sourceRangeDurationUs - timelineDurationUs) > DURATION_EPSILON_US) {
    return { ok: false, reason: 'timeline and source windows disagree' };
  }
  if (!(sourceRangeDurationUs > 0)) {
    return { ok: false, reason: 'empty source range' };
  }

  return { ok: true, clip };
}

interface PacketLike {
  timestamp: number;
  duration: number;
  type?: string;
  clone: (options: { timestamp: number }) => unknown;
}

export interface PassthroughPacketSink {
  getKeyPacket: (
    timestampS: number,
    options?: { verifyKeyPackets?: boolean },
  ) => Promise<PacketLike | null>;
  packets: (
    startPacket?: PacketLike,
    endPacket?: PacketLike,
    options?: { metadataOnly?: boolean },
  ) => AsyncIterable<PacketLike>;
}

export interface VideoPassthroughState {
  videoSource: {
    add: (packet: unknown, meta?: { decoderConfig?: unknown }) => Promise<void>;
  };
  packetSink: PassthroughPacketSink;
  decoderConfig: unknown;
  /** Keyframe the copy starts from (source time domain). */
  startPacket: PacketLike;
  /** Source-domain copy window; timestamps shift by `-copyStartS` on write. */
  copyStartS: number;
  copyEndS: number;
  /** True when the tail is untrimmed — the whole stream from `startPacket` is
   * copied without the metadata prescan. */
  wholeStream: boolean;
  input: unknown;
}

interface HostClientLike {
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath?: (path: string) => Promise<File | null>;
}

/**
 * Opens the source and validates the source-level passthrough gates: codec
 * family must match the requested output codec, resolution/rotation/fps must
 * match the requested output, the source bitrate must not exceed the requested
 * one beyond {@link BITRATE_TOLERANCE}, and a head trim must land on a
 * keyframe. Returns `null` (with a logged reason) to fall back to re-encode.
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
    makePacketSink: (track: unknown) => PassthroughPacketSink;
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

    const packetSink = makePacketSink(videoTrack);
    const sourceStartS = Math.max(0, ticksToSeconds(Number(clip.sourceRange?.startUs ?? 0)));
    const requestedEndS =
      sourceStartS + Math.max(0, ticksToSeconds(Number(clip.sourceRange?.durationUs ?? 0)));
    const halfFrameS = 1 / (2 * requestedFps);

    // Head trim must land on a keyframe: the copy has to start at one, and
    // starting earlier would show frames the user cut away.
    const startPacket = await packetSink.getKeyPacket(sourceStartS + halfFrameS, {
      verifyKeyPackets: true,
    });
    if (!startPacket) {
      return bail('no keyframe at or before the trim start');
    }
    if (Math.abs(startPacket.timestamp - sourceStartS) > halfFrameS) {
      return bail(
        `head trim at ${sourceStartS.toFixed(3)}s is not keyframe-aligned (nearest key at ${startPacket.timestamp.toFixed(3)}s)`,
      );
    }
    const copyStartS = startPacket.timestamp;
    const copyEndS = copyStartS + (requestedEndS - sourceStartS);

    const trackDurationS = await videoTrack.computeDuration();
    const wholeStream = copyEndS >= trackDurationS - halfFrameS * 2;

    log.info(
      `video passthrough ENABLED: copying ${requestedCodec} stream ` +
        `[${copyStartS.toFixed(3)}s..${wholeStream ? 'end' : `${copyEndS.toFixed(3)}s`}] ` +
        `(${options.width}x${options.height} @ ${sourceFps.toFixed(3)}fps, ~${Math.round(stats.averageBitrate / 1000)}kbps)`,
    );
    return {
      videoSource: makeVideoSource(requestedCodec),
      packetSink,
      decoderConfig,
      startPacket,
      copyStartS,
      copyEndS,
      wholeStream,
      input,
    };
  } catch (error) {
    dispose(input);
    throw error;
  }
}

/**
 * Metadata-only prescan for a tail-trimmed copy: walks decode order from the
 * start keyframe and returns the index of the last packet that still displays
 * inside the copy window. Everything up to that index must be copied — packets
 * past the window that sit before it in decode order are forward references
 * for in-window B-frames and dropping them would corrupt the tail.
 */
export async function findLastNeededPacketIndex(params: {
  packetSink: PassthroughPacketSink;
  startPacket: PacketLike;
  copyEndS: number;
}): Promise<number> {
  const { packetSink, startPacket, copyEndS } = params;
  let lastNeeded = -1;
  let index = 0;
  for await (const packet of packetSink.packets(startPacket, undefined, { metadataOnly: true })) {
    if (packet.timestamp < copyEndS - 1e-6) {
      lastNeeded = index;
    } else if (packet.timestamp >= copyEndS + TAIL_SCAN_LOOKAHEAD_S) {
      // Reorder windows are a handful of frames; nothing this far past the cut
      // can still display inside the window.
      break;
    }
    index++;
  }
  return lastNeeded;
}

/**
 * Copies the packet stream (decode order) from the start keyframe, shifting
 * presentation timestamps so the copy window starts at zero.
 */
export async function writeVideoPassthrough(params: {
  state: VideoPassthroughState;
  ensureNotCancelled: () => void;
  onProgress?: (progress: number) => void;
  disposeInput: (input: unknown) => void;
}): Promise<void> {
  const { state, ensureNotCancelled, onProgress, disposeInput } = params;
  const { copyStartS, copyEndS } = state;
  const copyDurationS = Math.max(0, copyEndS - copyStartS);
  let isFirstPacket = true;
  try {
    const lastNeededIndex = state.wholeStream
      ? Number.POSITIVE_INFINITY
      : await findLastNeededPacketIndex({
          packetSink: state.packetSink,
          startPacket: state.startPacket,
          copyEndS,
        });
    if (lastNeededIndex < 0) {
      throw new Error('video passthrough: no packets inside the copy window');
    }

    let index = 0;
    for await (const packet of state.packetSink.packets(state.startPacket)) {
      if (index > lastNeededIndex) break;
      index++;
      ensureNotCancelled();
      const adjusted =
        copyStartS > 0 ? packet.clone({ timestamp: packet.timestamp - copyStartS }) : packet;
      if (isFirstPacket) {
        await state.videoSource.add(adjusted, {
          decoderConfig: state.decoderConfig as VideoDecoderConfig,
        });
        isFirstPacket = false;
      } else {
        await state.videoSource.add(adjusted);
      }
      if (copyDurationS > 0) {
        const packetEnd = packet.timestamp + packet.duration - copyStartS;
        onProgress?.(Math.min(1, Math.max(0, packetEnd / copyDurationS)));
      }
    }
    onProgress?.(1);
  } finally {
    disposeInput(state.input);
  }
}
