import PQueue from 'p-queue';
import { ref, type Ref } from 'vue';

import {
  hasLocalStorageKey,
  readLocalStorageJson,
  writeLocalStorageJson,
} from '~/stores/ui/uiLocalStorage';

interface PersistedFileTreeState {
  expandedPaths: string[];
}

function getFileTreeStorageKey(projectId: string): string {
  return `fastcat:ui:file-tree:${projectId}`;
}

export interface UiFileTreePersistenceModule {
  fileTreeExpandedPaths: Ref<Record<string, true>>;
  restoreFileTreeStateOnce: (projectId: string) => void;
  hasPersistedFileTreeState: (projectId: string) => boolean;
  isFileTreePathExpanded: (path: string) => boolean;
  setFileTreePathExpanded: (projectId: string, path: string, expanded: boolean) => void;
}

export function createUiFileTreePersistenceModule(deps: {
  fileTreeExpandedPaths: Ref<Record<string, true>>;
}) {
  const currentFileTreeProjectId = ref<string | null>(null);
  let persistFileTreeTimeout: number | null = null;
  let fileTreeRevision = 0;
  let savedFileTreeRevision = 0;

  const fileTreeSaveQueue = new PQueue({ concurrency: 1 });

  function clearPersistFileTreeTimeout() {
    if (typeof window === 'undefined') return;
    if (persistFileTreeTimeout === null) return;
    window.clearTimeout(persistFileTreeTimeout);
    persistFileTreeTimeout = null;
  }

  function markFileTreeAsDirty() {
    fileTreeRevision += 1;
  }

  function markFileTreeAsCleanForCurrentRevision() {
    savedFileTreeRevision = fileTreeRevision;
  }

  function restoreFileTreeStateOnce(projectId: string) {
    if (typeof window === 'undefined') return;
    if (currentFileTreeProjectId.value === projectId) return;

    currentFileTreeProjectId.value = projectId;

    const parsed = readLocalStorageJson<PersistedFileTreeState>(getFileTreeStorageKey(projectId), {
      expandedPaths: [],
    });

    const next: Record<string, true> = {};
    for (const p of parsed.expandedPaths) {
      if (typeof p === 'string' && p.trim().length > 0) next[p] = true;
    }

    deps.fileTreeExpandedPaths.value = next;
    fileTreeRevision = 0;
    markFileTreeAsCleanForCurrentRevision();
  }

  function hasPersistedFileTreeState(projectId: string): boolean {
    return hasLocalStorageKey(getFileTreeStorageKey(projectId));
  }

  async function persistFileTreeNow(projectId: string) {
    if (savedFileTreeRevision >= fileTreeRevision) return;

    const revisionToSave = fileTreeRevision;

    try {
      const expandedPaths = Object.keys(deps.fileTreeExpandedPaths.value);
      writeLocalStorageJson(getFileTreeStorageKey(projectId), { expandedPaths });

      if (savedFileTreeRevision < revisionToSave) {
        savedFileTreeRevision = revisionToSave;
      }
    } catch (e) {
      console.warn('Failed to persist file tree state', e);
    } finally {
    }
  }

  async function enqueueFileTreeSave(projectId: string) {
    await fileTreeSaveQueue.add(async () => {
      await persistFileTreeNow(projectId);
    });
  }

  async function requestFileTreeSave(projectId: string, options?: { immediate?: boolean }) {
    if (options?.immediate || typeof window === 'undefined') {
      clearPersistFileTreeTimeout();
      await enqueueFileTreeSave(projectId);
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueFileTreeSave(projectId);
      return;
    }

    clearPersistFileTreeTimeout();
    persistFileTreeTimeout = window.setTimeout(() => {
      persistFileTreeTimeout = null;
      void enqueueFileTreeSave(projectId);
    }, 500);
  }

  function isFileTreePathExpanded(path: string): boolean {
    return Boolean(deps.fileTreeExpandedPaths.value[path]);
  }

  function setFileTreePathExpanded(projectId: string, path: string, expanded: boolean) {
    if (!path) return;

    if (expanded) {
      if (deps.fileTreeExpandedPaths.value[path]) return;
      deps.fileTreeExpandedPaths.value = { ...deps.fileTreeExpandedPaths.value, [path]: true };
      markFileTreeAsDirty();
      void requestFileTreeSave(projectId);
      return;
    }

    if (!deps.fileTreeExpandedPaths.value[path]) return;
    const next = { ...deps.fileTreeExpandedPaths.value };

    const prefix = `${path}/`;
    for (const key of Object.keys(next)) {
      if (key === path || key.startsWith(prefix)) {
        delete next[key];
      }
    }

    deps.fileTreeExpandedPaths.value = next;
    markFileTreeAsDirty();
    void requestFileTreeSave(projectId);
  }

  return {
    fileTreeExpandedPaths: deps.fileTreeExpandedPaths,
    restoreFileTreeStateOnce,
    hasPersistedFileTreeState,
    isFileTreePathExpanded,
    setFileTreePathExpanded,
  } satisfies UiFileTreePersistenceModule;
}
