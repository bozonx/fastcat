import { normalizeTimeUs } from '~/utils/monitor-time';
import { formatTimecode } from '~/utils/timecode';

export function formatMonitorTimecode(params: { timeUs: number; fps: number }): string {
  if (!Number.isFinite(params.timeUs) || params.timeUs <= 0) {
    return '00:00:00:00';
  }

  return formatTimecode(params.timeUs, params.fps);
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
