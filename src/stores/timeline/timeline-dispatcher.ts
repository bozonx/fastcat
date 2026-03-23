import type { Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY } from './timeline-history-labels';

import type { TimelineHydrationApi } from './timeline-hydration';
import type { TimelineHistoryDebounceApi } from './timeline-history-debounce';

export interface TimelineDispatcherDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  duration: Ref<number>;
  createFallbackTimelineDoc: () => TimelineDocument;
  hydration: TimelineHydrationApi;
  historyDebounce: TimelineHistoryDebounceApi;
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
}

export interface TimelineDispatcherApi {
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
  undoTimeline: () => void;
  redoTimeline: () => void;
}

export function createTimelineDispatcher(deps: TimelineDispatcherDeps): TimelineDispatcherApi {
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
        // Expected behavior when validating moves/trims that result in overlap
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

    for (const cmd of cmds) {
      const hydrated = deps.hydration.hydrateClipSourceDuration(current, cmd);
      try {
        const { next, createdItemIds } = applyTimelineCommand(hydrated, cmd);
        current = deps.hydration.hydrateAllClips(next);
        if (createdItemIds) {
          allCreatedItemIds.push(...createdItemIds);
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Item overlaps with another item') {
          // Expected behavior when validating moves/trims that result in overlap
          break;
        }
        console.warn('Failed to apply timeline command in batch:', error, cmd);
        break;
      }
    }

    if (current === prev) return [];

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

  function undoTimeline() {
    if (!deps.timelineDoc.value || !deps.historyStore.canUndo('timeline')) return;

    // Process any debounced actions before undoing
    deps.historyDebounce.flushPendingDebouncedHistory();

    const restored = deps.historyStore.undo('timeline', deps.timelineDoc.value);
    if (!restored) return;
    deps.timelineDoc.value = restored;
    deps.duration.value = selectTimelineDurationUs(restored);
    deps.markTimelineAsDirty();
    void deps.requestTimelineSave();
  }

  function redoTimeline() {
    if (!deps.timelineDoc.value || !deps.historyStore.canRedo('timeline')) return;

    // Process any debounced actions before redoing
    deps.historyDebounce.flushPendingDebouncedHistory();

    const restored = deps.historyStore.redo('timeline', deps.timelineDoc.value);
    if (!restored) return;
    deps.timelineDoc.value = restored;
    deps.duration.value = selectTimelineDurationUs(restored);
    deps.markTimelineAsDirty();
    void deps.requestTimelineSave();
  }

  return {
    applyTimeline,
    batchApplyTimeline,
    undoTimeline,
    redoTimeline,
  };
}
