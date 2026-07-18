import type { ConversionRequest } from '~/types/conversion';
import type { FsEntry } from '~/types/fs';
import type { MediaMetadata } from '~/types/media';

/** Default output rate when the source reports none. */
const CONFORM_FALLBACK_FPS = 30;
/** Bitrate (Mbps) used when the source doesn't report one. */
const CONFORM_FALLBACK_BITRATE_MBPS = 12;

/**
 * Builds the `ConversionRequest` that conforms a VFR source to constant frame rate
 * at `targetFps`, preserving resolution and (re-encoding to) a universally editable
 * codec. The native convert path applies `fps={fps}` + `-fps_mode cfr`, so the
 * output plays on a rigid grid — this is the C1 "conform to CFR" transcode. Kept
 * pure so it can be unit-tested without the file-manager/convert orchestration.
 */
export function buildConformConversionRequest(params: {
  entry: FsEntry;
  dirPath: string;
  outputFileName: string;
  metadata: MediaMetadata;
  targetFps: number;
}): ConversionRequest {
  const { entry, dirPath, outputFileName, metadata, targetFps } = params;
  const video = metadata.video;

  const fps = Number.isFinite(targetFps) && targetFps > 0 ? targetFps : CONFORM_FALLBACK_FPS;
  const width = Math.max(1, Math.round(Number(video?.displayWidth || video?.width) || 1));
  const height = Math.max(1, Math.round(Number(video?.displayHeight || video?.height) || 1));

  // Prefer the source bitrate so the conform doesn't visibly recompress; fall back
  // to a generous default. `bitrate` is bits/s in metadata → Mbps for the request.
  const sourceBitrateMbps =
    typeof video?.bitrate === 'number' && video.bitrate > 0
      ? video.bitrate / 1_000_000
      : CONFORM_FALLBACK_BITRATE_MBPS;

  const hasAudio = !!metadata.audio;
  const sampleRate =
    typeof metadata.audio?.sampleRate === 'number' && metadata.audio.sampleRate > 0
      ? metadata.audio.sampleRate
      : null;
  const channels =
    typeof metadata.audio?.channels === 'number' && metadata.audio.channels > 0
      ? Math.round(metadata.audio.channels)
      : 2;

  return {
    entry,
    type: 'video',
    dirPath,
    newFileName: outputFileName,
    sharedAudio: { channels, sampleRate },
    video: {
      format: 'mp4',
      // H.264 is universally decodable and re-editable; conform is a one-time
      // re-encode where compatibility matters more than preserving the exact codec.
      videoCodec: 'avc1',
      bitrateMbps: Math.max(1, Math.round(sourceBitrateMbps)),
      excludeAudio: !hasAudio,
      audioCodec: 'aac',
      audioBitrateKbps: 192,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      fastStart: true,
      width,
      height,
      fps,
    },
  };
}

/**
 * The conformed file's name: `<base>.cfr<fps>.mp4`, e.g. `clip.cfr60.mp4`. Stable
 * and self-describing so a repeat conform to the same rate reuses/overwrites rather
 * than piling up copies, and the origin stays obvious for relink-back.
 */
export function buildConformFileName(sourceBaseName: string, targetFps: number): string {
  const fpsLabel = Number.isFinite(targetFps) && targetFps > 0 ? Math.round(targetFps) : 30;
  const base = sourceBaseName.replace(/\.[^.]+$/, '') || 'clip';
  return `${base}.cfr${fpsLabel}.mp4`;
}
