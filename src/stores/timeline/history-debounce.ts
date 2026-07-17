import { ref, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { getTimelineCommandLabelKey, getUpdateClipPropertiesLabelKey } from './history-labels';

export interface TimelineHistoryDebounceDeps {
  historyStore: {
    push: <T>(scope: string, commandType: string, snapshot: T, labelKey: string) => void;
  };
}

export interface TimelineHistoryDebounceModule {
  pendingDebouncedHistory: Ref<{
    snapshot: TimelineDocument;
    cmd: TimelineCommand;
    labelKey: string;
    groupKey: string;
    timeoutId: number;
  } | null>;
  clearPendingDebouncedHistory: () => void;
  flushPendingDebouncedHistory: () => void;
  pushHistory: (
    cmd: TimelineCommand,
    prevDoc: TimelineDocument,
    options?: {
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
      historyGroupKey?: string;
    },
  ) => void;
}

function getClipByCommandTarget(doc: TimelineDocument, cmd: TimelineCommand) {
  const target = cmd as { trackId?: string; itemId?: string };
  if (!target.trackId || !target.itemId) return null;
  const track = doc.tracks.find((t) => t.id === target.trackId);
  const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId);
  return item && item.kind === 'clip' ? item : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectChangedPaths(
  before: unknown,
  after: unknown,
  prefix = '',
  out: string[] = [],
): string[] {
  if (Object.is(before, after)) return out;

  if (!isPlainObject(before) || !isPlainObject(after)) {
    out.push(prefix);
    return out;
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    collectChangedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function deriveEffectsGroupKey(
  beforeEffects: unknown,
  afterEffects: unknown,
  fallback: string,
): string {
  if (!Array.isArray(beforeEffects) || !Array.isArray(afterEffects)) return `${fallback}:effects`;

  const beforeIds = beforeEffects.map((effect) =>
    isPlainObject(effect) ? String(effect.id ?? '') : '',
  );
  const afterIds = afterEffects.map((effect) =>
    isPlainObject(effect) ? String(effect.id ?? '') : '',
  );

  if (beforeIds.length !== afterIds.length) return `${fallback}:effects:list`;
  if (beforeIds.some((id, index) => id !== afterIds[index])) return `${fallback}:effects:order`;

  for (let index = 0; index < afterEffects.length; index++) {
    const before = beforeEffects[index];
    const after = afterEffects[index];
    if (!isPlainObject(before) || !isPlainObject(after)) continue;

    const changed = collectChangedPaths(before, after).filter((path) => path.length > 0);
    if (changed.length === 0) continue;

    const effectId = String(after.id ?? before.id ?? index);
    return `${fallback}:effects:${effectId}:${changed.sort().join(',')}`;
  }

  return `${fallback}:effects`;
}

function deriveTransitionGroupKey(
  cmd: TimelineCommand,
  prevDoc: TimelineDocument,
  fallback: string,
): string {
  const update = cmd as unknown as Record<string, unknown>;
  const edge = 'transitionIn' in update ? 'in' : 'transitionOut' in update ? 'out' : 'unknown';
  const transition = edge === 'in' ? update.transitionIn : update.transitionOut;
  if (!isPlainObject(transition)) return `${fallback}:transition:${edge}:presence`;

  const clip = getClipByCommandTarget(prevDoc, cmd) as Record<string, unknown> | null;
  const before = edge === 'in' ? clip?.transitionIn : clip?.transitionOut;
  const changed = collectChangedPaths(before, transition)
    .filter((path) => path.length > 0)
    .sort();

  return `${fallback}:transition:${edge}:${changed.join(',') || 'value'}`;
}

function deriveUpdateClipPropertiesGroupKey(cmd: TimelineCommand, prevDoc: TimelineDocument) {
  const update = cmd as {
    trackId?: string;
    itemId?: string;
    properties?: Record<string, unknown>;
  };
  const fallback = `${cmd.type}:${update.trackId ?? ''}:${update.itemId ?? ''}`;
  const properties = update.properties ?? {};
  const propertyKeys = Object.keys(properties).sort();
  if (propertyKeys.length === 0) return fallback;

  const clip = getClipByCommandTarget(prevDoc, cmd) as Record<string, unknown> | null;
  if (!clip) return `${fallback}:${propertyKeys.join(',')}`;

  if (propertyKeys.includes('effects')) {
    return deriveEffectsGroupKey(clip.effects, properties.effects, fallback);
  }

  const nestedKeys = [
    'transform',
    'style',
    'mask',
    'shapeConfig',
    'background',
    'content',
    'frame',
  ];
  for (const key of nestedKeys) {
    if (!propertyKeys.includes(key)) continue;
    const changed = collectChangedPaths(clip[key], properties[key])
      .filter((path) => path.length > 0)
      .sort();
    if (changed.length > 0) return `${fallback}:${key}.${changed.join(',')}`;
  }

  return `${fallback}:${propertyKeys.join(',')}`;
}

function deriveHistoryGroupKey(
  cmd: TimelineCommand,
  prevDoc: TimelineDocument,
  explicitGroupKey?: string,
): string {
  if (explicitGroupKey) return explicitGroupKey;
  const target = cmd as { trackId?: string; itemId?: string };
  const fallback = `${cmd.type}:${target.trackId ?? ''}:${target.itemId ?? ''}`;

  if (cmd.type === 'update_clip_properties') {
    return deriveUpdateClipPropertiesGroupKey(cmd, prevDoc);
  }

  if (cmd.type === 'update_clip_transition') {
    return deriveTransitionGroupKey(cmd, prevDoc, fallback);
  }

  return fallback;
}

export function createTimelineHistoryDebounceModule(
  deps: TimelineHistoryDebounceDeps,
): TimelineHistoryDebounceModule {
  const pendingDebouncedHistory = ref<{
    snapshot: TimelineDocument;
    cmd: TimelineCommand;
    labelKey: string;
    groupKey: string;
    timeoutId: number;
  } | null>(null);

  function clearPendingDebouncedHistory() {
    const pending = pendingDebouncedHistory.value;
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pendingDebouncedHistory.value = null;
  }

  function flushPendingDebouncedHistory() {
    const pending = pendingDebouncedHistory.value;
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    deps.historyStore.push('timeline', pending.cmd.type, pending.snapshot, pending.labelKey);
    pendingDebouncedHistory.value = null;
  }

  function pushHistory(
    cmd: TimelineCommand,
    prevDoc: TimelineDocument,
    options?: {
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
      historyGroupKey?: string;
    },
  ) {
    const historyMode = options?.historyMode ?? 'immediate';
    let labelKey = options?.labelKey;
    if (!labelKey) {
      if (cmd.type === 'update_clip_properties') {
        labelKey = getUpdateClipPropertiesLabelKey(cmd.properties ?? {});
      } else {
        labelKey = getTimelineCommandLabelKey(cmd.type);
      }
    }

    if (historyMode === 'debounced') {
      const debounceMs = Math.max(0, Math.round(options?.historyDebounceMs ?? 300));
      const groupKey = deriveHistoryGroupKey(cmd, prevDoc, options?.historyGroupKey);
      const pending = pendingDebouncedHistory.value;

      if (pending) {
        if (pending.groupKey !== groupKey) {
          flushPendingDebouncedHistory();
          pendingDebouncedHistory.value = {
            snapshot: prevDoc,
            cmd,
            labelKey,
            groupKey,
            timeoutId: window.setTimeout(() => {
              const p = pendingDebouncedHistory.value;
              if (!p) return;
              deps.historyStore.push('timeline', p.cmd.type, p.snapshot, p.labelKey);
              pendingDebouncedHistory.value = null;
            }, debounceMs),
          };
          return;
        }

        window.clearTimeout(pending.timeoutId);
        pendingDebouncedHistory.value = {
          snapshot: pending.snapshot,
          cmd,
          labelKey,
          groupKey,
          timeoutId: window.setTimeout(() => {
            const p = pendingDebouncedHistory.value;
            if (!p) return;
            deps.historyStore.push('timeline', p.cmd.type, p.snapshot, p.labelKey);
            pendingDebouncedHistory.value = null;
          }, debounceMs),
        };
      } else {
        pendingDebouncedHistory.value = {
          snapshot: prevDoc,
          cmd,
          labelKey,
          groupKey,
          timeoutId: window.setTimeout(() => {
            const p = pendingDebouncedHistory.value;
            if (!p) return;
            deps.historyStore.push('timeline', p.cmd.type, p.snapshot, p.labelKey);
            pendingDebouncedHistory.value = null;
          }, debounceMs),
        };
      }
    } else {
      flushPendingDebouncedHistory();
      deps.historyStore.push('timeline', cmd.type, prevDoc, labelKey);
    }
  }

  return {
    pendingDebouncedHistory,
    clearPendingDebouncedHistory,
    flushPendingDebouncedHistory,
    pushHistory,
  };
}
