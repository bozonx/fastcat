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

export function pxToTimeUs(px: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return Math.max(0, Math.round((px / pxPerSecond) * 1e6));
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

export function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  const rounded = Math.round(parsed);
  if (rounded < 1) return 1;
  if (rounded > 240) return 240;
  return rounded;
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
