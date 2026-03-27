import { defineStore } from 'pinia';
import { computed, ref, toRaw } from 'vue';

import { useWorkspaceStore } from './workspace.store';

export interface HistoryEntry<T = unknown> {
  id: number;
  labelKey: string;
  scope: string; // e.g. 'timeline', 'fileManager'
  commandType: string;
  /** Snapshot of the document BEFORE the command was applied.
   *  For snapshot-based scopes: the document state.
   *  For command-based scopes: { undo: Command, redo: Command }
   */
  snapshot: T;
  timestamp: number;
}

let entryIdCounter = 0;

export const useHistoryStore = defineStore('history', () => {
  const workspaceStore = useWorkspaceStore();
  const maxEntries = computed(() => workspaceStore.userSettings.history.maxEntries);

  /** Past states: index 0 is the oldest, last is the most recent undo target */
  const past = ref<HistoryEntry<any>[]>([]);
  /** Future states available for redo, index 0 is the next redo */
  const future = ref<HistoryEntry<any>[]>([]);

  /** Scopes that use command-based history (store undo/redo commands instead of snapshots) */
  const commandScopes = new Set<string>();

  const stateGetters = new Map<string, (entry: HistoryEntry<any>) => any>();

  function registerStateGetter(scope: string, getter: (entry: HistoryEntry<any>) => any) {
    stateGetters.set(scope, getter);
  }

  function registerCommandScope(scope: string) {
    commandScopes.add(scope);
  }

  function isCommandScope(scope: string): boolean {
    return commandScopes.has(scope);
  }

  function canUndo(scope?: string) {
    if (!scope) return past.value.length > 0;
    return past.value.filter((e) => e.scope === scope).length > 0;
  }

  function canRedo(scope?: string) {
    if (!scope) return future.value.length > 0;
    return future.value.filter((e) => e.scope === scope).length > 0;
  }

  function lastEntry(scope?: string) {
    const entries = scope ? past.value.filter((e) => e.scope === scope) : past.value;
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
      snapshot: isCommandScope(scope) ? snapshot : structuredClone(toRaw(snapshot)),
      timestamp: Date.now(),
    };

    past.value.push(entry);

    if (past.value.length > maxEntries.value) {
      past.value.splice(0, past.value.length - maxEntries.value);
    }

    // Branching: clear redo stack for this scope on new action
    // Global history: clear ALL future for any new action to stay consistent
    future.value = [];
  }

  /**
   * Moves the top past entry for a scope into the future stack and returns the snapshot
   * that should be restored as the current document.
   * For command-based scopes, returns the undo command.
   */
  function undo<T>(scope: string, currentDoc: T): T | null {
    const scopePast = past.value.filter((e) => e.scope === scope);
    const entry = scopePast[scopePast.length - 1];
    if (!entry) return null;

    // Remove from past
    const idx = past.value.lastIndexOf(entry);
    past.value.splice(idx, 1);

    // For command-based scopes, preserve the full snapshot (undo/redo commands)
    // For snapshot-based scopes, save currentDoc for redo
    if (isCommandScope(scope)) {
      future.value.unshift(entry);
    } else {
      future.value.unshift({
        ...entry,
        snapshot: structuredClone(toRaw(currentDoc)),
      });
    }

    return entry.snapshot as T;
  }

  /**
   * Moves the first future entry for a scope into the past stack and returns the snapshot
   * to restore.
   * For command-based scopes, returns the redo command.
   */
  function redo<T>(scope: string, currentDoc: T): T | null {
    const scopeFuture = future.value.filter((e) => e.scope === scope);
    const entry = scopeFuture[0];
    if (!entry) return null;

    // Remove from future
    const idx = future.value.indexOf(entry);
    future.value.splice(idx, 1);

    // For command-based scopes, preserve the full snapshot (undo/redo commands)
    // For snapshot-based scopes, save currentDoc for undo
    if (isCommandScope(scope)) {
      past.value.push(entry);
    } else {
      past.value.push({
        ...entry,
        snapshot: structuredClone(toRaw(currentDoc)),
      });
    }

    return entry.snapshot as T;
  }

  function undoGlobal(): HistoryEntry<any> | null {
    const entry = past.value[past.value.length - 1];
    if (!entry) return null;

    const scope = entry.scope;
    try {
      const currentDoc = stateGetters.get(scope)?.(entry);
      const snapshot = undo(scope, currentDoc);
      if (snapshot === null) return null;

      // For command-based scopes, extract the appropriate command
      if (isCommandScope(scope) && snapshot && typeof snapshot === 'object' && 'undo' in snapshot) {
        return {
          ...entry,
          snapshot: (snapshot as { undo: unknown; redo: unknown }).undo,
        };
      }

      return {
        ...entry,
        snapshot,
      };
    } catch (error) {
      console.error(`Failed to undo global action for scope ${scope}:`, error);
      return null;
    }
  }

  function redoGlobal(): HistoryEntry<any> | null {
    const entry = future.value[0];
    if (!entry) return null;

    const scope = entry.scope;
    try {
      const currentDoc = stateGetters.get(scope)?.(entry);
      const snapshot = redo(scope, currentDoc);
      if (snapshot === null) return null;

      // For command-based scopes, extract the appropriate command
      if (isCommandScope(scope) && snapshot && typeof snapshot === 'object' && 'redo' in snapshot) {
        return {
          ...entry,
          snapshot: (snapshot as { undo: unknown; redo: unknown }).redo,
        };
      }

      return {
        ...entry,
        snapshot,
      };
    } catch (error) {
      console.error(`Failed to redo global action for scope ${scope}:`, error);
      return null;
    }
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
    undoGlobal,
    redoGlobal,
    registerStateGetter,
    registerCommandScope,
    isCommandScope,
    clear,
    clearAll,
  };
});
