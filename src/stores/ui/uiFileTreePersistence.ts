import { ref, type Ref } from 'vue';
import { createAutoSave } from '~/utils/auto-save';

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

  const autoSave = createAutoSave({
    debounceMs: 500,
    doSave: async () => {
      if (!currentFileTreeProjectId.value) return false;
      const projectId = currentFileTreeProjectId.value;
      const expandedPaths = Object.keys(deps.fileTreeExpandedPaths.value);
      writeLocalStorageJson(getFileTreeStorageKey(projectId), { expandedPaths });
    },
  });

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
    autoSave.reset();
    autoSave.markCleanForCurrentRevision();
  }

  function hasPersistedFileTreeState(projectId: string): boolean {
    return hasLocalStorageKey(getFileTreeStorageKey(projectId));
  }

  function isFileTreePathExpanded(path: string): boolean {
    return Boolean(deps.fileTreeExpandedPaths.value[path]);
  }

  function setFileTreePathExpanded(projectId: string, path: string, expanded: boolean) {
    if (!path) return;

    if (expanded) {
      if (deps.fileTreeExpandedPaths.value[path]) return;
      deps.fileTreeExpandedPaths.value = { ...deps.fileTreeExpandedPaths.value, [path]: true };
      autoSave.markDirty();
      void autoSave.requestSave();
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
    autoSave.markDirty();
    void autoSave.requestSave();
  }

  return {
    fileTreeExpandedPaths: deps.fileTreeExpandedPaths,
    restoreFileTreeStateOnce,
    hasPersistedFileTreeState,
    isFileTreePathExpanded,
    setFileTreePathExpanded,
  } satisfies UiFileTreePersistenceModule;
}
