import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';

interface PersistedFileTreeState {
  expandedPaths: string[];
}

function getFileTreeStorageKey(projectName: string): string {
  return `gran-video-editor:file-tree:${projectName}`;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export interface FsEntrySelection {
  kind: 'file' | 'directory';
  name: string;
  path?: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
}

export const useUiStore = defineStore('ui', () => {
  const selectedFsEntry = ref<FsEntrySelection | null>(null);
  const showHiddenFiles = ref(readLocalStorageJson('gran-video-editor:show-hidden-files', false));

  watch(showHiddenFiles, (val) => writeLocalStorageJson('gran-video-editor:show-hidden-files', val));

  const isGlobalDragging = ref(false);
  const isFileManagerDragging = ref(false);

  const fileTreeExpandedPaths = ref<Record<string, true>>({});
  const currentFileTreeProjectName = ref<string | null>(null);

  const pendingFsEntryDelete = ref<any>(null);

  const isSavingFileTree = ref(false);
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

  function restoreFileTreeStateOnce(projectName: string) {
    if (typeof window === 'undefined') return;
    if (currentFileTreeProjectName.value === projectName) return;

    currentFileTreeProjectName.value = projectName;

    const parsed = readLocalStorageJson<PersistedFileTreeState>(
      getFileTreeStorageKey(projectName),
      {
        expandedPaths: [],
      },
    );

    const next: Record<string, true> = {};
    for (const p of parsed.expandedPaths) {
      if (typeof p === 'string' && p.trim().length > 0) next[p] = true;
    }

    fileTreeExpandedPaths.value = next;
    fileTreeRevision = 0;
    markFileTreeAsCleanForCurrentRevision();
  }

  async function persistFileTreeNow(projectName: string) {
    if (savedFileTreeRevision >= fileTreeRevision) return;

    isSavingFileTree.value = true;
    const revisionToSave = fileTreeRevision;

    try {
      const expandedPaths = Object.keys(fileTreeExpandedPaths.value);
      writeLocalStorageJson(getFileTreeStorageKey(projectName), { expandedPaths });

      if (savedFileTreeRevision < revisionToSave) {
        savedFileTreeRevision = revisionToSave;
      }
    } catch (e) {
      console.warn('Failed to persist file tree state', e);
    } finally {
      isSavingFileTree.value = false;
    }
  }

  async function enqueueFileTreeSave(projectName: string) {
    await fileTreeSaveQueue.add(async () => {
      await persistFileTreeNow(projectName);
    });
  }

  async function requestFileTreeSave(projectName: string, options?: { immediate?: boolean }) {
    if (options?.immediate) {
      clearPersistFileTreeTimeout();
      await enqueueFileTreeSave(projectName);
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueFileTreeSave(projectName);
      return;
    }

    clearPersistFileTreeTimeout();
    persistFileTreeTimeout = window.setTimeout(() => {
      persistFileTreeTimeout = null;
      void enqueueFileTreeSave(projectName);
    }, 500);
  }

  function isFileTreePathExpanded(path: string): boolean {
    return Boolean(fileTreeExpandedPaths.value[path]);
  }

  function setFileTreePathExpanded(projectName: string, path: string, expanded: boolean) {
    if (!path) return;

    if (expanded) {
      if (fileTreeExpandedPaths.value[path]) return;
      fileTreeExpandedPaths.value = { ...fileTreeExpandedPaths.value, [path]: true };
      markFileTreeAsDirty();
      void requestFileTreeSave(projectName);
      return;
    }

    if (!fileTreeExpandedPaths.value[path]) return;
    const next = { ...fileTreeExpandedPaths.value };
    delete next[path];
    fileTreeExpandedPaths.value = next;
    markFileTreeAsDirty();
    void requestFileTreeSave(projectName);
  }

  watch(
    selectedFsEntry,
    () => {
      // keep
    },
    { deep: true },
  );

  return {
    selectedFsEntry,
    isGlobalDragging,
    isFileManagerDragging,
    fileTreeExpandedPaths,
    pendingFsEntryDelete,
    showHiddenFiles,
    restoreFileTreeStateOnce,
    isFileTreePathExpanded,
    setFileTreePathExpanded,
  };
});
