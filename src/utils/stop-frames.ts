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

export interface BuildStopFrameFilenameParams {
  timelineName: string;
  timeUs: number;
  fps: number;
  suffix?: string;
  extension?: string;
}

export function buildStopFrameFilename(params: BuildStopFrameFilenameParams): string {
  const extension = (params.extension ?? 'webp').replace(/^\.+/, '') || 'webp';
  const safeTimeline = sanitizeBaseName(params.timelineName || 'timeline') || 'timeline';
  const tc = formatStopFrameTimecode({ timeUs: params.timeUs, fps: params.fps });

  const suffix =
    (typeof params.suffix === 'string' && params.suffix.trim().length > 0
      ? params.suffix.trim()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`) ||
    Date.now().toString(36);

  const safeSuffix = suffix.replace(/[^a-zA-Z0-9._-]+/g, '_');

  return `${safeTimeline}_${tc}_${safeSuffix}.${extension}`;
}
