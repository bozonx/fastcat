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

export function getTransitionCurveSinglePath(
  width: number,
  height: number,
  curve: TransitionCurve,
): string {
  const points = createCurvePoints(curve, width, height);
  return buildPathFromPoints(points);
}

export function getTransitionSolidPath(
  width: number,
  height: number,
  curve: TransitionCurve,
  edge: 'in' | 'out',
): string {
  const halfHeight = height / 2;
  const points = createCurvePoints(curve, width, halfHeight);

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
): FadePatternLine[] {
  const count = 28;
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
    const lineWidth = Math.max(0.4, Math.min(1.2, gap * 0.2));

    return {
      x: roundSvg(position - lineWidth / 2),
      width: roundSvg(lineWidth),
    };
  });
}
