import { quantizeTicksToFrame, secondsToTicks, ticksToSeconds } from '~/utils/time/ticks';
import { sanitizeFps } from '~/utils/time';

export { sanitizeFps };

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

export function timeUsToPx(timeTicks: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return ticksToSeconds(timeTicks) * pxPerSecond;
}

export interface TimelinePixelRange {
  leftPx: number;
  widthPx: number;
  endPx: number;
}

export function timelineRangeToRoundedPx(
  range: { startTicks: number; durationTicks: number },
  zoom = 100,
  minWidthPx = 1,
): TimelinePixelRange {
  const leftPx = Math.round(timeUsToPx(range.startTicks, zoom));
  const rawEndPx = Math.round(timeUsToPx(range.startTicks + range.durationTicks, zoom));
  const endPx = Math.max(leftPx + minWidthPx, rawEndPx);

  return {
    leftPx,
    widthPx: endPx - leftPx,
    endPx,
  };
}

export function pxToTimeTicks(px: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return Math.max(0, secondsToTicks({ seconds: px / pxPerSecond }));
}

/**
 * Project an absolute timeline pixel coordinate into the viewport.
 *
 * The single rounding convention shared by every horizontal element (clips,
 * ruler ticks, playhead, markers, selection range): round in *absolute* space
 * first, then subtract the raw scroll offset. Rounding the absolute coordinate
 * — rather than the post-scroll result — is what keeps a playhead, a marker
 * line and a clip edge that all sit on the same timeTicks pixel-aligned with each
 * other for *any* `scrollLeft`, including the fractional values HiDPI trackpads
 * produce. Clips already do this via `timelineRangeToRoundedPx`; this helper
 * lets overlays match them exactly instead of computing `round(abs - scroll)`.
 */
export function absolutePxToViewportPx(absolutePx: number, scrollLeft: number): number {
  return Math.round(absolutePx) - scrollLeft;
}

/** Convenience wrapper: project a timeTicks straight into viewport pixels. */
export function timeUsToViewportPx(timeTicks: number, zoom: number, scrollLeft: number): number {
  return absolutePxToViewportPx(timeUsToPx(timeTicks, zoom), scrollLeft);
}

export function quantizeTimeUsToPixelGrid(timeTicks: number, zoom = 100) {
  return pxToTimeTicks(Math.round(timeUsToPx(timeTicks, zoom)), zoom);
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

export function pxToDeltaTicks(px: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return secondsToTicks({ seconds: px / pxPerSecond });
}

export interface TimelineZoomAnchor {
  anchorTimeTicks: number;
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

  const anchorTimeTicks = Number.isFinite(anchor.anchorTimeTicks)
    ? Math.max(0, Math.round(anchor.anchorTimeTicks))
    : 0;
  const anchorViewportXRaw = Number.isFinite(anchor.anchorViewportX)
    ? anchor.anchorViewportX
    : safeViewportWidth / 2;
  const anchorViewportX = Math.min(safeViewportWidth, Math.max(0, anchorViewportXRaw));

  const anchorPxAtNextZoom = timeUsToPx(anchorTimeTicks, nextZoom);
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

export function quantizeDeltaUsToFrames(deltaTicks: number, fps: number): number {
  const safeDeltaTicks = Number.isFinite(deltaTicks) ? Math.round(deltaTicks) : 0;
  const safeFps = sanitizeFps(fps);
  return quantizeTicksToFrame({
    ticks: safeDeltaTicks,
    frameRate: { num: safeFps, den: 1 },
    mode: 'round',
  });
}

export function quantizeStartUsToFrames(startTicks: number, fps: number): number {
  const safeFps = sanitizeFps(fps);
  return Math.max(
    0,
    quantizeTicksToFrame({
      ticks: Math.max(0, startTicks),
      frameRate: { num: safeFps, den: 1 },
      mode: 'round',
    }),
  );
}

/**
 * The signed distance (ticks) from `startTicks` to its nearest frame boundary — a
 * clip's sub-frame "phase". Zero for frame-aligned starts. Feeding this back as
 * `computeSnappedStartTicks`'s `frameOffsetTicks` frame-snaps by whole-frame deltas
 * while preserving the phase (so a hand-dialed audio sync survives a move).
 * Canonical positions are integer ticks, so only an exact boundary has zero
 * phase.
 */
export function subframePhaseTicks(startTicks: number, fps: number): number {
  const phase = Math.round(startTicks) - quantizeStartUsToFrames(startTicks, fps);
  return phase === 0 ? 0 : phase;
}

export function sanitizeSnapTargetsTicks(targets: number[]): number[] {
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

export function pickBestSnapCandidateTicks(params: {
  rawTicks: number;
  thresholdTicks: number;
  targetsTicks: number[];
}): { snappedTicks: number; distTicks: number } {
  const rawTicks = Math.round(params.rawTicks);
  let best = rawTicks;
  let bestDist = Math.max(0, Math.round(params.thresholdTicks));
  for (const target of params.targetsTicks) {
    const dist = Math.abs(rawTicks - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = target;
    }
  }
  return { snappedTicks: best, distTicks: bestDist };
}

export function computeSnappedStartTicks(params: {
  rawStartTicks: number;
  draggingItemDurationTicks: number;
  fps: number;
  zoom: number;
  snapThresholdPx: number;
  snapTargetsTicks: number[];
  enableFrameSnap: boolean;
  enableClipSnap: boolean;
  frameOffsetTicks: number;
}): number {
  const {
    rawStartTicks,
    draggingItemDurationTicks,
    fps,
    zoom,
    snapThresholdPx,
    snapTargetsTicks,
    enableFrameSnap,
    enableClipSnap,
    frameOffsetTicks,
  } = params;
  const thresholdTicks = secondsToTicks({ seconds: snapThresholdPx / zoomToPxPerSecond(zoom) });

  let best = rawStartTicks;
  let bestDist: number = thresholdTicks;
  let snappedToClip = false;

  if (enableClipSnap) {
    const rawEndTicks = rawStartTicks + Math.max(0, Math.round(draggingItemDurationTicks));

    for (const target of snapTargetsTicks) {
      const distStart = Math.abs(rawStartTicks - target);
      if (distStart < bestDist) {
        bestDist = distStart;
        best = target;
        snappedToClip = true;
      }

      const distEnd = Math.abs(rawEndTicks - target);
      if (distEnd < bestDist) {
        bestDist = distEnd;
        best = target - Math.max(0, Math.round(draggingItemDurationTicks));
        snappedToClip = true;
      }
    }
  }

  if (enableFrameSnap && !snappedToClip) {
    const offsetTicks = Number.isFinite(frameOffsetTicks) ? Math.round(frameOffsetTicks) : 0;
    best = quantizeStartUsToFrames(best - offsetTicks, fps) + offsetTicks;
  }

  return Math.max(0, best);
}

export function calculatePointerTimeTicks(params: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  clipStartTicks: number;
  zoom: number;
}): number {
  const localX = Math.min(params.rectWidth, Math.max(0, params.clientX - params.rectLeft));
  return params.clipStartTicks + pxToTimeTicks(localX, params.zoom);
}
