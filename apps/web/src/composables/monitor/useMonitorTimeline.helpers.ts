import {
  normalizeTransitionCurve,
  normalizeTransitionMode,
  normalizeTransitionParams,
} from '~/transitions';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';
import { cloneMonitorValue } from './useMonitorClone';
import type {
  ClipTransition,
  ClipEffect,
  ShapeConfig,
  TextClipStyle,
  TimelineBlendMode,
  TimelineClipItem,
} from '~/timeline/types';
import type { WorkerTimelineClip } from './types';

export function sanitizeMonitorSpeed(raw: unknown, fallback?: number): number | undefined {
  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(-10, Math.min(10, value));
}

export function sanitizeMonitorTransition(raw: unknown): ClipTransition | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const transition = raw as Record<string, unknown>;
  const type = typeof transition.type === 'string' ? transition.type : '';
  const durationTicks = Number(transition.durationTicks);
  if (!type || !Number.isFinite(durationTicks)) {
    return undefined;
  }

  const normalizedParams = normalizeTransitionParams(
    type,
    transition.params as Record<string, unknown> | undefined,
  ) as Record<string, unknown> | undefined;

  return {
    type,
    durationTicks: Math.max(0, Math.round(durationTicks)),
    mode: normalizeTransitionMode(transition.mode),
    curve: normalizeTransitionCurve(transition.curve),
    params: normalizedParams ? cloneMonitorValue(normalizedParams) : undefined,
  };
}

export function cloneMonitorEffects(effects?: ClipEffect[]): ClipEffect[] | undefined {
  return effects ? cloneMonitorValue(effects) : undefined;
}

export function createBaseWorkerClip(params: {
  item: TimelineClipItem;
  trackId: string;
  layer: number;
  clipType: WorkerTimelineClip['clipType'];
}): WorkerTimelineClip {
  const isTransformActive = params.item.transformActive !== false;

  return {
    kind: 'clip',
    clipType: params.clipType,
    id: params.item.id,
    trackId: params.trackId,
    layer: params.layer,
    speed: sanitizeMonitorSpeed(params.item.speed) ?? 1,
    freezeFrameSourceTicks: params.item.freezeFrameSourceTicks,
    opacity: params.item.opacityActive !== false ? params.item.opacity : undefined,
    blendMode:
      params.item.blendModeActive !== false
        ? (params.item.blendMode as TimelineBlendMode | undefined)
        : undefined,
    effects: cloneMonitorEffects(params.item.effects),
    mask:
      params.item.maskActive !== false && params.item.mask
        ? cloneMonitorValue(params.item.mask)
        : undefined,
    transform: isTransformActive ? params.item.transform : undefined,
    sourceOrientation: isTransformActive ? params.item.sourceOrientation : undefined,
    transitionIn: sanitizeMonitorTransition(params.item.transitionIn),
    transitionOut: sanitizeMonitorTransition(params.item.transitionOut),
    sourceDurationTicks:
      typeof params.item.sourceDurationTicks === 'number'
        ? params.item.sourceDurationTicks
        : undefined,
    timelineRange: {
      startTicks: params.item.timelineRange.startTicks,
      durationTicks: params.item.timelineRange.durationTicks,
    },
    sourceRange: {
      startTicks: params.item.sourceRange.startTicks,
      durationTicks: params.item.sourceRange.durationTicks,
    },
  };
}

export function createBackgroundWorkerClip(base: WorkerTimelineClip, backgroundColor: unknown) {
  return {
    ...base,
    backgroundColor: sanitizeTimelineColor(backgroundColor, '#000000'),
  };
}

export function createTextWorkerClip(
  base: WorkerTimelineClip,
  params: { text: unknown; style: TextClipStyle | undefined },
) {
  return {
    ...base,
    text: String(params.text ?? ''),
    style: params.style,
  };
}

export function createShapeWorkerClip(
  base: WorkerTimelineClip,
  params: {
    shapeType: unknown;
    fillColor: unknown;
    strokeColor: unknown;
    strokeWidth: unknown;
    shapeConfig: ShapeConfig | undefined;
  },
) {
  return {
    ...base,
    shapeType: (params.shapeType ?? 'square') as WorkerTimelineClip['shapeType'],
    fillColor: String(params.fillColor ?? '#ffffff'),
    strokeColor: String(params.strokeColor ?? '#000000'),
    strokeWidth: Number(params.strokeWidth ?? 0),
    shapeConfig: params.shapeConfig,
  };
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mixHash(hash: number, value: number): number {
  hash ^= value;
  hash = Math.imul(hash, 16777619);
  return hash >>> 0;
}

export function mixTime(hash: number, value: number): number {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  const low = safeValue >>> 0;
  const high = Math.floor(safeValue / 0x1_0000_0000) >>> 0;
  return mixHash(mixHash(hash, low), high);
}

export function mixFloat(hash: number, value: unknown, scale = 1000): number {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return mixTime(hash, Math.round(numberValue * scale));
}
