import { computed, type Ref } from 'vue';
import { timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';

interface MarkerLike {
  id: string;
  timeUs: number;
  durationUs?: number;
  text?: string;
  color?: string;
}

interface SelectionRangeLike {
  startUs: number;
  endUs: number;
}

interface UseTimelineRulerPresentationOptions {
  width: Ref<number>;
  scrollLeft: Ref<number>;
  zoom: Ref<number>;
  fps: Ref<number>;
  currentTime: Ref<number>;
  markers: Ref<MarkerLike[]>;
  selectionRange: Ref<SelectionRangeLike | null | undefined>;
  hoveredMarkerId?: Ref<string | null>;
  draggedMarkerId?: Ref<string | null>;
}

export function truncateRulerTooltip(text: string): string {
  const normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const max = 160;
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

export function formatRulerTime(us: number, fpsValue: number): string {
  const totalFrames = Math.round((us / 1_000_000) * fpsValue);
  const ff = totalFrames % fpsValue;
  const totalSeconds = Math.floor(us / 1_000_000);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

export function useTimelineRulerPresentation(options: UseTimelineRulerPresentationOptions) {
  const markerPoints = computed(() => {
    const currentZoom = options.zoom.value;
    const startPx = options.scrollLeft.value;
    const visibleWidth = options.width.value;

    return options.markers.value
      .map((marker) => {
        const x = timeUsToPx(marker.timeUs, currentZoom) - startPx;
        const width =
          marker.durationUs !== undefined ? timeUsToPx(marker.durationUs, currentZoom) : 0;

        return {
          id: marker.id,
          x,
          width,
          isZone: marker.durationUs !== undefined,
          text: marker.text ?? '',
          color: marker.color ?? '#eab308',
        };
      })
      .filter(
        (point) =>
          (point.x >= -20 && point.x <= visibleWidth + 20) ||
          (point.isZone && point.x + point.width >= -20 && point.x <= visibleWidth + 20),
      );
  });

  const selectionRangePoint = computed(() => {
    const range = options.selectionRange.value;
    if (!range) return null;

    const currentZoom = options.zoom.value;
    const startPx = options.scrollLeft.value;
    const x = timeUsToPx(range.startUs, currentZoom) - startPx;
    const width = Math.max(1, timeUsToPx(range.endUs - range.startUs, currentZoom));

    return {
      x,
      width,
    };
  });

  const currentFrameHighlightStyle = computed(() => {
    const currentZoom = options.zoom.value;
    const currentFps = options.fps.value;
    const pxPerFrame = zoomToPxPerSecond(currentZoom) / currentFps;
    if (pxPerFrame < 6) return null;

    // Честная математика: currentTime округляется до целых микросекунд.
    // Добавляем 0.5 мкс (максимальную погрешность округления) для точного определения кадра.
    const currentFrameIndex = Math.floor(
      ((options.currentTime.value + 0.5) * currentFps) / 1_000_000,
    );
    const currentFrameStartUs = Math.round((currentFrameIndex * 1_000_000) / currentFps);
    const nextFrameStartUs = Math.round(((currentFrameIndex + 1) * 1_000_000) / currentFps);

    const currentFrameStartX =
      timeUsToPx(currentFrameStartUs, currentZoom) - options.scrollLeft.value;
    const nextFrameStartX = timeUsToPx(nextFrameStartUs, currentZoom) - options.scrollLeft.value;

    return {
      transform: `translate3d(${currentFrameStartX}px, 0, 0)`,
      width: `${Math.max(1, nextFrameStartX - currentFrameStartX)}px`,
    };
  });

  const playheadStyle = computed(() => {
    const playheadX = Math.round(
      timeUsToPx(options.currentTime.value, options.zoom.value) - options.scrollLeft.value,
    );
    return {
      transform: `translate3d(${playheadX}px, 0, 0)`,
    };
  });

  return {
    markerPoints,
    selectionRangePoint,
    currentFrameHighlightStyle,
    playheadStyle,
  };
}
