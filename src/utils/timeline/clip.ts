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

export function transitionSvgParts(w: number, h: number, edge: 'in' | 'out'): string {
  const m = h / 2;
  if (edge === 'in') {
    return `M0,0 L${w},${m} L0,${h} Z`;
  }
  return `M0,0 L${w},0 L${w},${m} Z M0,${h} L${w},${h} L${w},${m} Z`;
}
