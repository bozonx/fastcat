import { createDevLogger } from '~/utils/dev-logger';
import { toRaw, type Ref } from 'vue';
import { createAutoSave } from '~/utils/auto-save';
import { toError } from '~/utils/errors';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { postIoInitMessage } from '~/utils/io/io-budget-main';
import { TIMELINE_DEFAULTS } from '~/utils/constants';

import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';
import { getTimelineFps } from '~/timeline/timebase';
const log = createDevLogger('persistence');

export interface TimelinePersistenceDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  /** Flag the upcoming playhead restore as a programmatic move (not a user scrub),
   *  so the monitor's audio scrub-preview stays silent on project open. */
  markProgrammaticSeek: () => void;
  duration: Ref<number>;
  masterGain: Ref<number>;
  timelineZoom: Ref<number>;
  trackHeights: Ref<Record<string, number>>;
  mobileTrackHeightsEnlarged?: Ref<Record<string, boolean>>;
  audioMuted?: Ref<boolean>;
  selectionRange?: Ref<TimelineSelectionRange | null>;

  isTimelineDirty: Ref<boolean>;
  isSavingTimeline: Ref<boolean>;
  isReadOnly?: Ref<boolean>;
  timelineSaveError: Ref<string | null>;

  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;

  readTimelineText: (relativePath: string) => Promise<string | null>;
  writeTimelineText: (relativePath: string, text: string) => Promise<void>;
  deleteTimelinePath: (relativePath: string) => Promise<void>;
  getTimelineMetadata: (
    relativePath: string,
  ) => Promise<{ lastModified: number; size: number } | null>;
  createFallbackTimelineDoc: () => TimelineDocument;

  getProjectSettings: () => { timelines?: { sessions?: Record<string, unknown> } } | null;

  /**
   * Returns the paths of all currently open timeline tabs. Used to evict
   * cached in-memory tab state for timelines that have since been closed.
   */
  getOpenPaths?: () => string[];

  /**
   * Parks the active timeline's undo stack out of the live history store and
   * returns it (opaque), so a background tab keeps its own undo history. Called
   * when the active tab is about to be swapped out.
   */
  captureHistoryState?: () => unknown;
  /**
   * Restores a previously parked undo stack for the now-active tab. Passing
   * `null` clears the timeline history (used for a fresh disk load).
   */
  restoreHistoryState?: (state: unknown) => void;

  parseTimelineFromOtio: (
    text: string,
    options: { id: string; name: string; format: TimelineFormatInput },
    parseOptions?: { logWarnings?: boolean },
  ) => TimelineDocument;
  serializeTimelineToOtio: (doc: TimelineDocument) => string;
  selectTimelineDurationUs: (doc: TimelineDocument) => number;

  shouldRestoreAutosaveSilently?: () => boolean | undefined;
  /**
   * Returns the periodic crash-recovery autosave interval in milliseconds. This
   * timer covers continuous gestures (e.g. drags); discrete edits bypass it with
   * an immediate write. Within a window the timer is armed once and not reset by
   * further edits. Defaults to 2 minutes.
   */
  getAutosaveIntervalMs?: () => number;
  /**
   * Debounce time for the debounced auto-save (used on mobile). Defaults to 500 ms.
   */
  autosaveDebounceMs?: () => number;
  /**
   * When true the persistence module autosaves into the canonical timeline file
   * instead of a crash-recovery sidecar. Used on mobile where explicit “Save”
   * does not exist.
   */
  isMobile?: Ref<boolean>;
  /**
   * Called before switching away from a dirty timeline on mobile so a backup
   * snapshot can be created.
   */
  onMobileBackup?: (serialized: string) => Promise<void>;
  /**
   * Deletes the crash-recovery sidecar for the given timeline path. Called on
   * explicit save (the work is now committed) and on clean shutdown.
   */
  deleteAutosaveFile?: (timelinePath: string) => Promise<void>;
  /**
   * Discards the crash-recovery sidecar when the user chooses to open the saved
   * version instead. Unlike {@link deleteAutosaveFile}, this is non-destructive:
   * the sidecar's content is first rotated into the numbered backups so it stays
   * available in the Backups tab for later comparison/restore, then the sidecar
   * is removed (so it isn't mistaken for unsaved work on the next launch).
   */
  discardAutosave?: (timelinePath: string) => Promise<void>;
  /**
   * Notified whenever the dirty state of a specific timeline path changes, so
   * the store can keep per-path (per-tab) dirty indicators in sync.
   */
  onDirtyStateChange?: (timelinePath: string | null, isDirty: boolean) => void;
  confirmRestoreAutosave?: (input: {
    timelinePath: string;
    autosavePath: string;
  }) => boolean | Promise<boolean>;
  showRecoveryDialog?: (input: {
    timelinePath: string;
  }) => Promise<'open-saved' | 'restore-autosave'>;
  onRecoveryChoice?: (choice: 'open-saved') => void;
  exitPreview?: () => void;
  onSaveSuccess?: (serialized: string) => void;
  onSaveError?: (error: unknown) => void;
  onSaveBlockedReadOnly?: () => void;
}

export interface TimelinePersistenceModule {
  resetPersistenceState: () => void;
  getLoadRequestId: () => number;

  markDirty: () => void;
  markCleanForCurrentRevision: () => void;

  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  flushTimelineAutosave: () => Promise<void>;
  loadTimeline: () => Promise<void>;
  saveTimeline: () => Promise<void>;
}

function describeNonCloneable(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  const ctor = (value as object).constructor?.name ?? 'Object';
  return ctor;
}

function describeObjectShape(obj: object): string {
  const ownKeys = Reflect.ownKeys(obj).map((k) => (typeof k === 'symbol' ? k.toString() : k));
  const proto = Object.getPrototypeOf(obj);
  const protoName = proto === null ? 'null' : (proto.constructor?.name ?? 'Object');
  const ctor = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
  return `ctor=${ctor} proto=${protoName} keys=[${ownKeys.join(',')}]`;
}

function findNonCloneablePath(
  value: unknown,
  seen = new WeakSet<object>(),
  path = '$',
): string | null {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return null;
  if (t === 'function' || t === 'symbol') return `${path} (${t})`;
  if (t !== 'object') return null;

  const obj = value as object;
  if (seen.has(obj)) return null;
  seen.add(obj);

  try {
    structuredClone(obj);
    return null;
  } catch {
    // continue narrowing
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const childPath = findNonCloneablePath(obj[i], seen, `${path}[${i}]`);
      if (childPath) return childPath;
    }
    return `${path} <Array ${describeNonCloneable(obj)}> shape: ${describeObjectShape(obj)}`;
  }

  const proto = Object.getPrototypeOf(obj);
  const isPlain = proto === Object.prototype || proto === null;
  if (!isPlain) {
    return `${path} <${describeNonCloneable(obj)}> shape: ${describeObjectShape(obj)}`;
  }

  for (const key of Reflect.ownKeys(obj)) {
    let child: unknown;
    try {
      child = (obj as Record<PropertyKey, unknown>)[key];
    } catch (e) {
      return `${path}.${String(key)} (getter threw: ${(e as Error)?.message ?? e})`;
    }
    const childPath = findNonCloneablePath(child, seen, `${path}.${String(key)}`);
    if (childPath) return childPath;
  }
  return `${path} <${describeNonCloneable(obj)}> shape: ${describeObjectShape(obj)}`;
}

// `toRaw` only unwraps the outermost reactive proxy. Vue lazily wraps nested
// objects on first access, and commands that build new doc state via
// `{ ...doc, ... }` end up storing those nested Proxies back into the target.
// `structuredClone` (used by `postMessage`) refuses to clone Proxy objects, so
// any save would throw `DataCloneError`. We deep-unwrap before posting.
function deepToRaw<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const raw = toRaw(value as object) as Record<PropertyKey, unknown>;
  if (Array.isArray(raw)) {
    return raw.map((item) => deepToRaw(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    out[key] = deepToRaw(raw[key]);
  }
  return out as T;
}

function serializeInWorker(doc: TimelineDocument): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/timeline-serializer.worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );
    postIoInitMessage(worker);
    worker.onmessage = (e) => {
      if (e.data.success) {
        resolve(e.data.serialized);
      } else {
        reject(new Error(e.data.error));
      }
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(e);
      worker.terminate();
    };
    const raw = deepToRaw(doc);
    try {
      worker.postMessage(raw);
    } catch (e) {
      const path = findNonCloneablePath(raw);
      log.error('[timeline persistence] non-cloneable value in TimelineDocument at', path, e);
      log.error('[timeline persistence] raw doc snapshot:', raw);
      worker.terminate();
      reject(toError(e));
    }
  });
}

export function createTimelinePersistenceModule(
  deps: TimelinePersistenceDeps,
): TimelinePersistenceModule {
  let loadTimelineRequestId = 0;
  let currentRevision = 0;
  let mainSavedRevision = 0;

  // Live in-memory state per open tab. Only one timeline doc is *active* at a
  // time, but switching tabs must not lose the outgoing tab's uncommitted edits
  // by re-reading the canonical file. We snapshot the outgoing tab here before
  // its doc is replaced, and restore it on switch-back — instant, no disk read,
  // no data loss. The crash-recovery sidecar is now used ONLY for true first
  // loads / startup recovery, never as the transport for tab switching.
  interface TabState {
    doc: TimelineDocument;
    currentRevision: number;
    mainSavedRevision: number;
    currentTime: number;
    duration: number;
    masterGain: number;
    audioMuted: boolean;
    timelineZoom: number;
    trackHeights: Record<string, number>;
    mobileTrackHeightsEnlarged: Record<string, boolean>;
    selectionRange: TimelineSelectionRange | null;
    history: unknown;
  }
  const tabCache = new Map<string, TabState>();
  // Path of the timeline whose state currently lives in the active refs/doc.
  // Distinct from `currentTimelinePath`, which is switched to the *incoming*
  // path before `loadTimeline` runs.
  let lastLoadedPath: string | null = null;

  function captureTabState(path: string) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    tabCache.set(path, {
      doc: toRaw(doc),
      currentRevision,
      mainSavedRevision,
      currentTime: deps.currentTime.value,
      duration: deps.duration.value,
      masterGain: deps.masterGain.value,
      audioMuted: deps.audioMuted?.value ?? false,
      timelineZoom: deps.timelineZoom.value,
      trackHeights: { ...deps.trackHeights.value },
      mobileTrackHeightsEnlarged: { ...(deps.mobileTrackHeightsEnlarged?.value ?? {}) },
      selectionRange: deps.selectionRange?.value ? { ...deps.selectionRange.value } : null,
      // Park the outgoing tab's undo stack out of the live store so it travels
      // with the tab (and can't bleed into the incoming tab's undo/redo).
      history: deps.captureHistoryState?.() ?? null,
    });
  }

  // Snapshot the outgoing tab (the one still in the active refs) before its doc
  // is replaced by the incoming load. No-op on first load and on reloads of the
  // same path.
  function snapshotOutgoingTab() {
    const incoming = deps.currentTimelinePath.value;
    if (lastLoadedPath && lastLoadedPath !== incoming && deps.timelineDoc.value) {
      captureTabState(lastLoadedPath);
    }
  }

  // Forget cached state for tabs that are no longer open, so closing a tab
  // releases its memory and a reopened tab loads fresh from disk.
  function pruneClosedTabs() {
    const open = deps.getOpenPaths?.();
    if (!open) return;
    const openSet = new Set(open);
    for (const key of tabCache.keys()) {
      if (!openSet.has(key)) tabCache.delete(key);
    }
  }

  function restoreTabFromCache(path: string): boolean {
    const state = tabCache.get(path);
    if (!state) return false;
    deps.timelineDoc.value = state.doc;
    currentRevision = state.currentRevision;
    mainSavedRevision = state.mainSavedRevision;
    deps.markProgrammaticSeek();
    deps.currentTime.value = state.currentTime;
    deps.duration.value = state.duration;
    deps.masterGain.value = state.masterGain;
    if (deps.audioMuted) deps.audioMuted.value = state.audioMuted;
    deps.timelineZoom.value = state.timelineZoom;
    deps.trackHeights.value = { ...state.trackHeights };
    if (deps.mobileTrackHeightsEnlarged) {
      deps.mobileTrackHeightsEnlarged.value = { ...state.mobileTrackHeightsEnlarged };
    }
    if (deps.selectionRange) {
      deps.selectionRange.value = state.selectionRange ? { ...state.selectionRange } : null;
    }
    deps.restoreHistoryState?.(state.history);
    deps.timelineSaveError.value = null;
    setDirtyState();
    return true;
  }

  function isDirty() {
    return mainSavedRevision < currentRevision;
  }

  function setDirtyState() {
    const dirty = isDirty();
    deps.isTimelineDirty.value = dirty;
    deps.onDirtyStateChange?.(deps.currentTimelinePath.value, dirty);
  }

  function getAutosavePath(timelinePath: string) {
    return `.fastcat/autosave/${timelinePath}`;
  }

  async function writeSerializedToPath(relativePath: string, serialized: string) {
    await deps.writeTimelineText(relativePath, serialized);
  }

  async function serializeValidatedTimeline(doc: TimelineDocument) {
    const serialized = await serializeInWorker(toRaw(doc));

    // Validation: prevent writing empty or corrupted data
    if (!serialized || serialized.length < 10) {
      throw new Error('Refusing to save: Serialized timeline data is suspiciously small or empty');
    }

    try {
      JSON.parse(serialized);
    } catch (e) {
      log.error('Invalid timeline serialization', e, serialized.substring(0, 100));
      throw new Error('Refusing to save: Invalid timeline JSON structure');
    }

    return serialized;
  }

  function getRestoreFallbackFormat(doc: TimelineDocument): TimelineFormatInput {
    return (
      doc.metadata?.fastcat?.format ?? { fps: getTimelineFps(doc.timebase, { num: 25, den: 1 }) }
    );
  }

  function restoreSavedTimelineSnapshot(serialized: string, fallbackDoc: TimelineDocument) {
    try {
      const parsed = deps.parseTimelineFromOtio(
        serialized,
        {
          id: fallbackDoc.id,
          name: fallbackDoc.name,
          format: getRestoreFallbackFormat(fallbackDoc),
        },
        { logWarnings: false },
      );

      if (!parsed || !Array.isArray(parsed.tracks)) {
        throw new Error('Parsed timeline snapshot is invalid');
      }

      deps.timelineDoc.value = parsed;
      deps.duration.value = deps.selectTimelineDurationUs(parsed);
      deps.currentTime.value = Math.min(
        Math.max(0, Math.round(deps.currentTime.value)),
        Math.max(0, Math.round(deps.duration.value)),
      );
    } catch (e) {
      log.warn('Failed to restore saved timeline snapshot after write', e);
    }
  }

  // Crash-recovery autosave has two paths. Discrete edits (trim commit, paste,
  // context-menu ops, hotkeys, etc.) request an *immediate* sidecar write via
  // `requestTimelineSave({ immediate: true })`. Continuous gestures (e.g. clip
  // drags) instead use this periodic timer: the first change after a clean state
  // arms a single timer; further edits within the window do not reset it; when
  // it fires the accumulated state is written to the sidecar.
  let autosaveTimer: number | null = null;
  let autosaveGeneration = 0;

  function clearAutosaveTimer() {
    if (typeof window === 'undefined') return;
    if (autosaveTimer === null) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  function getAutosaveIntervalMs() {
    const raw = deps.getAutosaveIntervalMs?.() ?? 120_000;
    // Guard against misconfiguration; never autosave more often than every 30s.
    return Number.isFinite(raw) && raw >= 30_000 ? raw : 120_000;
  }

  function scheduleAutosave() {
    if (!deps.timelineDoc.value || !isDirty()) return;
    if (deps.isReadOnly?.value) return;
    if (deps.isMobile?.value) {
      // On mobile the debounced autoSave writes directly to the main file
      void autoSave.requestSave();
      return;
    }
    if (typeof window === 'undefined') {
      void flushTimelineAutosave();
      return;
    }
    if (autosaveTimer !== null) return;
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      void flushTimelineAutosave();
    }, getAutosaveIntervalMs());
  }

  async function flushTimelineAutosave() {
    clearAutosaveTimer();
    await autoSave.requestSave({ immediate: true });
  }

  const autoSave = createAutoSave({
    debounceMs: deps.autosaveDebounceMs?.() ?? 500,
    doSave: async () => {
      const doc = deps.timelineDoc.value;
      if (!doc || !isDirty()) return false;
      if (deps.isReadOnly?.value) return false;

      const currentProjectId = deps.currentProjectName.value;
      const currentTimelinePath = deps.currentTimelinePath.value;
      const generation = autosaveGeneration;
      const revisionToSave = currentRevision;

      if (!currentProjectId || !currentTimelinePath) return false;

      deps.timelineSaveError.value = null;

      try {
        if (
          currentProjectId !== deps.currentProjectName.value ||
          currentTimelinePath !== deps.currentTimelinePath.value
        ) {
          return false;
        }

        const isMobile = deps.isMobile?.value ?? false;
        const targetPath = isMobile ? currentTimelinePath : getAutosavePath(currentTimelinePath);
        const serialized = await serializeValidatedTimeline(doc);
        if (generation !== autosaveGeneration || !isDirty()) return false;

        await writeSerializedToPath(targetPath, serialized);
        if (generation !== autosaveGeneration || !isDirty()) {
          return false;
        }

        if (
          currentProjectId === deps.currentProjectName.value &&
          currentTimelinePath === deps.currentTimelinePath.value &&
          currentRevision === revisionToSave
        ) {
          restoreSavedTimelineSnapshot(serialized, doc);
        }

        // On mobile the autosave IS the canonical save, so advance the main saved
        // revision so the dirty indicator drops immediately.
        if (isMobile) {
          if (mainSavedRevision < currentRevision) {
            mainSavedRevision = currentRevision;
            setDirtyState();
          }
        }

        return true;
      } catch (e: unknown) {
        deps.timelineSaveError.value =
          e instanceof Error ? e.message : 'Failed to auto-save timeline file';
        log.warn('Failed to auto-save timeline file', e);
        throw e;
      }
    },
    onError: (e) => {
      log.error('Failed to save timeline', e);
      deps.onSaveError?.(e);
    },
  });

  function resetPersistenceState() {
    clearAutosaveTimer();
    autoSave.reset();
    tabCache.clear();
    lastLoadedPath = null;
    currentRevision = 0;
    mainSavedRevision = 0;
    setDirtyState();
    loadTimelineRequestId += 1;
    autosaveGeneration += 1;
  }

  function getLoadRequestId() {
    return loadTimelineRequestId;
  }

  function markCleanForCurrentRevision() {
    mainSavedRevision = currentRevision;
    autoSave.markCleanForCurrentRevision();
    setDirtyState();
  }

  function markDirty() {
    currentRevision += 1;
    setDirtyState();
    autoSave.markDirty();
  }

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    if (!deps.timelineDoc.value) return;
    if (deps.isMobile?.value) {
      await autoSave.requestSave(options);
      return;
    }
    if (options?.immediate) {
      await flushTimelineAutosave();
    } else {
      scheduleAutosave();
    }
  }

  async function loadTimeline() {
    if (!deps.currentProjectName.value || !deps.currentTimelinePath.value) return;

    if (deps.exitPreview) {
      deps.exitPreview();
    }

    // Mobile backup before switching away from a dirty timeline.
    if (deps.isMobile?.value && isDirty() && deps.timelineDoc.value) {
      const serialized = await serializeValidatedTimeline(deps.timelineDoc.value);
      await deps.onMobileBackup?.(serialized);
    }

    // Preserve the outgoing tab's live edits in memory before its doc is
    // replaced, and drop any cache entries for tabs that were closed meanwhile.
    snapshotOutgoingTab();
    pruneClosedTabs();

    const requestId = ++loadTimelineRequestId;
    clearAutosaveTimer();
    autoSave.reset();

    const incoming = deps.currentTimelinePath.value;

    // Fast path: we're switching back to a tab whose live state is still in
    // memory. Restore it instantly — no disk read, no data loss, sidecar left
    // untouched. The periodic autosave timer is re-armed only if it's dirty.
    if (restoreTabFromCache(incoming)) {
      lastLoadedPath = incoming;
      if (isDirty()) scheduleAutosave();
      return;
    }

    // Disk load (fresh open / reload-current): start the new doc with an empty
    // undo stack. The outgoing tab's stack was already parked by
    // `snapshotOutgoingTab`; this also discards any stale stack on a same-path
    // reload.
    deps.restoreHistoryState?.(null);

    let restoredAutosave = false;

    const fallback = deps.createFallbackTimelineDoc();

    try {
      const mainPath = deps.currentTimelinePath.value;

      let text = '';
      let mainMeta = null;

      if (!deps.isMobile?.value) {
        const autosavePath = getAutosavePath(mainPath);

        // Independent stat calls — fetch them concurrently rather than chaining.
        const [mainMetaRaw, autosaveMeta] = await Promise.all([
          deps.getTimelineMetadata(mainPath),
          deps.getTimelineMetadata(autosavePath),
        ]);
        mainMeta = mainMetaRaw;

        if (!mainMeta && !autosaveMeta) {
          if (requestId !== loadTimelineRequestId) return;
          deps.timelineDoc.value = fallback;
          return;
        }

        text = mainMeta
          ? ((await withFileIoSlot(() => deps.readTimelineText(mainPath))) ?? '')
          : '';
        let shouldOfferAutosave =
          !!autosaveMeta && (!mainMeta || autosaveMeta.lastModified >= mainMeta.lastModified);

        // Suppress spurious recovery: a best-effort sidecar delete that failed
        // after a clean save (or an autosave that wrote byte-identical content) can
        // leave a sidecar that's newer-but-equal. Only pay for the extra read when
        // the sizes match exactly; if the content is identical there's nothing to
        // recover, so drop the redundant sidecar and load the saved file silently.
        if (
          shouldOfferAutosave &&
          mainMeta &&
          autosaveMeta &&
          mainMeta.size === autosaveMeta.size
        ) {
          const autosaveText =
            (await withFileIoSlot(() => deps.readTimelineText(autosavePath))) ?? '';
          if (autosaveText && autosaveText === text) {
            shouldOfferAutosave = false;
            try {
              await deps.deleteAutosaveFile?.(mainPath);
            } catch (e) {
              log.warn('Failed to remove redundant identical autosave sidecar', e);
            }
          }
        }

        if (shouldOfferAutosave) {
          if (deps.shouldRestoreAutosaveSilently?.()) {
            text = (await withFileIoSlot(() => deps.readTimelineText(autosavePath))) ?? '';
            restoredAutosave = true;
          } else if (deps.showRecoveryDialog) {
            const choice = await deps.showRecoveryDialog({ timelinePath: mainPath });
            if (choice === 'restore-autosave') {
              text = (await withFileIoSlot(() => deps.readTimelineText(autosavePath))) ?? '';
              restoredAutosave = true;
            } else {
              deps.onRecoveryChoice?.(choice);
              if (choice === 'open-saved') {
                try {
                  await deps.discardAutosave?.(mainPath);
                } catch (e) {
                  log.warn('Failed to discard autosave sidecar', e);
                }
              }
            }
          } else {
            const shouldRestore =
              (await deps.confirmRestoreAutosave?.({ timelinePath: mainPath, autosavePath })) ??
              false;
            if (shouldRestore) {
              text = (await withFileIoSlot(() => deps.readTimelineText(autosavePath))) ?? '';
              restoredAutosave = true;
            }
          }
        }
      } else {
        // Mobile: no crash-recovery sidecar; load directly from the canonical file.
        mainMeta = await deps.getTimelineMetadata(mainPath);
        if (!mainMeta) {
          if (requestId !== loadTimelineRequestId) return;
          deps.timelineDoc.value = fallback;
          return;
        }
        text = (await withFileIoSlot(() => deps.readTimelineText(mainPath))) ?? '';
      }

      if (!text) {
        if (requestId !== loadTimelineRequestId) return;
        deps.timelineDoc.value = fallback;
        return;
      }

      const parsed = deps.parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        format: getRestoreFallbackFormat(fallback),
      });
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = parsed;

      const path = deps.currentTimelinePath.value;
      const settings = path ? deps.getProjectSettings() : null;
      const session = (settings?.timelines?.sessions?.[path] ?? null) as Record<
        string,
        unknown
      > | null;

      deps.markProgrammaticSeek();
      deps.currentTime.value = Number(session?.playheadUs ?? 0);
      deps.masterGain.value = Number(session?.masterGain ?? 1);
      if (deps.audioMuted) deps.audioMuted.value = Boolean(session?.masterMuted ?? false);
      deps.timelineZoom.value = Number(session?.zoom ?? TIMELINE_DEFAULTS.ZOOM);
      deps.trackHeights.value = session?.trackHeights
        ? { ...(session.trackHeights as Record<string, number>) }
        : {};
      if (deps.mobileTrackHeightsEnlarged) {
        deps.mobileTrackHeightsEnlarged.value = session?.mobileTrackHeightsEnlarged
          ? { ...(session.mobileTrackHeightsEnlarged as Record<string, boolean>) }
          : {};
      }
      if (deps.selectionRange) {
        deps.selectionRange.value = session?.selectionRange
          ? ({ ...(session.selectionRange as Record<string, unknown>) } as {
              startUs: number;
              endUs: number;
            })
          : null;
      }
    } catch (e: unknown) {
      log.warn('Failed to load timeline file, fallback to default', e);
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = fallback;
    } finally {
      if (requestId === loadTimelineRequestId) {
        deps.duration.value = deps.timelineDoc.value
          ? deps.selectTimelineDurationUs(deps.timelineDoc.value)
          : 0;
        deps.currentTime.value = Math.min(
          Math.max(0, Math.round(deps.currentTime.value)),
          Math.max(0, Math.round(deps.duration.value)),
        );
        currentRevision = restoredAutosave ? 1 : 0;
        mainSavedRevision = 0;
        autoSave.reset();
        setDirtyState();
        deps.timelineSaveError.value = null;
        lastLoadedPath = deps.currentTimelinePath.value;
      }
    }
  }

  async function saveTimeline() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    if (deps.isReadOnly?.value) {
      deps.onSaveBlockedReadOnly?.();
      return;
    }

    const currentProjectId = deps.currentProjectName.value;
    const currentTimelinePath = deps.currentTimelinePath.value;
    if (!currentProjectId || !currentTimelinePath) return;

    const revisionToSave = currentRevision;
    autosaveGeneration += 1;
    deps.isSavingTimeline.value = true;
    deps.timelineSaveError.value = null;
    try {
      if (
        currentProjectId !== deps.currentProjectName.value ||
        currentTimelinePath !== deps.currentTimelinePath.value
      ) {
        return;
      }

      const timelinePath = currentTimelinePath;
      const serialized = await serializeValidatedTimeline(doc);
      await writeSerializedToPath(timelinePath, serialized);

      if (
        currentProjectId === deps.currentProjectName.value &&
        currentTimelinePath === deps.currentTimelinePath.value &&
        currentRevision === revisionToSave
      ) {
        restoreSavedTimelineSnapshot(serialized, doc);
      }

      if (
        currentProjectId === deps.currentProjectName.value &&
        currentTimelinePath === deps.currentTimelinePath.value &&
        mainSavedRevision < revisionToSave
      ) {
        mainSavedRevision = revisionToSave;
        setDirtyState();
      }

      // The committed canonical file is now the source of truth. If the save
      // captured everything, the crash-recovery sidecar is redundant — remove
      // it so a leftover sidecar can't be mistaken for unsaved work on next
      // launch. If edits landed mid-save (still dirty), keep the sidecar (it
      // holds the latest autosaved state) and re-arm the periodic timer.
      if (
        currentProjectId === deps.currentProjectName.value &&
        currentTimelinePath === deps.currentTimelinePath.value
      ) {
        if (!isDirty()) {
          clearAutosaveTimer();
          autoSave.markCleanForCurrentRevision();
          try {
            await deps.deleteAutosaveFile?.(currentTimelinePath);
          } catch (e) {
            log.warn('Failed to remove autosave sidecar after save', e);
          }
        } else {
          scheduleAutosave();
        }
      }

      deps.onSaveSuccess?.(serialized);
    } catch (e: unknown) {
      deps.timelineSaveError.value =
        e instanceof Error ? e.message : 'Failed to save timeline file';
      log.warn('Failed to save timeline file', e);
      deps.onSaveError?.(e);
      throw e;
    } finally {
      if (
        currentProjectId === deps.currentProjectName.value &&
        currentTimelinePath === deps.currentTimelinePath.value
      ) {
        deps.isSavingTimeline.value = false;
      }
    }
  }

  return {
    resetPersistenceState,
    getLoadRequestId,
    markDirty,
    markCleanForCurrentRevision,
    requestTimelineSave,
    flushTimelineAutosave,
    loadTimeline,
    saveTimeline,
  };
}
