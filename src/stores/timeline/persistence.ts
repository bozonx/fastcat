import { toRaw, type Ref } from 'vue';
import { createAutoSave } from '~/utils/auto-save';
import { withFileWriteSlot } from '~/utils/io/io-governor';

import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';

export interface TimelinePersistenceDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  masterGain: Ref<number>;
  timelineZoom: Ref<number>;
  trackHeights: Ref<Record<string, number>>;
  audioMuted?: Ref<boolean>;
  selectionRange?: Ref<TimelineSelectionRange | null>;

  isTimelineDirty: Ref<boolean>;
  isSavingTimeline: Ref<boolean>;
  isReadOnly?: Ref<boolean>;
  timelineSaveError: Ref<string | null>;

  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;

  ensureTimelineFileHandle: (options?: {
    create?: boolean;
    relativePath?: string;
  }) => Promise<FileSystemFileHandle | null>;
  createFallbackTimelineDoc: () => TimelineDocument;

  getProjectSettings: () => { timelines?: { sessions?: Record<string, unknown> } } | null;

  parseTimelineFromOtio: (
    text: string,
    options: { id: string; name: string; format: TimelineFormatInput },
  ) => TimelineDocument;
  serializeTimelineToOtio: (doc: TimelineDocument) => string;
  selectTimelineDurationUs: (doc: TimelineDocument) => number;

  shouldRestoreAutosaveSilently?: () => boolean;
  /**
   * Returns the periodic crash-recovery autosave interval in milliseconds.
   * The sidecar is written at most once per interval after the first change,
   * not on every edit. Defaults to 2 minutes.
   */
  getAutosaveIntervalMs?: () => number;
  /**
   * Deletes the crash-recovery sidecar for the given timeline path. Called on
   * explicit save (the work is now committed) and on clean shutdown.
   */
  deleteAutosaveFile?: (timelinePath: string) => Promise<void>;
  /**
   * Notified whenever the dirty state of a specific timeline path changes, so
   * the store can keep per-path (per-tab) dirty indicators in sync.
   */
  onDirtyStateChange?: (timelinePath: string | null, isDirty: boolean) => void;
  confirmRestoreAutosave?: (input: {
    timelinePath: string;
    autosavePath: string;
  }) => boolean | Promise<boolean>;
  onSaveSuccess?: (serialized: string) => void;
  onSaveError?: (error: unknown) => void;
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
    try {
      worker.postMessage(deepToRaw(doc));
    } catch (e) {
      const raw = deepToRaw(doc);
      const path = findNonCloneablePath(raw);
      console.error('[timeline persistence] non-cloneable value in TimelineDocument at', path, e);
      console.error('[timeline persistence] raw doc snapshot:', raw);
      worker.terminate();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function createTimelinePersistenceModule(
  deps: TimelinePersistenceDeps,
): TimelinePersistenceModule {
  let loadTimelineRequestId = 0;
  let currentRevision = 0;
  let mainSavedRevision = 0;

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

  async function writeSerializedToHandle(handle: FileSystemFileHandle, serialized: string) {
    await withFileWriteSlot(async () => {
      const writable = await (
        handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }
      ).createWritable();
      await writable.write(serialized);
      await writable.close();
    });
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
      console.error('Invalid timeline serialization', e, serialized.substring(0, 100));
      throw new Error('Refusing to save: Invalid timeline JSON structure');
    }

    return serialized;
  }

  // Crash-recovery autosave is periodic, not per-edit: the first change after a
  // clean state arms a single timer; further edits within the window do not
  // reset it; when it fires the accumulated state is written to the sidecar.
  let autosaveTimer: number | null = null;

  function clearAutosaveTimer() {
    if (typeof window === 'undefined') return;
    if (autosaveTimer === null) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  function getAutosaveIntervalMs() {
    const raw = deps.getAutosaveIntervalMs?.() ?? 120_000;
    // Guard against misconfiguration; never autosave more often than every 10s.
    return Number.isFinite(raw) && raw >= 10_000 ? raw : 120_000;
  }

  function scheduleAutosave() {
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
    doSave: async () => {
      const doc = deps.timelineDoc.value;
      if (!doc || !isDirty()) return false;
      if (deps.isReadOnly?.value) return false;

      const currentProjectId = deps.currentProjectName.value;
      const currentTimelinePath = deps.currentTimelinePath.value;

      if (!currentProjectId || !currentTimelinePath) return false;

      deps.timelineSaveError.value = null;

      try {
        if (
          currentProjectId !== deps.currentProjectName.value ||
          currentTimelinePath !== deps.currentTimelinePath.value
        ) {
          return false;
        }

        const handle = await deps.ensureTimelineFileHandle({
          create: true,
          relativePath: getAutosavePath(currentTimelinePath),
        });
        if (!handle) return false;

        await writeSerializedToHandle(handle, await serializeValidatedTimeline(doc));
        return true;
      } catch (e: unknown) {
        deps.timelineSaveError.value =
          e instanceof Error ? e.message : 'Failed to auto-save timeline file';
        console.warn('Failed to auto-save timeline file', e);
        throw e;
      }
    },
    onError: (e) => {
      console.error('Failed to save timeline', e);
      deps.onSaveError?.(e);
    },
  });

  function resetPersistenceState() {
    clearAutosaveTimer();
    autoSave.reset();
    currentRevision = 0;
    mainSavedRevision = 0;
    setDirtyState();
    loadTimelineRequestId += 1;
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
    scheduleAutosave();
  }

  // Under the periodic model an edit only ensures the autosave timer is armed;
  // it never forces an immediate sidecar write. Explicit flush points (blur,
  // tab switch, shutdown) call `flushTimelineAutosave` directly instead.
  async function requestTimelineSave(_options?: { immediate?: boolean }) {
    if (!deps.timelineDoc.value) return;
    scheduleAutosave();
  }

  async function loadTimeline() {
    if (!deps.currentProjectName.value || !deps.currentTimelinePath.value) return;

    const requestId = ++loadTimelineRequestId;
    clearAutosaveTimer();
    autoSave.reset();
    let restoredAutosave = false;

    const fallback = deps.createFallbackTimelineDoc();

    try {
      const handle = await deps.ensureTimelineFileHandle({ create: false });
      const autosavePath = getAutosavePath(deps.currentTimelinePath.value);
      const autosaveHandle = await deps.ensureTimelineFileHandle({
        create: false,
        relativePath: autosavePath,
      });
      if (!handle && !autosaveHandle) {
        if (requestId !== loadTimelineRequestId) return;
        deps.timelineDoc.value = fallback;
        return;
      }

      const mainFile = handle ? await handle.getFile() : null;
      const autosaveFile = autosaveHandle ? await autosaveHandle.getFile() : null;
      let text = mainFile ? await mainFile.text() : '';
      const shouldOfferAutosave =
        !!autosaveFile && (!mainFile || autosaveFile.lastModified > mainFile.lastModified);

      if (shouldOfferAutosave) {
        const shouldRestore =
          deps.shouldRestoreAutosaveSilently?.() ??
          (await deps.confirmRestoreAutosave?.({
            timelinePath: deps.currentTimelinePath.value,
            autosavePath,
          })) ??
          false;

        if (shouldRestore) {
          text = await autosaveFile.text();
          restoredAutosave = true;
        }
      }

      if (!text) {
        if (requestId !== loadTimelineRequestId) return;
        deps.timelineDoc.value = fallback;
        return;
      }

      const parsed = deps.parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        format: fallback.metadata?.fastcat?.format ?? { fps: fallback.timebase.fps },
      });
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = parsed;

      const path = deps.currentTimelinePath.value;
      const settings = path ? deps.getProjectSettings() : null;
      const session = (settings?.timelines?.sessions?.[path] ?? null) as Record<
        string,
        unknown
      > | null;

      deps.currentTime.value = Number(session?.playheadUs ?? 0);
      deps.masterGain.value = Number(session?.masterGain ?? 1);
      if (deps.audioMuted) deps.audioMuted.value = Boolean(session?.masterMuted ?? false);
      deps.timelineZoom.value = Number(session?.zoom ?? 50);
      deps.trackHeights.value = session?.trackHeights
        ? { ...(session.trackHeights as Record<string, number>) }
        : {};
      if (deps.selectionRange) {
        deps.selectionRange.value = session?.selectionRange
          ? ({ ...(session.selectionRange as Record<string, unknown>) } as {
              startUs: number;
              endUs: number;
            })
          : null;
      }
    } catch (e: unknown) {
      console.warn('Failed to load timeline file, fallback to default', e);
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = fallback;
    } finally {
      if (requestId === loadTimelineRequestId) {
        deps.duration.value = deps.timelineDoc.value
          ? deps.selectTimelineDurationUs(deps.timelineDoc.value)
          : 0;
        currentRevision = restoredAutosave ? 1 : 0;
        mainSavedRevision = 0;
        autoSave.reset();
        setDirtyState();
        deps.timelineSaveError.value = null;
      }
    }
  }

  async function saveTimeline() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    if (deps.isReadOnly?.value) return;

    const currentProjectId = deps.currentProjectName.value;
    const currentTimelinePath = deps.currentTimelinePath.value;
    if (!currentProjectId || !currentTimelinePath) return;

    const revisionToSave = currentRevision;
    deps.isSavingTimeline.value = true;
    deps.timelineSaveError.value = null;

    try {
      if (
        currentProjectId !== deps.currentProjectName.value ||
        currentTimelinePath !== deps.currentTimelinePath.value
      ) {
        return;
      }

      const handle = await deps.ensureTimelineFileHandle({ create: true });
      if (!handle) return;

      const serialized = await serializeValidatedTimeline(doc);
      await writeSerializedToHandle(handle, serialized);

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
          try {
            await deps.deleteAutosaveFile?.(currentTimelinePath);
          } catch (e) {
            console.warn('Failed to remove autosave sidecar after save', e);
          }
        } else {
          scheduleAutosave();
        }
      }

      deps.onSaveSuccess?.(serialized);
    } catch (e: unknown) {
      deps.timelineSaveError.value =
        e instanceof Error ? e.message : 'Failed to save timeline file';
      console.warn('Failed to save timeline file', e);
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
