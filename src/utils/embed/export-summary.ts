import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('embed-export-summary');

/** Poster width cap. Big enough for a card, small enough to post to a host. */
const POSTER_MAX_WIDTH = 1280;
/** Seconds into the render to grab the poster from; avoids fade-ins from black. */
const POSTER_TARGET_S = 0.5;

export interface EmbedExportMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
}

export interface EmbedExportSummary {
  meta: EmbedExportMeta;
  poster: Blob | null;
}

async function drawPoster(sample: unknown, width: number, height: number): Promise<Blob | null> {
  const imageSource =
    typeof VideoFrame !== 'undefined' && sample instanceof VideoFrame
      ? (sample as CanvasImageSource)
      : ((sample as { toCanvasImageSource?: () => CanvasImageSource }).toCanvasImageSource?.() ??
        null);
  if (!imageSource) return null;

  const scale = Math.min(1, POSTER_MAX_WIDTH / width);
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(imageSource, 0, 0, canvas.width, canvas.height);
  return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
}

/**
 * Describes a finished render for the host: its real dimensions and duration,
 * plus a poster frame.
 *
 * Read back off the exported file rather than off the export settings, so what
 * the host stores always matches what was actually produced — a codec that
 * adjusted dimensions or a range that ended early cannot leave the host with
 * numbers that disagree with the bytes. Failures here are non-fatal: a missing
 * poster is worth far less than the render itself.
 */
export async function summariseExport(file: File): Promise<EmbedExportSummary> {
  const meta: EmbedExportMeta = {
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    width: null,
    height: null,
    durationMs: null,
    fps: null,
  };

  try {
    const { Input, BlobSource, VideoSampleSink, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

    try {
      const durationSec = await input.computeDuration().catch(() => null);
      if (typeof durationSec === 'number' && Number.isFinite(durationSec)) {
        meta.durationMs = Math.round(durationSec * 1000);
      }

      const track = await input.getPrimaryVideoTrack().catch(() => null);
      if (!track) return { meta, poster: null };

      meta.width = track.displayWidth ?? null;
      meta.height = track.displayHeight ?? null;
      meta.fps =
        (await track.computePacketStats?.(100).then((s) => s?.averagePacketRate ?? null)) ?? null;

      if (!meta.width || !meta.height || !(await track.canDecode())) {
        return { meta, poster: null };
      }

      const sink = new VideoSampleSink(track);
      const target = Math.min(POSTER_TARGET_S, (meta.durationMs ?? 0) / 1000 / 2);
      const sample = (await sink.getSample(target)) ?? (await sink.getSample(0));
      const poster = sample ? await drawPoster(sample, meta.width, meta.height) : null;

      return { meta, poster };
    } finally {
      await input.dispose();
    }
  } catch (e) {
    log.warn('Failed to summarise the exported file', e);
    return { meta, poster: null };
  }
}
