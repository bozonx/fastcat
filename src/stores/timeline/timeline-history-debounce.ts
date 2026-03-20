import { ref, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { getTimelineCommandLabelKey } from './timelineHistoryLabels';

export interface TimelineHistoryDebounceDeps {
  historyStore: {
    push: <T>(scope: string, commandType: string, snapshot: T, labelKey: string) => void;
  };
}

export interface TimelineHistoryDebounceApi {
  pendingDebouncedHistory: Ref<{
    snapshot: TimelineDocument;
    cmd: TimelineCommand;
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
    },
  ) => void;
}

export function createTimelineHistoryDebounce(
  deps: TimelineHistoryDebounceDeps,
): TimelineHistoryDebounceApi {
  const pendingDebouncedHistory = ref<{
    snapshot: TimelineDocument;
    cmd: TimelineCommand;
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
    deps.historyStore.push(
      'timeline',
      pending.cmd.type,
      pending.snapshot,
      getTimelineCommandLabelKey(pending.cmd.type),
    );
    pendingDebouncedHistory.value = null;
  }

  function pushHistory(
    cmd: TimelineCommand,
    prevDoc: TimelineDocument,
    options?: {
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) {
    const historyMode = options?.historyMode ?? 'immediate';
    const labelKey = options?.labelKey ?? getTimelineCommandLabelKey(cmd.type);

    if (historyMode === 'debounced') {
      const debounceMs = Math.max(0, Math.round(options?.historyDebounceMs ?? 300));
      const pending = pendingDebouncedHistory.value;

      if (pending) {
        window.clearTimeout(pending.timeoutId);
        pendingDebouncedHistory.value = {
          snapshot: pending.snapshot,
          cmd,
          timeoutId: window.setTimeout(() => {
            const p = pendingDebouncedHistory.value;
            if (!p) return;
            deps.historyStore.push('timeline', p.cmd.type, p.snapshot, labelKey);
            pendingDebouncedHistory.value = null;
          }, debounceMs),
        };
      } else {
        pendingDebouncedHistory.value = {
          snapshot: prevDoc,
          cmd,
          timeoutId: window.setTimeout(() => {
            const p = pendingDebouncedHistory.value;
            if (!p) return;
            deps.historyStore.push('timeline', p.cmd.type, p.snapshot, labelKey);
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
