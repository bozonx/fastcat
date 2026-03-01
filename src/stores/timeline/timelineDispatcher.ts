import type { Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { selectTimelineDurationUs } from '~/timeline/selectors';

import type { TimelineHydrationApi } from './timelineHydration';
import type { TimelineHistoryDebounceApi } from './timelineHistoryDebounce';

export interface TimelineDispatcherDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  duration: Ref<number>;
  createFallbackTimelineDoc: () => TimelineDocument;
  hydration: TimelineHydrationApi;
  historyDebounce: TimelineHistoryDebounceApi;
  historyStore: {
    canUndo: boolean;
    canRedo: boolean;
    undo: (doc: TimelineDocument) => TimelineDocument | null;
    redo: (doc: TimelineDocument) => TimelineDocument | null;
  };
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  markTimelineAsDirty: () => void;
}

export interface TimelineDispatcherApi {
  applyTimeline: (
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
    },
  ) => void;
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      label?: string;
    },
  ) => void;
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
    },
  ) {
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const prev = deps.timelineDoc.value;
    const hydrated = deps.hydration.hydrateClipSourceDuration(deps.timelineDoc.value, cmd);
    const { next } = applyTimelineCommand(hydrated, cmd);
    if (next === prev) return;

    if (!options?.skipHistory) {
      deps.historyDebounce.pushHistory(cmd, prev, options);
    }

    deps.timelineDoc.value = next;
    deps.duration.value = selectTimelineDurationUs(next);
    deps.markTimelineAsDirty();

    const saveMode = options?.saveMode ?? 'debounced';
    if (saveMode === 'immediate') {
      void deps.requestTimelineSave({ immediate: true });
    } else if (saveMode === 'debounced') {
      void deps.requestTimelineSave();
    }
  }

  function batchApplyTimeline(
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      label?: string;
    },
  ) {
    if (cmds.length === 0) return;
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const prev = deps.timelineDoc.value;
    let current = prev;
    for (const cmd of cmds) {
      const hydrated = deps.hydration.hydrateClipSourceDuration(current, cmd);
      const { next } = applyTimelineCommand(hydrated, cmd);
      current = next;
    }

    if (current === prev) return;

    if (!options?.skipHistory) {
      deps.historyDebounce.pushHistory(cmds[0]!, prev, { ...options, historyMode: 'immediate' });
    }

    deps.timelineDoc.value = current;
    deps.duration.value = selectTimelineDurationUs(current);
    deps.markTimelineAsDirty();

    const saveMode = options?.saveMode ?? 'debounced';
    if (saveMode === 'immediate') {
      void deps.requestTimelineSave({ immediate: true });
    } else if (saveMode === 'debounced') {
      void deps.requestTimelineSave();
    }
  }

  function undoTimeline() {
    if (!deps.timelineDoc.value || !deps.historyStore.canUndo) return;
    const restored = deps.historyStore.undo(deps.timelineDoc.value);
    if (!restored) return;
    deps.timelineDoc.value = restored;
    deps.duration.value = selectTimelineDurationUs(restored);
    deps.markTimelineAsDirty();
    void deps.requestTimelineSave();
  }

  function redoTimeline() {
    if (!deps.timelineDoc.value || !deps.historyStore.canRedo) return;
    const restored = deps.historyStore.redo(deps.timelineDoc.value);
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
