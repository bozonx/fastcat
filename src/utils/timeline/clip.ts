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
): TransitionPreviewPoint[] {
  const steps = 18;
  const points: TransitionPreviewPoint[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    points.push({
      x: roundSvg(t * width),
      y: roundSvg(applyTransitionCurve(t, curve) * height),
    });
  }

  return points;
}

function buildPathFromPoints(points: TransitionPreviewPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${roundSvg(point.x)},${roundSvg(point.y)}`)
    .join(' ');
}

export function getTransitionCurvePreviewPaths(
  width: number,
  height: number,
  curve: TransitionCurve,
  edge: 'in' | 'out',
): { top: string; bottom: string } {
  const halfHeight = height / 2;
  const points = createCurvePoints(curve, width, halfHeight);
  const orientedPoints =
    edge === 'in'
      ? points
      : points.map((point) => ({ x: roundSvg(width - point.x), y: point.y })).reverse();

  const mirroredPoints = orientedPoints.map((point) => ({
    x: point.x,
    y: roundSvg(height - point.y),
  }));

  return {
    top: buildPathFromPoints(orientedPoints),
    bottom: buildPathFromPoints(mirroredPoints),
  };
}

export function getFadeLinePattern(
  edge: 'in' | 'out',
  curve: TransitionCurve,
  width = 100,
): FadePatternLine[] {
  const count = 16;
  const positions: number[] = [];

  for (let index = 1; index <= count; index += 1) {
    const t = index / (count + 1);
    const position = applyTransitionCurve(t, curve) * width;
    positions.push(edge === 'in' ? position : width - position);
  }

  const sorted = positions
    .map((position) => Math.max(0.5, Math.min(width - 0.5, position)))
    .sort((left, right) => left - right);

  return sorted.map((position, index) => {
    const previous = index > 0 ? (sorted[index - 1] ?? 0) : 0;
    const next = index < sorted.length - 1 ? (sorted[index + 1] ?? width) : width;
    const gap = Math.min(position - previous, next - position);
    const lineWidth = Math.max(0.9, Math.min(2.4, gap * 0.35));

    return {
      x: roundSvg(position - lineWidth / 2),
      width: roundSvg(lineWidth),
    };
  });
}
