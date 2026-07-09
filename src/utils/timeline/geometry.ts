export const BASE_PX_PER_SECOND = 10;

export function zoomToPxPerSecond(zoom: number) {
  const parsed = Number(zoom);
  const safePos = Number.isFinite(parsed) ? parsed : 50;
  const pos = Math.min(110, Math.max(0, safePos));

  const exponent = (pos - 50) / 7;
  const factor = Math.pow(2, exponent);
  return BASE_PX_PER_SECOND * factor;
}

export function pxPerSecondToZoom(pps: number): number {
  return 7 * Math.log2(pps / BASE_PX_PER_SECOND) + 50;
}

export function timeUsToPx(timeUs: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return (timeUs / 1e6) * pxPerSecond;
}

export interface TimelinePixelRange {
  leftPx: number;
  widthPx: number;
  endPx: number;
}

export function timelineRangeToRoundedPx(
  range: { startUs: number; durationUs: number },
  zoom = 100,
  minWidthPx = 1,
): TimelinePixelRange {
  const leftPx = Math.round(timeUsToPx(range.startUs, zoom));
  const rawEndPx = Math.round(timeUsToPx(range.startUs + range.durationUs, zoom));
  const endPx = Math.max(leftPx + minWidthPx, rawEndPx);

  return {
    leftPx,
    widthPx: endPx - leftPx,
    endPx,
  };
}

export function pxToTimeUs(px: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return Math.max(0, Math.round((px / pxPerSecond) * 1e6));
}

/**
 * Project an absolute timeline pixel coordinate into the viewport.
 *
 * The single rounding convention shared by every horizontal element (clips,
 * ruler ticks, playhead, markers, selection range): round in *absolute* space
 * first, then subtract the raw scroll offset. Rounding the absolute coordinate
 * — rather than the post-scroll result — is what keeps a playhead, a marker
 * line and a clip edge that all sit on the same timeUs pixel-aligned with each
 * other for *any* `scrollLeft`, including the fractional values HiDPI trackpads
 * produce. Clips already do this via `timelineRangeToRoundedPx`; this helper
 * lets overlays match them exactly instead of computing `round(abs - scroll)`.
 */
export function absolutePxToViewportPx(absolutePx: number, scrollLeft: number): number {
  return Math.round(absolutePx) - scrollLeft;
}

/** Convenience wrapper: project a timeUs straight into viewport pixels. */
export function timeUsToViewportPx(timeUs: number, zoom: number, scrollLeft: number): number {
  return absolutePxToViewportPx(timeUsToPx(timeUs, zoom), scrollLeft);
}

export function quantizeTimeUsToPixelGrid(timeUs: number, zoom = 100) {
  return pxToTimeUs(Math.round(timeUsToPx(timeUs, zoom)), zoom);
}

/**
 * Clip-local X (px) for an overlay (volume plate, mute icon, …) that should
 * follow the timeline scroll so it stays visible, while gravitating toward the
 * clip's own centre. It centres on the *visible* intersection of the clip and
 * the viewport, clamped inside the clip (minus an optional padding). When the
 * whole clip is on screen the visible centre equals the clip centre, so the
 * overlay simply sits in the middle.
 */
export function computeClipCenteredOverlayLeftPx(params: {
  clipStartPx: number;
  clipWidthPx: number;
  scrollLeft?: number;
  viewportWidth?: number;
  paddingPx?: number;
}): number {
  const { clipStartPx, clipWidthPx, scrollLeft, viewportWidth, paddingPx = 0 } = params;
  const idealX = clipWidthPx / 2;

  if (scrollLeft === undefined || viewportWidth === undefined) return idealX;

  const clipEndPx = clipStartPx + clipWidthPx;
  const visibleStart = Math.max(clipStartPx, scrollLeft);
  const visibleEnd = Math.min(clipEndPx, scrollLeft + viewportWidth);
  if (visibleEnd <= visibleStart) return idealX;

  const localX = (visibleStart + visibleEnd) / 2 - clipStartPx;
  const maxX = Math.max(paddingPx, clipWidthPx - paddingPx);
  return Math.max(paddingPx, Math.min(maxX, localX));
}

export function pxToDeltaUs(px: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return Math.round((px / pxPerSecond) * 1e6);
}

export interface TimelineZoomAnchor {
  anchorTimeUs: number;
  anchorViewportX: number;
}

export function computeAnchoredScrollLeft(params: {
  prevZoom: number;
  nextZoom: number;
  prevScrollLeft: number;
  viewportWidth: number;
  anchor: TimelineZoomAnchor;
}): number {
  const { nextZoom, prevScrollLeft, viewportWidth, anchor } = params;

  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const safePrevScrollLeft = Number.isFinite(prevScrollLeft) ? Math.max(0, prevScrollLeft) : 0;

  const anchorTimeUs = Number.isFinite(anchor.anchorTimeUs)
    ? Math.max(0, Math.round(anchor.anchorTimeUs))
    : 0;
  const anchorViewportXRaw = Number.isFinite(anchor.anchorViewportX)
    ? anchor.anchorViewportX
    : safeViewportWidth / 2;
  const anchorViewportX = Math.min(safeViewportWidth, Math.max(0, anchorViewportXRaw));

  const anchorPxAtNextZoom = timeUsToPx(anchorTimeUs, nextZoom);
  const nextScrollLeft = anchorPxAtNextZoom - anchorViewportX;

  if (!Number.isFinite(nextScrollLeft)) return safePrevScrollLeft;
  return Math.max(0, nextScrollLeft);
}

export interface TimelinePlaybackAutoScrollParams {
  playheadPx: number;
  scrollLeft: number;
  viewportWidth: number;
  maxScrollLeft?: number;
  triggerRatio?: number;
  targetRatio?: number;
}

export function computeTimelinePlaybackAutoScrollLeft(
  params: TimelinePlaybackAutoScrollParams,
): number | null {
  const triggerRatio = params.triggerRatio ?? 0.85;
  const targetRatio = params.targetRatio ?? 0.3;
  const playheadPx = Number.isFinite(params.playheadPx) ? params.playheadPx : 0;
  const scrollLeft = Number.isFinite(params.scrollLeft) ? Math.max(0, params.scrollLeft) : 0;
  const viewportWidth = Number.isFinite(params.viewportWidth)
    ? Math.max(0, params.viewportWidth)
    : 0;

  if (viewportWidth <= 0) {
    return null;
  }

  const triggerPx = scrollLeft + viewportWidth * triggerRatio;
  if (playheadPx < triggerPx) {
    return null;
  }

  const rawNextScrollLeft = playheadPx - viewportWidth * targetRatio;
  const maxScrollLeft = Number.isFinite(params.maxScrollLeft)
    ? Math.max(0, params.maxScrollLeft ?? 0)
    : Number.POSITIVE_INFINITY;

  return Math.min(maxScrollLeft, Math.max(0, rawNextScrollLeft));
}

export interface TimelineRevealPlayheadParams {
  playheadPx: number;
  scrollLeft: number;
  viewportWidth: number;
  maxScrollLeft?: number;
}

export function computeTimelineScrollLeftForPlayhead(
  params: TimelineRevealPlayheadParams,
): number | null {
  const playheadPx = Number.isFinite(params.playheadPx) ? Math.max(0, params.playheadPx) : 0;
  const scrollLeft = Number.isFinite(params.scrollLeft) ? Math.max(0, params.scrollLeft) : 0;
  const viewportWidth = Number.isFinite(params.viewportWidth)
    ? Math.max(0, params.viewportWidth)
    : 0;

  if (viewportWidth <= 0) return null;

  if (playheadPx >= scrollLeft && playheadPx <= scrollLeft + viewportWidth) {
    return null;
  }

  const maxScrollLeft = Number.isFinite(params.maxScrollLeft)
    ? Math.max(0, params.maxScrollLeft ?? 0)
    : Number.POSITIVE_INFINITY;
  const rawNextScrollLeft = playheadPx - viewportWidth / 2;

  return Math.min(maxScrollLeft, Math.max(0, rawNextScrollLeft));
}

export function computeTimelineCenteredScrollLeftForPlayhead(
  params: Omit<TimelineRevealPlayheadParams, 'scrollLeft'>,
): number | null {
  const playheadPx = Number.isFinite(params.playheadPx) ? Math.max(0, params.playheadPx) : 0;
  const viewportWidth = Number.isFinite(params.viewportWidth)
    ? Math.max(0, params.viewportWidth)
    : 0;

  if (viewportWidth <= 0) return null;

  const maxScrollLeft = Number.isFinite(params.maxScrollLeft)
    ? Math.max(0, params.maxScrollLeft ?? 0)
    : Number.POSITIVE_INFINITY;
  const rawNextScrollLeft = playheadPx - viewportWidth / 2;

  return Math.min(maxScrollLeft, Math.max(0, rawNextScrollLeft));
}

/**
 * Sanitize fps preserving non-integer rates (29.97, 23.976, 59.94 …) so NTSC timebases survive.
 * Clamped to [1, 240] and quantized to 3 decimals; mirror of `sanitizeFps` in commands/utils.
 */
export function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  const clamped = Math.min(240, Math.max(1, parsed));
  return Math.round(clamped * 1000) / 1000;
}

export function quantizeDeltaUsToFrames(deltaUs: number, fps: number): number {
  const safeDeltaUs = Number.isFinite(deltaUs) ? Math.round(deltaUs) : 0;
  const safeFps = sanitizeFps(fps);
  const framesFloat = (safeDeltaUs * safeFps) / 1e6;
  const frames = Math.round(framesFloat);
  return Math.round((frames * 1e6) / safeFps);
}

export function quantizeStartUsToFrames(startUs: number, fps: number): number {
  const safeFps = sanitizeFps(fps);
  const frame = Math.round((Math.max(0, startUs) * safeFps) / 1e6);
  return Math.round((frame * 1e6) / safeFps);
}

export function sanitizeSnapTargetsUs(targets: number[]): number[] {
  const result: number[] = [];
  for (const v of targets) {
    if (!Number.isFinite(v)) continue;
    result.push(Math.max(0, Math.round(v)));
  }
  result.sort((a, b) => a - b);
  const uniq: number[] = [];
  for (const x of result) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== x) uniq.push(x);
  }
  return uniq;
}

export function pickBestSnapCandidateUs(params: {
  rawUs: number;
  thresholdUs: number;
  targetsUs: number[];
}): { snappedUs: number; distUs: number } {
  const rawUs = Math.round(params.rawUs);
  let best = rawUs;
  let bestDist = Math.max(0, Math.round(params.thresholdUs));
  for (const target of params.targetsUs) {
    const dist = Math.abs(rawUs - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = target;
    }
  }
  return { snappedUs: best, distUs: bestDist };
}

export function computeSnappedStartUs(params: {
  rawStartUs: number;
  draggingItemDurationUs: number;
  fps: number;
  zoom: number;
  snapThresholdPx: number;
  snapTargetsUs: number[];
  enableFrameSnap: boolean;
  enableClipSnap: boolean;
  frameOffsetUs: number;
}): number {
  const {
    rawStartUs,
    draggingItemDurationUs,
    fps,
    zoom,
    snapThresholdPx,
    snapTargetsUs,
    enableFrameSnap,
    enableClipSnap,
    frameOffsetUs,
  } = params;
  const thresholdUs = Math.round((snapThresholdPx / zoomToPxPerSecond(zoom)) * 1e6);

  let best = rawStartUs;
  let bestDist = thresholdUs;

  if (enableClipSnap) {
    const rawEndUs = rawStartUs + Math.max(0, Math.round(draggingItemDurationUs));

    for (const target of snapTargetsUs) {
      const distStart = Math.abs(rawStartUs - target);
      if (distStart < bestDist) {
        bestDist = distStart;
        best = target;
      }

      const distEnd = Math.abs(rawEndUs - target);
      if (distEnd < bestDist) {
        bestDist = distEnd;
        best = target - Math.max(0, Math.round(draggingItemDurationUs));
      }
    }
  }

  if (enableFrameSnap) {
    const offsetUs = Number.isFinite(frameOffsetUs) ? Math.round(frameOffsetUs) : 0;
    best = quantizeStartUsToFrames(best - offsetUs, fps) + offsetUs;
  }

  return Math.max(0, best);
}

export function calculatePointerTimeUs(params: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  clipStartUs: number;
  zoom: number;
}): number {
  const localX = Math.min(params.rectWidth, Math.max(0, params.clientX - params.rectLeft));
  return params.clipStartUs + pxToTimeUs(localX, params.zoom);
}
