import { TICKS_PER_SECOND, formatTimecode } from '~/utils/time';
import { computed, type Ref } from 'vue';
import {
  absolutePxToViewportPx,
  timeUsToPx,
  timeUsToViewportPx,
  zoomToPxPerSecond,
} from '~/utils/timeline/geometry';

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
  return formatTimecode(us, fpsValue);
}

export function useTimelineRulerPresentation(options: UseTimelineRulerPresentationOptions) {
  const markerPoints = computed(() => {
    const currentZoom = options.zoom.value;
    const startPx = options.scrollLeft.value;
    const visibleWidth = options.width.value;

    return options.markers.value
      .map((marker) => {
        // Round both endpoints in absolute space (clip convention) so the ruler
        // pin/band aligns with the marker's vertical guide line in the tracks
        // overlay for any scrollLeft.
        const x = absolutePxToViewportPx(timeUsToPx(marker.timeUs, currentZoom), startPx);
        const width =
          marker.durationUs !== undefined
            ? absolutePxToViewportPx(
                timeUsToPx(marker.timeUs + marker.durationUs, currentZoom),
                startPx,
              ) - x
            : 0;

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
    const x = absolutePxToViewportPx(timeUsToPx(range.startUs, currentZoom), startPx);
    const endX = absolutePxToViewportPx(timeUsToPx(range.endUs, currentZoom), startPx);
    const width = Math.max(1, endX - x);

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

    // Exact math: currentTime is rounded to whole ticks.
    // Add 0.5 ticks (the max rounding error) to determine the frame precisely.
    const currentFrameIndex = Math.floor(
      ((options.currentTime.value + 0.5) * currentFps) / TICKS_PER_SECOND,
    );
    const currentFrameStartUs = Math.round((currentFrameIndex * TICKS_PER_SECOND) / currentFps);
    const nextFrameStartUs = Math.round(((currentFrameIndex + 1) * TICKS_PER_SECOND) / currentFps);

    const currentFrameStartX = timeUsToViewportPx(
      currentFrameStartUs,
      currentZoom,
      options.scrollLeft.value,
    );
    const nextFrameStartX = timeUsToViewportPx(
      nextFrameStartUs,
      currentZoom,
      options.scrollLeft.value,
    );

    return {
      transform: `translate3d(${currentFrameStartX}px, 0, 0)`,
      width: `${Math.max(1, nextFrameStartX - currentFrameStartX)}px`,
    };
  });

  const playheadStyle = computed(() => {
    const playheadX = timeUsToViewportPx(
      options.currentTime.value,
      options.zoom.value,
      options.scrollLeft.value,
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
