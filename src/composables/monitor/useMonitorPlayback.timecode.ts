import { normalizeTimeUs, sanitizeFps } from '~/utils/monitor-time';

export function formatMonitorTimecode(params: { timeUs: number; fps: number }): string {
  if (!Number.isFinite(params.timeUs) || params.timeUs <= 0) {
    return '00:00:00:00';
  }

  const fps = sanitizeFps(params.fps);
  const totalFrames = Math.max(0, Math.floor((params.timeUs / 1e6) * fps));
  const framesPerHour = 3600 * fps;
  const framesPerMinute = 60 * fps;

  const hours = Math.floor(totalFrames / framesPerHour);
  const minutes = Math.floor((totalFrames % framesPerHour) / framesPerMinute);
  const seconds = Math.floor((totalFrames % framesPerMinute) / fps);
  const frames = totalFrames % fps;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const ff = String(frames).padStart(2, '0');

  return `${hh}:${mm}:${ss}:${ff}`;
}

export function buildMonitorTimecodeText(params: {
  currentTimeUs: number;
  durationUs: number;
  fps: number;
}): string {
  const current = formatMonitorTimecode({
    timeUs: params.currentTimeUs,
    fps: params.fps,
  });
  const total = formatMonitorTimecode({
    timeUs: normalizeTimeUs(params.durationUs),
    fps: params.fps,
  });

  return `${current} / ${total}`;
}

export function syncMonitorTimecodeText(params: {
  element: HTMLElement | null;
  currentTimeUs: number;
  durationUs: number;
  fps: number;
}) {
  if (!params.element) {
    return;
  }

  const nextText = buildMonitorTimecodeText({
    currentTimeUs: params.currentTimeUs,
    durationUs: params.durationUs,
    fps: params.fps,
  });

  if (params.element.textContent !== nextText) {
    params.element.textContent = nextText;
  }
}
