import { ref, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineHistoryDebounceDeps {
  historyStore: {
    push: (cmd: TimelineCommand, snapshot: TimelineDocument, labelKey?: string) => void;
  };
}

export interface TimelineHistoryDebounceApi {
  pendingDebouncedHistory: Ref<{
    snapshot: TimelineDocument;
    cmd: TimelineCommand;
    timeoutId: number;
  } | null>;
  clearPendingDebouncedHistory: () => void;
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
            deps.historyStore.push(p.cmd, p.snapshot, options?.labelKey);
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
            deps.historyStore.push(p.cmd, p.snapshot, options?.labelKey);
            pendingDebouncedHistory.value = null;
          }, debounceMs),
        };
      }
    } else {
      clearPendingDebouncedHistory();
      deps.historyStore.push(cmd, prevDoc, options?.labelKey);
    }
  }

  return {
    pendingDebouncedHistory,
    clearPendingDebouncedHistory,
    pushHistory,
  };
}
