import { usToFrame, sanitizeFps } from '~/timeline/commands/utils';

function sanitizeBaseName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface FormatStopFrameTimecodeParams {
  timeUs: number;
  fps: number;
}

export function formatStopFrameTimecode(params: FormatStopFrameTimecodeParams): string {
  const fps = sanitizeFps(params.fps);
  const frames = usToFrame(params.timeUs, fps, 'round');

  const framesPerHour = fps * 3600;
  const framesPerMinute = fps * 60;

  const hh = Math.floor(frames / framesPerHour);
  const mm = Math.floor((frames % framesPerHour) / framesPerMinute);
  const ss = Math.floor((frames % framesPerMinute) / fps);
  const ff = frames % fps;

  return `${String(hh).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(ss).padStart(2, '0')}-${String(ff).padStart(2, '0')}`;
}

export interface BuildStopFrameBaseNameParams {
  timelineName: string;
  timeUs: number;
  fps: number;
}

export function buildStopFrameBaseName(params: BuildStopFrameBaseNameParams): string {
  const safeTimeline = sanitizeBaseName(params.timelineName || 'timeline') || 'timeline';
  const tc = formatStopFrameTimecode({ timeUs: params.timeUs, fps: params.fps });
  return `${safeTimeline}_${tc}`;
}

export interface RenderExportFrameBlobParams {
  sourceCanvas: HTMLCanvasElement;
  exportWidth: number;
  exportHeight: number;
  quality: number;
  mimeType?: string;
  createCanvas?: () => HTMLCanvasElement;
}

export async function renderExportFrameBlob(params: RenderExportFrameBlobParams): Promise<Blob> {
  const width = Math.round(Number(params.exportWidth) || 0);
  const height = Math.round(Number(params.exportHeight) || 0);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('Invalid export resolution');
  }

  const quality = Math.max(0.01, Math.min(1, Number(params.quality) || 0.85));
  const mimeType = params.mimeType || 'image/webp';

  const targetCanvas = params.createCanvas
    ? params.createCanvas()
    : document.createElement('canvas');
  targetCanvas.width = width;
  targetCanvas.height = height;

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context is not available');
  }

  ctx.imageSmoothingEnabled = true;
  try {
    (ctx as any).imageSmoothingQuality = 'high';
  } catch {
    // ignore if not supported
  }

  ctx.drawImage(params.sourceCanvas, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    targetCanvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to create snapshot blob'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}
