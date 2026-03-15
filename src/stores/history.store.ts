import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const MAX_HISTORY_SIZE = 100;

export interface HistoryEntry<T = unknown> {
  id: number;
  labelKey: string;
  scope: string; // e.g. 'timeline', 'fileManager'
  commandType: string;
  /** Snapshot of the document BEFORE the command was applied */
  snapshot: T;
  timestamp: number;
}

let entryIdCounter = 0;

export const useHistoryStore = defineStore('history', () => {
  /** Past states: index 0 is the oldest, last is the most recent undo target */
  const past = ref<HistoryEntry<any>[]>([]);
  /** Future states available for redo, index 0 is the next redo */
  const future = ref<HistoryEntry<any>[]>([]);

  // We can provide getters for specific scopes if needed
  function canUndo(scope: string) {
    return past.value.filter((e) => e.scope === scope).length > 0;
  }

  function canRedo(scope: string) {
    return future.value.filter((e) => e.scope === scope).length > 0;
  }

  function lastEntry(scope: string) {
    const entries = past.value.filter((e) => e.scope === scope);
    return entries[entries.length - 1] ?? null;
  }

  /**
   * Records a snapshot before a command is applied.
   * Should be called BEFORE mutating the document.
   */
  function push<T>(scope: string, commandType: string, snapshot: T, labelKey: string) {
    const entry: HistoryEntry<T> = {
      id: ++entryIdCounter,
      labelKey,
      scope,
      commandType,
      snapshot,
      timestamp: Date.now(),
    };

    past.value.push(entry);

    if (past.value.length > MAX_HISTORY_SIZE) {
      past.value.splice(0, past.value.length - MAX_HISTORY_SIZE);
    }

    // Branching: clear redo stack for this scope on new action
    future.value = future.value.filter((e) => e.scope !== scope);
  }

  /**
   * Moves the top past entry for a scope into the future stack and returns the snapshot
   * that should be restored as the current document.
   */
  function undo<T>(scope: string, currentDoc: T): T | null {
    const scopePast = past.value.filter((e) => e.scope === scope);
    const entry = scopePast[scopePast.length - 1];
    if (!entry) return null;

    // Remove from past
    const idx = past.value.lastIndexOf(entry);
    past.value.splice(idx, 1);

    future.value.unshift({
      ...entry,
      snapshot: currentDoc,
    });

    return entry.snapshot as T;
  }

  /**
   * Moves the first future entry for a scope into the past stack and returns the snapshot
   * to restore.
   */
  function redo<T>(scope: string, currentDoc: T): T | null {
    const scopeFuture = future.value.filter((e) => e.scope === scope);
    const entry = scopeFuture[0];
    if (!entry) return null;

    // Remove from future
    const idx = future.value.indexOf(entry);
    future.value.splice(idx, 1);

    past.value.push({
      ...entry,
      snapshot: currentDoc,
    });

    return entry.snapshot as T;
  }

  /** Clears the entire history for a scope */
  function clear(scope: string) {
    past.value = past.value.filter((e) => e.scope !== scope);
    future.value = future.value.filter((e) => e.scope !== scope);
  }

  /** Clears all history */
  function clearAll() {
    past.value = [];
    future.value = [];
  }

  return {
    past,
    future,
    canUndo,
    canRedo,
    lastEntry,
    push,
    undo,
    redo,
    clear,
    clearAll,
  };
});
