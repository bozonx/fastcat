import { applyTransitionCurve } from '~/transitions';
import type { TransitionCurve } from '~/transitions';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';

export function getClipClass(item: TimelineTrackItem, track: TimelineTrack): string[] {
  if (item.kind === 'gap') {
    return [
      'border',
      'border-dashed',
      'border-ui-border/50',
      'bg-ui-bg-elevated/20',
      'hover:bg-ui-bg-elevated/40',
      'text-ui-text-muted',
      'transition-colors',
    ];
  }

  const clipItem = item as TimelineClipItem;
  const baseClasses = ['border', 'transition-colors'];

  if (clipItem.clipType === 'background') {
    return [
      ...baseClasses,
      'bg-[var(--clip-background-bg)]',
      'border-[var(--clip-background-border)]',
      'hover:bg-[var(--clip-background-bg-hover)]',
    ];
  }
  if (clipItem.clipType === 'adjustment') {
    return [
      ...baseClasses,
      'bg-[var(--clip-adjustment-bg)]',
      'border-[var(--clip-adjustment-border)]',
      'hover:bg-[var(--clip-adjustment-bg-hover)]',
    ];
  }
  if (clipItem.clipType === 'text') {
    return [
      ...baseClasses,
      'bg-[var(--clip-text-bg)]',
      'border-[var(--clip-text-border)]',
      'hover:bg-[var(--clip-text-bg-hover)]',
    ];
  }
  if (track.kind === 'audio') {
    return [
      ...baseClasses,
      'bg-[var(--clip-audio-bg)]',
      'border-[var(--clip-audio-border)]',
      'hover:bg-[var(--clip-audio-bg-hover)]',
    ];
  }

  return [
    ...baseClasses,
    'bg-[var(--clip-video-bg)]',
    'border-[var(--clip-video-border)]',
    'hover:bg-[var(--clip-video-bg-hover)]',
  ];
}

export function clampHandlePx(px: number, clipPx: number): number {
  const safePx = Number.isFinite(px) ? px : 0;
  const safeClipPx = Number.isFinite(clipPx) ? Math.max(0, clipPx) : 0;
  const padPx = 3;
  if (safeClipPx <= padPx * 2) {
    return safeClipPx / 2;
  }
  return Math.max(padPx, Math.min(safeClipPx - padPx, safePx));
}

interface TransitionPreviewPoint {
  x: number;
  y: number;
}

interface FadePatternLine {
  x: number;
  width: number;
}

function roundSvg(value: number): number {
  return Math.round(value * 100) / 100;
}

function createCurvePoints(
  curve: TransitionCurve,
  width: number,
  height: number,
  params?: Record<string, any>,
): TransitionPreviewPoint[] {
  const steps = 18;
  const points: TransitionPreviewPoint[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    points.push({
      x: roundSvg(t * width),
      y: roundSvg(applyTransitionCurve(t, curve, params) * height),
    });
  }

  return points;
}

function buildPathFromPoints(points: TransitionPreviewPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${roundSvg(point.x)},${roundSvg(point.y)}`)
    .join(' ');
}

export function getTransitionCurveSinglePath(
  width: number,
  height: number,
  curve: TransitionCurve,
  params?: Record<string, any>,
): string {
  const points = createCurvePoints(curve, width, height, params);
  return buildPathFromPoints(points);
}

export function getTransitionSolidPath(
  width: number,
  height: number,
  curve: TransitionCurve,
  edge: 'in' | 'out',
  params?: Record<string, any>,
): string {
  const halfHeight = height / 2;
  const points = createCurvePoints(curve, width, halfHeight, params);

  const mirroredPoints = points.map((point) => ({
    x: point.x,
    y: roundSvg(height - point.y),
  }));

  if (edge === 'in') {
    const topPath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${roundSvg(point.x)},${roundSvg(point.y)}`)
      .join(' ');

    const bottomPathReversed = [...mirroredPoints]
      .reverse()
      .map((point) => `L${roundSvg(point.x)},${roundSvg(point.y)}`)
      .join(' ');

    return `${topPath} ${bottomPathReversed} Z`;
  } else {
    const topCurveReversed = [...points]
      .reverse()
      .map((point) => `L${roundSvg(point.x)},${roundSvg(point.y)}`)
      .join(' ');
    const topShape = `M 0,0 L ${width},0 ${topCurveReversed} Z`;

    const bottomCurveReversed = [...mirroredPoints]
      .reverse()
      .map((point) => `L${roundSvg(point.x)},${roundSvg(point.y)}`)
      .join(' ');
    const bottomShape = `M 0,${height} L ${width},${height} ${bottomCurveReversed} Z`;

    return `${topShape} ${bottomShape}`;
  }
}

export function getFadeLinePattern(
  edge: 'in' | 'out',
  curve: TransitionCurve,
  width = 100,
  params?: Record<string, any>,
): FadePatternLine[] {
  const count = 28;
  const sampleSteps = 256;
  const dt = 1 / sampleSteps;
  const minWeight = 0.02;

  // Build cumulative weight based on curve slope.
  // Where the curve is steeper, slope is higher => more lines.
  const cumulative: number[] = [0];
  for (let i = 1; i <= sampleSteps; i += 1) {
    const t = i / sampleSteps;
    const tPrev = Math.max(0, t - dt);
    const tNext = Math.min(1, t + dt);
    const yPrev = applyTransitionCurve(tPrev, curve, params);
    const yNext = applyTransitionCurve(tNext, curve, params);
    const slope = Math.abs(yNext - yPrev) / (tNext - tPrev || dt);
    const weight = Math.max(minWeight, slope);
    cumulative[i] = (cumulative[i - 1] ?? 0) + weight;
  }

  const total = cumulative[sampleSteps] ?? 0;
  if (total <= 0) {
    return [];
  }

  const positions: number[] = [];
  for (let index = 1; index <= count; index += 1) {
    const target = (index / (count + 1)) * total;

    // Find first i where cumulative[i] >= target.
    let i = 1;
    while (i < sampleSteps && (cumulative[i] ?? 0) < target) {
      i += 1;
    }

    const left = cumulative[i - 1] ?? 0;
    const right = cumulative[i] ?? left;
    const frac = right > left ? (target - left) / (right - left) : 0;
    const t = (i - 1 + frac) / sampleSteps;
    const x = t * width;
    positions.push(edge === 'in' ? x : width - x);
  }

  const sorted = positions
    .map((position) => Math.max(0.5, Math.min(width - 0.5, position)))
    .sort((left, right) => left - right);

  return sorted.map((position, index) => {
    const previous = index > 0 ? (sorted[index - 1] ?? 0) : 0;
    const next = index < sorted.length - 1 ? (sorted[index + 1] ?? width) : width;
    const gap = Math.min(position - previous, next - position);
    const lineWidth = Math.max(0.4, Math.min(1.2, gap * 0.2));

    return {
      x: roundSvg(position - lineWidth / 2),
      width: roundSvg(lineWidth),
    };
  });
}

export function getPrevClipForItem(
  track: TimelineTrack,
  item: TimelineTrackItem,
): TimelineClipItem | null {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  const idx = clips.findIndex((c) => c.id === item.id);
  if (idx <= 0) return null;
  return clips[idx - 1] ?? null;
}

export function getNextClipForItem(
  track: TimelineTrack,
  item: TimelineTrackItem,
): TimelineClipItem | null {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  const idx = clips.findIndex((c) => c.id === item.id);
  if (idx < 0 || idx >= clips.length - 1) return null;
  return clips[idx + 1] ?? null;
}

export function getClipHeadHandleUs(clip: TimelineClipItem): number {
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return Number.POSITIVE_INFINITY;
  if (clip.isImage) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round(clip.sourceRange?.startUs ?? 0));
}

export function getClipTailHandleUs(clip: TimelineClipItem): number {
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return Number.POSITIVE_INFINITY;
  if (clip.isImage) return Number.POSITIVE_INFINITY;
  const sourceDurationUs = Math.max(0, Math.round(Number(clip.sourceDurationUs ?? 0)));
  const sourceEndUs = Math.max(
    0,
    Math.round(Number(clip.sourceRange?.startUs ?? 0) + Number(clip.sourceRange?.durationUs ?? 0)),
  );
  return Math.max(0, sourceDurationUs - sourceEndUs);
}

export function getClipHeadTimelineHandleUs(clip: TimelineClipItem): number {
  const speed = clip.speed ?? 1;
  if (speed === 0) return Number.POSITIVE_INFINITY;
  const absSpeed = Math.abs(speed);
  const sourceHandleUs = speed >= 0 ? getClipHeadHandleUs(clip) : getClipTailHandleUs(clip);
  return sourceHandleUs / absSpeed;
}

export function getClipTailTimelineHandleUs(clip: TimelineClipItem): number {
  const speed = clip.speed ?? 1;
  if (speed === 0) return Number.POSITIVE_INFINITY;
  const absSpeed = Math.abs(speed);
  const sourceHandleUs = speed >= 0 ? getClipTailHandleUs(clip) : getClipHeadHandleUs(clip);
  return sourceHandleUs / absSpeed;
}

export function getOverlayGuideOffsetPx(
  track: TimelineTrack,
  clipItem: TimelineClipItem | null,
  edge: 'in' | 'out',
  clipWidthPx: number,
  transitionUsToPxFn: (us: number) => number,
): number | null {
  if (!clipItem) return null;

  const transition = edge === 'in' ? clipItem.transitionIn : clipItem.transitionOut;
  if (!transition) return null;
  if (transition.mode !== 'adjacent') return null;

  const adjacent =
    edge === 'in' ? getPrevClipForItem(track, clipItem) : getNextClipForItem(track, clipItem);
  if (!adjacent) return null;

  const timelineHandleUs =
    edge === 'in' ? getClipTailTimelineHandleUs(adjacent) : getClipHeadTimelineHandleUs(adjacent);
  if (!Number.isFinite(timelineHandleUs) || timelineHandleUs <= 0) return null;

  return Math.max(0, Math.min(clipWidthPx, transitionUsToPxFn(timelineHandleUs)));
}

export function isVideo(item: TimelineTrackItem, track: TimelineTrack): item is TimelineClipItem {
  if (item.kind !== 'clip') return false;
  const clipType = (item as any).clipType;
  return (clipType === 'media' || clipType === 'timeline') && track.kind === 'video';
}

export function isAudio(item: TimelineTrackItem, track: TimelineTrack): item is TimelineClipItem {
  if (item.kind !== 'clip') return false;
  const clipType = (item as any).clipType;
  return (clipType === 'media' || clipType === 'timeline') && track.kind === 'audio';
}

export function clipHasAudio(
  item: TimelineTrackItem,
  track: TimelineTrack,
  mediaMetadata: Record<string, any>,
): boolean {
  if (item.kind !== 'clip') return false;
  const clip = item as any;
  if (clip.clipType === 'timeline') return true;
  if (track.kind === 'video' && clip.audioFromVideoDisabled) return false;
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return track.kind === 'audio';
  if (!clip.source?.path) return track.kind === 'audio';
  return Boolean(mediaMetadata[clip.source.path]?.audio);
}
