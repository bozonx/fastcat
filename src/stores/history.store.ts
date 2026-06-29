import { createDevLogger } from '~/utils/dev-logger';
import { defineStore } from 'pinia';
import { computed, shallowRef, toRaw, triggerRef } from 'vue';

import { useWorkspaceStore } from './workspace.store';
import { genUuid } from '~/utils/ids';
import { cloneValue } from '~/utils/clone';
const log = createDevLogger('history.store');

export interface HistoryEntry<T = unknown> {
  id: string;
  labelKey: string;
  scope: string; // e.g. 'timeline', 'fileManager'
  commandType: string;
  /** Snapshot of the document BEFORE the command was applied.
   *  For snapshot-based scopes: the document state.
   *  For command-based scopes: { undo: Command, redo: Command }
   */
  snapshot: T;
  timestamp: number;
  /** Estimated retained size of `snapshot` in bytes. Used to bound total
   *  history memory independently of the entry count (snapshot scopes such as
   *  `timeline` deep-clone the whole document, so a few large entries can dwarf
   *  hundreds of small ones). */
  bytes: number;
}

function generateHistoryEntryId(): string {
  return genUuid();
}

/** Rough in-memory size of a (already plain) snapshot. Walks the structure once
 *  — same order of cost as the deep-clone we just did — so it is cheap relative
 *  to the work history already performs per push. Strings count 2 bytes/char
 *  (UTF-16), numbers 8, with a small per-container/key overhead. The absolute
 *  figure does not need to be exact: it only has to be proportional so the
 *  memory budget trims fairly. */
function estimateSnapshotBytes(value: unknown, depth = 0): number {
  if (value == null) return 4;
  const t = typeof value;
  if (t === 'string') return (value as string).length * 2 + 8;
  if (t === 'number') return 8;
  if (t === 'boolean') return 4;
  if (t !== 'object') return 8;
  if (depth > 64) return 0; // guard against cycles / pathological nesting
  if (Array.isArray(value)) {
    let total = 16;
    for (let i = 0; i < value.length; i += 1) total += estimateSnapshotBytes(value[i], depth + 1);
    return total;
  }
  let total = 16;
  for (const key in value as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      total +=
        key.length * 2 + estimateSnapshotBytes((value as Record<string, unknown>)[key], depth + 1);
    }
  }
  return total;
}

/** Deep plain copy for history snapshots. toRaw strips the top-level proxy
 *  (nested reactive proxies are walked via their handlers and clone fine for
 *  plain-data shapes like TimelineDocument); cloneValue then does the
 *  structuredClone-first / JSON-fallback copy shared across the app. */
function cloneHistorySnapshot<T>(snapshot: T): T {
  return cloneValue(toRaw(snapshot as object)) as T;
}

export const useHistoryStore = defineStore('history', () => {
  const workspaceStore = useWorkspaceStore();
  const maxEntries = computed(() => workspaceStore.userSettings.history.maxEntries);
  const maxMemoryBytes = computed(
    () => Math.max(0, workspaceStore.userSettings.history.maxMemoryMb) * 1024 * 1024,
  );

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
    const storedSnapshot = isCommandScope(scope) ? snapshot : cloneHistorySnapshot(snapshot);
    const entry: HistoryEntry<T> = {
      id: generateHistoryEntryId(),
      labelKey,
      scope,
      commandType,
      snapshot: storedSnapshot,
      timestamp: Date.now(),
      bytes: estimateSnapshotBytes(storedSnapshot),
    };

    past.value.push(entry);

    // Branching: clear redo stack for this scope on new action
    // Global history: clear ALL future for any new action to stay consistent
    future.value = [];

    enforceLimitsAndNotify();
  }

  /** Sum of estimated snapshot bytes retained across past + future. */
  function currentMemoryBytes(): number {
    let bytes = 0;
    for (const e of past.value) bytes += e.bytes;
    for (const e of future.value) bytes += e.bytes;
    return bytes;
  }

  /**
   * Bounds history by two independent caps:
   *  - entry count (`maxEntries`) — trims oldest past entries first;
   *  - retained memory (`maxMemoryMb`) — trims oldest past entries, then the
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
    } else {
      const redoSnapshot = cloneHistorySnapshot(currentDoc);
      future.value.unshift({
        ...entry,
        snapshot: redoSnapshot,
        bytes: estimateSnapshotBytes(redoSnapshot),
      });
    }

    enforceLimitsAndNotify();
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
      const undoSnapshot = cloneHistorySnapshot(currentDoc);
      past.value.push({
        ...entry,
        snapshot: undoSnapshot,
        bytes: estimateSnapshotBytes(undoSnapshot),
      });
    }

    enforceLimitsAndNotify();
    return entry.snapshot as T;
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
