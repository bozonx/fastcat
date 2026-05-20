import { toRaw, type Ref } from 'vue';
import { createAutoSave } from '~/utils/auto-save';

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
  }) => Promise<FileSystemFileHandle | null>;
  createFallbackTimelineDoc: () => TimelineDocument;

  getProjectSettings: () => { timelines?: { sessions?: Record<string, any> } } | null;

  parseTimelineFromOtio: (
    text: string,
    options: { id: string; name: string; format: TimelineFormatInput },
  ) => TimelineDocument;
  serializeTimelineToOtio: (doc: TimelineDocument) => string;
  selectTimelineDurationUs: (doc: TimelineDocument) => number;

  onSaveSuccess?: (serialized: string) => void;
  onSaveError?: (error: unknown) => void;
}

export interface TimelinePersistenceModule {
  resetPersistenceState: () => void;
  getLoadRequestId: () => number;

  markDirty: () => void;
  markCleanForCurrentRevision: () => void;

  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
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

function findNonCloneablePath(value: unknown, seen = new WeakSet<object>(), path = '$'): string | null {
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

  const autoSave = createAutoSave({
    debounceMs: 2000,
    onStateChange: (state) => {
      deps.isTimelineDirty.value = state.isDirty;
    },
    doSave: async () => {
      const doc = deps.timelineDoc.value;
      if (!doc || !deps.isTimelineDirty.value) return false;
      if (deps.isReadOnly?.value) return false;

      const currentProjectId = deps.currentProjectName.value;
      const currentTimelinePath = deps.currentTimelinePath.value;

      if (!currentProjectId || !currentTimelinePath) return false;

      deps.isSavingTimeline.value = true;
      deps.timelineSaveError.value = null;

      // No intermediate clone here — serializeInWorker postMessages a
      // structuredClone already, and the serializer doesn't mutate the doc.
      const snapshot = toRaw(doc);

      try {
        // Double check if context changed before writing
        if (
          currentProjectId !== deps.currentProjectName.value ||
          currentTimelinePath !== deps.currentTimelinePath.value
        ) {
          return false; // Skip save, context changed
        }

        const handle = await deps.ensureTimelineFileHandle({ create: true });
        if (!handle) return false;

        const serialized = await serializeInWorker(snapshot);

        // Validation: prevent writing empty or corrupted data
        if (!serialized || serialized.length < 10) {
          throw new Error(
            'Refusing to save: Serialized timeline data is suspiciously small or empty',
          );
        }

        try {
          JSON.parse(serialized);
        } catch (e) {
          console.error('Invalid timeline serialization', e, serialized.substring(0, 100));
          throw new Error('Refusing to save: Invalid timeline JSON structure');
        }

        const writable = await (
          handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }
        ).createWritable();
        await writable.write(serialized);
        await writable.close();

        deps.onSaveSuccess?.(serialized);
        return true;
      } catch (e: unknown) {
        deps.timelineSaveError.value =
          e instanceof Error ? e.message : 'Failed to save timeline file';
        console.warn('Failed to save timeline file', e);
        // Throw to let autoSave know it failed, but we also handle toast in the global error handler
        throw e;
      } finally {
        // Only reset flags if we're still on the same timeline context
        if (
          currentProjectId === deps.currentProjectName.value &&
          currentTimelinePath === deps.currentTimelinePath.value
        ) {
          deps.isSavingTimeline.value = false;
        }
      }
    },
    onError: (e) => {
      console.error('Failed to save timeline', e);
      deps.onSaveError?.(e);
    },
  });

  function resetPersistenceState() {
    autoSave.reset();
    loadTimelineRequestId += 1;
  }

  function getLoadRequestId() {
    return loadTimelineRequestId;
  }

  function markCleanForCurrentRevision() {
    autoSave.markCleanForCurrentRevision();
  }

  function markDirty() {
    autoSave.markDirty();
    void autoSave.requestSave();
  }

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    if (!deps.timelineDoc.value) return;
    await autoSave.requestSave(options);
  }

  async function loadTimeline() {
    if (!deps.currentProjectName.value || !deps.currentTimelinePath.value) return;

    const requestId = ++loadTimelineRequestId;
    autoSave.reset();

    const fallback = deps.createFallbackTimelineDoc();

    try {
      const handle = await deps.ensureTimelineFileHandle({ create: false });
      if (!handle) {
        if (requestId !== loadTimelineRequestId) return;
        deps.timelineDoc.value = fallback;
        return;
      }

      const file = await handle.getFile();
      const text = await file.text();
      const parsed = deps.parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        format: fallback.metadata?.fastcat?.format ?? { fps: fallback.timebase.fps },
      });
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = parsed;

      const path = deps.currentTimelinePath.value;
      const settings = path ? deps.getProjectSettings() : null;
      const session = settings?.timelines?.sessions?.[path] ?? null;

      deps.currentTime.value = session?.playheadUs ?? 0;
      deps.masterGain.value = session?.masterGain ?? 1;
      if (deps.audioMuted) deps.audioMuted.value = session?.masterMuted ?? false;
      deps.timelineZoom.value = session?.zoom ?? 50;
      deps.trackHeights.value = session?.trackHeights ? { ...session.trackHeights } : {};
      if (deps.selectionRange) {
        deps.selectionRange.value = session?.selectionRange ? { ...session.selectionRange } : null;
      }
    } catch (e: unknown) {
      console.warn('Failed to load timeline file, fallback to default', e);
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = fallback;
    } finally {
      if (requestId !== loadTimelineRequestId) return;
      deps.duration.value = deps.timelineDoc.value
        ? deps.selectTimelineDurationUs(deps.timelineDoc.value)
        : 0;
      markCleanForCurrentRevision();
      deps.timelineSaveError.value = null;
    }
  }

  async function saveTimeline() {
    await requestTimelineSave({ immediate: true });
  }

  return {
    resetPersistenceState,
    getLoadRequestId,
    markDirty,
    markCleanForCurrentRevision,
    requestTimelineSave,
    loadTimeline,
    saveTimeline,
  };
}
