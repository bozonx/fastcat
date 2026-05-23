import type { Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY } from './history-labels';

import type { TimelineHydrationModule } from './hydration';
import type { TimelineHistoryDebounceModule } from './history-debounce';

export interface TimelineDispatcherDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  duration: Ref<number>;
  createFallbackTimelineDoc: () => TimelineDocument;
  hydration: TimelineHydrationModule;
  historyDebounce: TimelineHistoryDebounceModule;
  historyStore: {
    canUndo: (scope: string) => boolean;
    canRedo: (scope: string) => boolean;
    undo: <T>(scope: string, doc: T) => T | null;
    redo: <T>(scope: string, doc: T) => T | null;
  };
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  markTimelineAsDirty: () => void;
  selectTimelineItems: (itemIds: string[]) => void;
  selectGlobalTimelineItems: (itemIds: string[], doc: TimelineDocument) => void;
  pruneSelection?: (doc: TimelineDocument) => void;
  notifyWarning?: (messageKey: string) => void;
}

export interface TimelineDispatcherModule {
  applyTimeline: (
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) => string[];
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      labelKey?: string;
    },
  ) => string[];
  pushTimelineHistory: (preState: TimelineDocument, commandType: string, labelKey: string) => void;
  undoTimeline: () => void;
  redoTimeline: () => void;
  applyRestoredSnapshot: (snapshot: TimelineDocument) => void;
}

export function createTimelineDispatcherModule(
  deps: TimelineDispatcherDeps,
): TimelineDispatcherModule {
  function applyTimeline(
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ): string[] {
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const prev = deps.timelineDoc.value;
    const hydrated = deps.hydration.hydrateClipSourceDuration(deps.timelineDoc.value, cmd);
    let next: TimelineDocument;
    let createdItemIds: string[] | undefined;

    try {
      const result = applyTimelineCommand(hydrated, cmd);
      next = deps.hydration.hydrateAllClips(result.next);
      createdItemIds = result.createdItemIds;
    } catch (error) {
      if (error instanceof Error && error.message === 'Item overlaps with another item') {
        console.warn('Timeline command rejected: item overlaps with another item', cmd);
        return [];
      }
      if (error instanceof Error && error.message === 'Marker already exists at this time') {
        console.warn('Timeline command rejected: marker already exists at this time', cmd);
        deps.notifyWarning?.('fastcat.timeline.markerAlreadyExists');
        return [];
      }
      console.warn('Failed to apply timeline command:', error, cmd);
      return [];
    }

    if (next === prev) return [];

    if (!options?.skipHistory) {
      deps.historyDebounce.pushHistory(cmd, prev, options);
    }

    deps.timelineDoc.value = next;
    deps.duration.value = selectTimelineDurationUs(next);
    deps.markTimelineAsDirty();

    if (createdItemIds?.length) {
      deps.selectTimelineItems(createdItemIds);
      deps.selectGlobalTimelineItems(createdItemIds, next);
    }

    const saveMode = options?.saveMode ?? 'debounced';
    if (saveMode === 'immediate') {
      void deps.requestTimelineSave({ immediate: true });
    } else if (saveMode === 'debounced') {
      void deps.requestTimelineSave();
    }

    return createdItemIds ?? [];
  }

  function batchApplyTimeline(
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      labelKey?: string;
    },
  ): string[] {
    if (cmds.length === 0) return [];
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const prev = deps.timelineDoc.value;
    let current = prev;
    const allCreatedItemIds: string[] = [];
    let batchFailed = false;

    for (const cmd of cmds) {
      const hydrated = deps.hydration.hydrateClipSourceDuration(current, cmd);
      try {
        const { next, createdItemIds } = applyTimelineCommand(hydrated, cmd);
        current = deps.hydration.hydrateAllClips(next);
        if (createdItemIds) {
          allCreatedItemIds.push(...createdItemIds);
        }
      } catch (error) {
        const overlap =
          error instanceof Error && error.message === 'Item overlaps with another item';
        const markerExists =
          error instanceof Error && error.message === 'Marker already exists at this time';
        if (overlap) {
          console.warn('Timeline batch command rejected: item overlaps with another item', cmd);
        } else if (markerExists) {
          console.warn('Timeline batch command rejected: marker already exists at this time', cmd);
          deps.notifyWarning?.('fastcat.timeline.markerAlreadyExists');
        } else {
          console.warn('Failed to apply timeline command in batch:', error, cmd);
        }
        // The batch is atomic: any failure rolls back to the document state
        // that existed before the first command ran, so we never leave a
        // half-applied state in the doc or in history.
        batchFailed = true;
        break;
      }
    }

    if (batchFailed || current === prev) return [];

    if (!options?.skipHistory) {
      deps.historyDebounce.pushHistory(cmds[0]!, prev, {
        ...options,
        historyMode: 'immediate',
        labelKey:
          options?.labelKey ?? (cmds.length > 1 ? TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY : undefined),
      });
    }

    deps.timelineDoc.value = current;
    deps.duration.value = selectTimelineDurationUs(current);
    deps.markTimelineAsDirty();

    if (allCreatedItemIds.length > 0) {
      deps.selectTimelineItems(allCreatedItemIds);
      deps.selectGlobalTimelineItems(allCreatedItemIds, current);
    }

    const saveMode = options?.saveMode ?? 'debounced';
    if (saveMode === 'immediate') {
      void deps.requestTimelineSave({ immediate: true });
    } else if (saveMode === 'debounced') {
      void deps.requestTimelineSave();
    }

    return allCreatedItemIds;
  }

  function pushTimelineHistory(preState: TimelineDocument, commandType: string, labelKey: string) {
    // Drag/resize composables commit their changes with skipHistory:true and
    // then push a single entry at the end via this helper. Flush any pending
    // debounced entry first so callers don't have to remember.
    deps.historyDebounce.flushPendingDebouncedHistory();
    (deps.historyStore as any).push('timeline', commandType, preState, labelKey);
  }

  function applyRestoredSnapshot(snapshot: TimelineDocument) {
    if (!snapshot) return;
    deps.timelineDoc.value = snapshot;
    deps.duration.value = selectTimelineDurationUs(snapshot);
    deps.markTimelineAsDirty();
    deps.pruneSelection?.(snapshot);
    void deps.requestTimelineSave();
  }

  function undoTimeline() {
    if (!deps.timelineDoc.value || !deps.historyStore.canUndo('timeline')) return;

    // Discard any pending debounced history before undoing so the undo targets
    // the last committed entry, not an unflushed debounced one.
    deps.historyDebounce.clearPendingDebouncedHistory();

    const restored = deps.historyStore.undo('timeline', deps.timelineDoc.value);
    if (!restored) return;
    applyRestoredSnapshot(restored);
  }

  function redoTimeline() {
    if (!deps.timelineDoc.value || !deps.historyStore.canRedo('timeline')) return;

    // Discard any pending debounced history before redoing
    deps.historyDebounce.clearPendingDebouncedHistory();

    const restored = deps.historyStore.redo('timeline', deps.timelineDoc.value);
    if (!restored) return;
    applyRestoredSnapshot(restored);
  }

  return {
    applyTimeline,
    batchApplyTimeline,
    pushTimelineHistory,
    undoTimeline,
    redoTimeline,
    applyRestoredSnapshot,
  };
}
