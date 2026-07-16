import { createDevLogger } from '~/utils/dev-logger';
import type { Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { selectTimelineDurationTicks } from '~/timeline/selectors';
import type {
  TimelineApplyOptions,
  TimelineApplyWithHistoryOptions,
} from '~/timeline/apply-options';
import { TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY } from './history-labels';
import { isTimelinePerfEnabled, markTimeline } from '~/utils/timeline/perf';

import type { TimelineHydrationModule } from './hydration';
import type { TimelineHistoryDebounceModule } from './history-debounce';
const log = createDevLogger('dispatcher');

function countClips(doc: TimelineDocument | null): number {
  if (!doc) return 0;
  let n = 0;
  for (const track of doc.tracks) n += track.items.length;
  return n;
}

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
  onDocumentRestored?: (doc: TimelineDocument) => void;
  notifyWarning?: (messageKey: string) => void;
  isReadOnly?: Ref<boolean>;
}

export interface TimelineDispatcherModule {
  applyTimeline: (cmd: TimelineCommand, options?: TimelineApplyWithHistoryOptions) => string[];
  batchApplyTimeline: (cmds: TimelineCommand[], options?: TimelineApplyOptions) => string[];
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
    options?: TimelineApplyWithHistoryOptions,
  ): string[] {
    if (deps.isReadOnly?.value) {
      log.warn('Timeline command ignored: timeline is read-only');
      return [];
    }

    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const perfOn = isTimelinePerfEnabled();
    const tStart = perfOn ? performance.now() : 0;

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
        log.warn('Timeline command rejected: item overlaps with another item', cmd);
        deps.notifyWarning?.('fastcat.timeline.itemOverlap');
        return [];
      }
      if (error instanceof Error && error.message === 'Marker already exists at this time') {
        log.warn('Timeline command rejected: marker already exists at this time', cmd);
        deps.notifyWarning?.('fastcat.timeline.markerAlreadyExists');
        return [];
      }
      log.warn('Failed to apply timeline command:', error, cmd);
      return [];
    }

    if (next === prev) return [];

    const tApplied = perfOn ? performance.now() : 0;

    if (!options?.skipHistory) {
      deps.historyDebounce.pushHistory(cmd, prev, options);
    }
    const tHistory = perfOn ? performance.now() : 0;

    deps.timelineDoc.value = next;
    const nextDuration = selectTimelineDurationTicks(next);
    if (nextDuration !== deps.duration.value) {
      deps.duration.value = nextDuration;
    }
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

    if (perfOn) {
      const tEnd = performance.now();
      markTimeline(
        `applyTimeline[${cmd.type}]`,
        tEnd - tStart,
        `clips=${countClips(next)}, apply=${(tApplied - tStart).toFixed(1)}ms, ` +
          `history=${(tHistory - tApplied).toFixed(1)}ms, commit=${(tEnd - tHistory).toFixed(1)}ms`,
      );
    }

    return createdItemIds ?? [];
  }

  function batchApplyTimeline(cmds: TimelineCommand[], options?: TimelineApplyOptions): string[] {
    if (deps.isReadOnly?.value) {
      log.warn('Timeline command ignored: timeline is read-only');
      return [];
    }

    if (cmds.length === 0) return [];
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const perfOn = isTimelinePerfEnabled();
    const tStart = perfOn ? performance.now() : 0;

    const prev = deps.timelineDoc.value;
    let current = prev;
    const allCreatedItemIds: string[] = [];
    let batchFailed = false;

    for (const cmd of cmds) {
      // Per-command targeted hydration patches the clip this command operates on
      // (sourceDurationTicks/isImage) before applying. The broad `hydrateAllClips`
      // pass is hoisted out of the loop below — running it per command made a
      // batch O(commands × clips); positional move/trim/split/delete commands
      // don't depend on *other* clips' hydration state, so one pass at the end
      // yields the same final document.
      const hydrated = deps.hydration.hydrateClipSourceDuration(current, cmd);
      try {
        const { next, createdItemIds } = applyTimelineCommand(hydrated, cmd);
        current = next;
        if (createdItemIds) {
          allCreatedItemIds.push(...createdItemIds);
        }
      } catch (error) {
        const overlap =
          error instanceof Error && error.message === 'Item overlaps with another item';
        const markerExists =
          error instanceof Error && error.message === 'Marker already exists at this time';
        if (overlap) {
          log.warn('Timeline batch command rejected: item overlaps with another item', cmd);
          deps.notifyWarning?.('fastcat.timeline.itemOverlap');
        } else if (markerExists) {
          log.warn('Timeline batch command rejected: marker already exists at this time', cmd);
          deps.notifyWarning?.('fastcat.timeline.markerAlreadyExists');
        } else {
          log.warn('Failed to apply timeline command in batch:', error, cmd);
        }
        // The batch is atomic: any failure rolls back to the document state
        // that existed before the first command ran, so we never leave a
        // half-applied state in the doc or in history.
        batchFailed = true;
        break;
      }
    }

    if (batchFailed) return [];

    // Single broad hydration pass for the whole batch (was per-command above).
    current = deps.hydration.hydrateAllClips(current);

    if (current === prev) return [];

    const tApplied = perfOn ? performance.now() : 0;

    if (!options?.skipHistory) {
      deps.historyDebounce.pushHistory(cmds[0]!, prev, {
        ...options,
        historyMode: options?.historyMode ?? 'immediate',
        labelKey:
          options?.labelKey ?? (cmds.length > 1 ? TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY : undefined),
      });
    }
    const tHistory = perfOn ? performance.now() : 0;

    deps.timelineDoc.value = current;
    const nextDuration = selectTimelineDurationTicks(current);
    if (nextDuration !== deps.duration.value) {
      deps.duration.value = nextDuration;
    }
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

    if (perfOn) {
      const tEnd = performance.now();
      markTimeline(
        `batchApplyTimeline[${cmds.length}]`,
        tEnd - tStart,
        `clips=${countClips(current)}, apply=${(tApplied - tStart).toFixed(1)}ms, ` +
          `history=${(tHistory - tApplied).toFixed(1)}ms, commit=${(tEnd - tHistory).toFixed(1)}ms`,
      );
    }

    return allCreatedItemIds;
  }

  function pushTimelineHistory(preState: TimelineDocument, commandType: string, labelKey: string) {
    // Drag/resize composables commit their changes with skipHistory:true and
    // then push a single entry at the end via this helper. Flush any pending
    // debounced entry first so callers don't have to remember.
    deps.historyDebounce.flushPendingDebouncedHistory();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (deps.historyStore as any).push('timeline', commandType, preState, labelKey);
  }

  function applyRestoredSnapshot(snapshot: TimelineDocument) {
    if (deps.isReadOnly?.value) return;
    if (!snapshot) return;
    if (snapshot === deps.timelineDoc.value) return;
    deps.timelineDoc.value = snapshot;
    const nextDuration = selectTimelineDurationTicks(snapshot);
    if (nextDuration !== deps.duration.value) {
      deps.duration.value = nextDuration;
    }
    deps.markTimelineAsDirty();
    deps.onDocumentRestored?.(snapshot);
    deps.pruneSelection?.(snapshot);
    void deps.requestTimelineSave({ immediate: true });
  }

  function undoTimeline() {
    if (deps.isReadOnly?.value) return;
    if (!deps.timelineDoc.value || !deps.historyStore.canUndo('timeline')) return;

    // Discard any pending debounced history before undoing so the undo targets
    // the last committed entry, not an unflushed debounced one.
    deps.historyDebounce.clearPendingDebouncedHistory();

    const restored = deps.historyStore.undo('timeline', deps.timelineDoc.value);
    if (!restored) return;
    applyRestoredSnapshot(restored);
  }

  function redoTimeline() {
    if (deps.isReadOnly?.value) return;
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
