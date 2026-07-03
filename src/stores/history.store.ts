import { createDevLogger } from '~/utils/dev-logger';
import { defineStore } from 'pinia';
import { computed, shallowRef, toRaw, triggerRef } from 'vue';

import { useWorkspaceStore } from './workspace.store';
import { genUuid } from '~/utils/ids';
import { isTauriRuntime } from '~/utils/runtime';
const log = createDevLogger('history.store');

/** Fixed undo depth on the web build. The web runs inside a browser tab whose
 *  heap shares a much tighter budget (wasm + SharedArrayBuffer) than the native
 *  shell, so the entry count is hardcoded here rather than user-configurable. */
const WEB_MAX_ENTRIES = 10;

/** Internal safety net bounding total retained undo/redo snapshot memory. This
 *  is NOT user-facing: each snapshot is a full deep clone of the document, so
 *  its cost scales with project size, not edit size — a handful of very large
 *  snapshots on a heavy project can dwarf the entry-count cap. The budget trims
 *  oldest entries beyond this regardless of the entry count. Web is tighter than
 *  desktop for the same reason its entry count is (browser-tab memory). */
const WEB_MEMORY_BUDGET_MB = 256;
const DESKTOP_MEMORY_BUDGET_MB = 512;

export interface HistoryEntry<T = unknown> {
  id: string;
  labelKey: string;
  scope: string; // e.g. 'timeline', 'fileManager'
  commandType: string;
  /** State of the document BEFORE the command was applied.
   *  For snapshot-based scopes (e.g. `timeline`): the document **serialized to a
   *    JSON string**. A flat string is several times cheaper to retain than the
   *    equivalent live object graph (no per-object V8 overhead) and is collected
   *    trivially by GC — the whole reason history stores strings, not clones.
   *  For command-based scopes (e.g. `fileManager`): the `{ undo, redo }` command
   *    object, kept live (it is small and consumed as an object). */
  snapshot: T;
  timestamp: number;
  /** Retained size of `snapshot` in bytes, used to bound total history memory
   *  independently of the entry count. For serialized snapshots this is exact
   *  (`length * 2`, UTF-16); snapshot scopes clone the whole document, so a few
   *  large entries can dwarf hundreds of small ones. */
  bytes: number;
}

function generateHistoryEntryId(): string {
  return genUuid();
}

/** Serialize a snapshot-scope document for storage. toRaw strips the top-level
 *  reactive proxy (nested values serialize fine through their handlers for the
 *  plain-data shapes history stores, e.g. TimelineDocument — the same data that
 *  is already persisted to disk as JSON). */
function serializeSnapshot<T>(snapshot: T): string {
  return JSON.stringify(toRaw(snapshot as object));
}

/** Reconstruct a live document from a stored snapshot string. Each call returns
 *  a fresh object graph, so the restored document is fully decoupled from both
 *  the retained history entry and any other restore. */
function deserializeSnapshot<T>(serialized: string): T {
  return JSON.parse(serialized) as T;
}

/** Exact retained size of a serialized snapshot (UTF-16 = 2 bytes/char). */
function byteSize(serialized: string): number {
  return serialized.length * 2;
}

export const useHistoryStore = defineStore('history', () => {
  const workspaceStore = useWorkspaceStore();
  // Desktop exposes the undo depth as a setting; web pins it to keep tab memory
  // predictable. The memory budget is an internal safety net on both.
  const maxEntries = computed(() =>
    isTauriRuntime() ? workspaceStore.userSettings.history.maxEntries : WEB_MAX_ENTRIES,
  );
  // Internal, non-user-facing budget. A ref (not a bare constant) so tests can
  // shrink it to exercise the trimming path without allocating hundreds of MB.
  const memoryBudgetMb = shallowRef(
    isTauriRuntime() ? DESKTOP_MEMORY_BUDGET_MB : WEB_MEMORY_BUDGET_MB,
  );
  const maxMemoryBytes = computed(() => Math.max(0, memoryBudgetMb.value) * 1024 * 1024);

  // `shallowRef`, not `ref`: history entries hold a deep-cloned whole-document
  // snapshot (the `timeline` scope clones the entire TimelineDocument). With a
  // deep `ref`, every retained snapshot would be wrapped in a reactive proxy
  // tree — pure memory/GC overhead that grows with the history depth, since the
  // snapshots are immutable here and never read reactively field-by-field. The
  // arrays are mutated in place (push/splice/...), so each mutation is followed
  // by an explicit `triggerRef` (centralised in `enforceLimits`, which every
  // push/undo/redo calls; `injectScope` triggers directly). On restore the
  // dispatcher assigns the plain snapshot into the deep `timelineDoc` ref, which
  // reactivises it then — so the live document stays fully reactive.
  /** Past states: index 0 is the oldest, last is the most recent undo target */
  const past = shallowRef<HistoryEntry<unknown>[]>([]);
  /** Future states available for redo, index 0 is the next redo */
  const future = shallowRef<HistoryEntry<unknown>[]>([]);

  /** Scopes that use command-based history (store undo/redo commands instead of snapshots) */
  const commandScopes = new Set<string>(['fileManager']);

  const stateGetters = new Map<string, (entry: HistoryEntry<unknown>) => unknown>();

  function registerStateGetter(scope: string, getter: (entry: HistoryEntry<unknown>) => unknown) {
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
    return past.value.some((e) => e.scope === scope);
  }

  function canRedo(scope?: string) {
    if (!scope) return future.value.length > 0;
    return future.value.some((e) => e.scope === scope);
  }

  function lastEntry(scope?: string) {
    if (!scope) return past.value[past.value.length - 1] ?? null;
    for (let i = past.value.length - 1; i >= 0; i--) {
      if (past.value[i]!.scope === scope) return past.value[i]!;
    }
    return null;
  }

  /**
   * Records a snapshot before a command is applied.
   * Should be called BEFORE mutating the document.
   */
  function push<T>(scope: string, commandType: string, snapshot: T, labelKey: string) {
    const isCmd = isCommandScope(scope);
    // Snapshot scopes are serialized to a JSON string for cheap retention;
    // command scopes keep their small `{ undo, redo }` object live.
    const storedSnapshot = isCmd ? snapshot : serializeSnapshot(snapshot);
    const entry: HistoryEntry<unknown> = {
      id: generateHistoryEntryId(),
      labelKey,
      scope,
      commandType,
      snapshot: storedSnapshot,
      timestamp: Date.now(),
      bytes: isCmd ? byteSize(JSON.stringify(snapshot)) : byteSize(storedSnapshot as string),
    };

    past.value.push(entry);

    // Branching: clear redo stack for this scope on new action
    // Global history: clear ALL future for any new action to stay consistent
    future.value = [];

    enforceLimitsAndNotify();
  }

  /** Sum of retained snapshot bytes across past + future. */
  function currentMemoryBytes(): number {
    let bytes = 0;
    for (const e of past.value) bytes += e.bytes;
    for (const e of future.value) bytes += e.bytes;
    return bytes;
  }

  /**
   * Bounds history by two independent caps:
   *  - entry count (`maxEntries`) — trims oldest past entries first;
   *  - retained memory (`memoryBudgetMb`) — trims oldest past entries, then the
   *    furthest redo entries, until under budget. Always keeps at least the
   *    most recent past entry so a single undo step survives even when one
   *    snapshot alone exceeds the budget.
   */
  function enforceLimits() {
    const total = past.value.length + future.value.length;
    if (total > maxEntries.value) {
      past.value.splice(0, total - maxEntries.value);
    }

    const budget = maxMemoryBytes.value;
    if (budget <= 0) return;

    let bytes = currentMemoryBytes();
    while (bytes > budget && past.value.length > 1) {
      bytes -= past.value.shift()!.bytes;
    }
    // Still over budget: shed the furthest redo entries (index 0 is the next
    // redo, so the oldest/least-likely-needed one is at the end).
    while (bytes > budget && future.value.length > 0) {
      bytes -= future.value.pop()!.bytes;
    }
  }

  /** Notify `shallowRef` subscribers after in-place array mutation. Every
   *  push/undo/redo funnels through `enforceLimits`, so triggering both refs
   *  here covers all the in-place splices/pushes those paths perform. */
  function enforceLimitsAndNotify() {
    enforceLimits();
    triggerRef(past);
    triggerRef(future);
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
      enforceLimitsAndNotify();
      return entry.snapshot as T;
    }

    const redoSnapshot = serializeSnapshot(currentDoc);
    future.value.unshift({
      ...entry,
      snapshot: redoSnapshot,
      bytes: byteSize(redoSnapshot),
    });

    enforceLimitsAndNotify();
    return deserializeSnapshot<T>(entry.snapshot as string);
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
      enforceLimitsAndNotify();
      return entry.snapshot as T;
    }

    const undoSnapshot = serializeSnapshot(currentDoc);
    past.value.push({
      ...entry,
      snapshot: undoSnapshot,
      bytes: byteSize(undoSnapshot),
    });

    enforceLimitsAndNotify();
    return deserializeSnapshot<T>(entry.snapshot as string);
  }

  function undoGlobal(): HistoryEntry<unknown> | null {
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
      log.error(`Failed to undo global action for scope ${scope}:`, error);
      return null;
    }
  }

  function redoGlobal(): HistoryEntry<unknown> | null {
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
      log.error(`Failed to redo global action for scope ${scope}:`, error);
      return null;
    }
  }

  /** Clears the entire history for a scope */
  function clear(scope: string) {
    past.value = past.value.filter((e) => e.scope !== scope);
    future.value = future.value.filter((e) => e.scope !== scope);
  }

  /**
   * Removes and returns all past/future entries for a scope. Used to "park" a
   * background timeline tab's undo stack out of the live store so it neither
   * leaks into the active tab's undo/redo nor into global undo, while staying
   * recoverable when the user switches back. Pairs with `injectScope`.
   */
  function extractScope(scope: string): {
    past: HistoryEntry<unknown>[];
    future: HistoryEntry<unknown>[];
  } {
    const parkedPast = past.value.filter((e) => e.scope === scope);
    const parkedFuture = future.value.filter((e) => e.scope === scope);
    if (parkedPast.length) past.value = past.value.filter((e) => e.scope !== scope);
    if (parkedFuture.length) future.value = future.value.filter((e) => e.scope !== scope);
    return { past: parkedPast, future: parkedFuture };
  }

  /**
   * Re-inserts a previously parked undo stack for a scope. Clears any existing
   * entries of that scope first so a re-injection can never duplicate them.
   */
  function injectScope(
    scope: string,
    state: { past: HistoryEntry<unknown>[]; future: HistoryEntry<unknown>[] } | null,
  ) {
    clear(scope);
    if (!state) return;
    if (state.past.length) {
      past.value.push(...state.past);
      triggerRef(past);
    }
    if (state.future.length) {
      future.value.push(...state.future);
      triggerRef(future);
    }
  }

  /** Clears all history */
  function clearAll() {
    past.value = [];
    future.value = [];
  }

  return {
    past,
    future,
    /** Internal snapshot-memory budget (MB). Not user-facing; exposed only so
     *  tests can shrink it to drive the trimming path. */
    memoryBudgetMb,
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
    extractScope,
    injectScope,
    clearAll,
  };
});
