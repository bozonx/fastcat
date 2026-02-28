import { defineStore, skipHydrate } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';
import { useDebounceFn } from '@vueuse/core';
import {
  VARDATA_DIR_NAME,
  VARDATA_PROJECTS_DIR_NAME,
  getProjectVardataSegments,
} from '~/utils/vardata-paths';
import {
  type GranVideoEditorUserSettings,
  type GranVideoEditorWorkspaceSettings,
  createDefaultUserSettings,
  createDefaultWorkspaceSettings,
  normalizeUserSettings,
  normalizeWorkspaceSettings,
} from '~/utils/settings';
import {
  createWorkspaceSettingsRepository,
  type WorkspaceSettingsRepository,
} from '~/repositories/workspace-settings.repository';
import {
  createIndexedDbWorkspaceHandleStorage,
  type WorkspaceHandleStorage,
} from '~/repositories/workspace-handle.repository';

function getErrorMessage(e: unknown, fallback: string): string {
  if (!e || typeof e !== 'object') return fallback;
  if (!('message' in e)) return fallback;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  if (!('name' in e)) return false;
  return (e as { name?: unknown }).name === 'AbortError';
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
  const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);
  const settingsRepo = ref<WorkspaceSettingsRepository | null>(null);
  const workspaceHandleStorage = ref<WorkspaceHandleStorage<FileSystemDirectoryHandle> | null>(
    typeof window === 'undefined'
      ? null
      : window.indexedDB
        ? createIndexedDbWorkspaceHandleStorage({ indexedDB: window.indexedDB })
        : null,
  );

  const projects = ref<string[]>([]);
  const isLoading = ref(false);
  const isInitializing = ref(true);
  const error = ref<string | null>(null);

  const lastProjectName = ref<string | null>(
    typeof window === 'undefined' ? null : window.localStorage.getItem('gran-editor-last-project'),
  );

  const userSettings = ref<GranVideoEditorUserSettings>(createDefaultUserSettings());

  const workspaceSettings = ref<GranVideoEditorWorkspaceSettings>(createDefaultWorkspaceSettings());

  const isSavingUserSettings = ref(false);
  const debouncedEnqueueUserSettingsSave = useDebounceFn(async () => {
    await enqueueUserSettingsSave();
  }, 500);
  let userSettingsRevision = 0;
  let savedUserSettingsRevision = 0;
  const userSettingsSaveQueue = new PQueue({ concurrency: 1 });

  const isSavingWorkspaceSettings = ref(false);
  const debouncedEnqueueWorkspaceSettingsSave = useDebounceFn(async () => {
    await enqueueWorkspaceSettingsSave();
  }, 500);
  let workspaceSettingsRevision = 0;
  let savedWorkspaceSettingsRevision = 0;
  const workspaceSettingsSaveQueue = new PQueue({ concurrency: 1 });

  function markUserSettingsAsDirty() {
    userSettingsRevision += 1;
  }

  function markUserSettingsAsCleanForCurrentRevision() {
    savedUserSettingsRevision = userSettingsRevision;
  }

  function markWorkspaceSettingsAsDirty() {
    workspaceSettingsRevision += 1;
  }

  function markWorkspaceSettingsAsCleanForCurrentRevision() {
    savedWorkspaceSettingsRevision = workspaceSettingsRevision;
  }

  watch(lastProjectName, (v) => {
    if (typeof window === 'undefined') return;
    if (v === null) window.localStorage.removeItem('gran-editor-last-project');
    else window.localStorage.setItem('gran-editor-last-project', v);
  });

  async function persistUserSettingsNow() {
    if (!settingsRepo.value) return;
    if (savedUserSettingsRevision >= userSettingsRevision) return;

    isSavingUserSettings.value = true;
    const revisionToSave = userSettingsRevision;

    try {
      await settingsRepo.value.saveUserSettings(userSettings.value);

      if (savedUserSettingsRevision < revisionToSave) {
        savedUserSettingsRevision = revisionToSave;
      }
    } catch (e) {
      console.warn('Failed to save user settings', e);
    } finally {
      isSavingUserSettings.value = false;
    }
  }

  async function enqueueUserSettingsSave() {
    await userSettingsSaveQueue.add(async () => {
      await persistUserSettingsNow();
    });
  }

  async function requestUserSettingsSave(options?: { immediate?: boolean }) {
    if (options?.immediate || typeof window === 'undefined') {
      await enqueueUserSettingsSave();
      return;
    }
    await debouncedEnqueueUserSettingsSave();
  }

  watch(
    userSettings,
    () => {
      markUserSettingsAsDirty();
      void requestUserSettingsSave();
    },
    { deep: true },
  );

  async function persistWorkspaceSettingsNow() {
    if (!settingsRepo.value) return;
    if (savedWorkspaceSettingsRevision >= workspaceSettingsRevision) return;

    isSavingWorkspaceSettings.value = true;
    const revisionToSave = workspaceSettingsRevision;

    try {
      await settingsRepo.value.saveWorkspaceSettings(workspaceSettings.value);

      if (savedWorkspaceSettingsRevision < revisionToSave) {
        savedWorkspaceSettingsRevision = revisionToSave;
      }
    } catch (e) {
      console.warn('Failed to save workspace settings', e);
    } finally {
      isSavingWorkspaceSettings.value = false;
    }
  }

  async function enqueueWorkspaceSettingsSave() {
    await workspaceSettingsSaveQueue.add(async () => {
      await persistWorkspaceSettingsNow();
    });
  }

  async function requestWorkspaceSettingsSave(options?: { immediate?: boolean }) {
    if (options?.immediate || typeof window === 'undefined') {
      await enqueueWorkspaceSettingsSave();
      return;
    }
    await debouncedEnqueueWorkspaceSettingsSave();
  }

  watch(
    workspaceSettings,
    () => {
      markWorkspaceSettingsAsDirty();
      void requestWorkspaceSettingsSave();
    },
    { deep: true },
  );

  const isApiSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  async function loadProjects() {
    if (!projectsHandle.value) return;

    projects.value = [];
    try {
      const handleLike = projectsHandle.value as unknown as {
        values?: () => AsyncIterableIterator<FileSystemHandle>;
        entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
      };
      const iterator = handleLike.values?.() ?? handleLike.entries?.();
      if (!iterator) return;

      for await (const value of iterator) {
        const handle = Array.isArray(value) ? value[1] : value;
        if (handle.kind === 'directory') {
          projects.value.push(handle.name);
        }
      }

      projects.value.sort((a, b) => a.localeCompare(b));
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load projects');
    }
  }

  async function loadWorkspaceSettingsFromDisk() {
    if (!settingsRepo.value) return;

    try {
      const raw = await settingsRepo.value.loadWorkspaceSettings();
      workspaceSettings.value = normalizeWorkspaceSettings(raw);
    } catch {
      workspaceSettings.value = normalizeWorkspaceSettings(null);
    } finally {
      workspaceSettingsRevision = 0;
      markWorkspaceSettingsAsCleanForCurrentRevision();
    }
  }

  async function loadUserSettingsFromDisk() {
    if (!settingsRepo.value) return;

    try {
      const raw = await settingsRepo.value.loadUserSettings();
      userSettings.value = normalizeUserSettings(raw);
    } catch {
      userSettings.value = normalizeUserSettings(null);
    } finally {
      userSettingsRevision = 0;
      markUserSettingsAsCleanForCurrentRevision();
    }
  }

  async function saveWorkspaceSettingsToDisk() {
    await requestWorkspaceSettingsSave({ immediate: true });
  }

  async function saveUserSettingsToDisk() {
    await requestUserSettingsSave({ immediate: true });
  }

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    workspaceHandle.value = handle;
    settingsRepo.value = createWorkspaceSettingsRepository({ workspaceDir: handle });

    const folders = ['projects', VARDATA_DIR_NAME];
    for (const folder of folders) {
      if (folder === 'projects') {
        projectsHandle.value = await handle.getDirectoryHandle(folder, { create: true });
      } else {
        await handle.getDirectoryHandle(folder, { create: true });
      }
    }

    try {
      const vardataDir = await handle.getDirectoryHandle(VARDATA_DIR_NAME, { create: true });
      await vardataDir.getDirectoryHandle(VARDATA_PROJECTS_DIR_NAME, { create: true });
    } catch {
      // ignore
    }

    await loadProjects();
    await loadWorkspaceSettingsFromDisk();
    await loadUserSettingsFromDisk();
    await saveWorkspaceSettingsToDisk();
    await saveUserSettingsToDisk();
  }

  async function openWorkspace() {
    if (!isApiSupported) return;

    error.value = null;
    isLoading.value = true;
    try {
      const picker = (
        window as unknown as {
          showDirectoryPicker?: (options: {
            mode: 'readwrite' | 'readonly';
          }) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;
      if (!picker) return;
      const handle = await picker({ mode: 'readwrite' });
      await setupWorkspace(handle);
      await workspaceHandleStorage.value?.set(handle);
    } catch (e: unknown) {
      if (!isAbortError(e)) {
        error.value = getErrorMessage(e, 'Failed to open workspace folder');
      }
    } finally {
      isLoading.value = false;
    }
  }

  function resetWorkspace() {
    workspaceHandle.value = null;
    projectsHandle.value = null;
    settingsRepo.value = null;
    projects.value = [];
    error.value = null;

    workspaceHandleStorage.value?.clear().catch(console.warn);
  }

  async function init() {
    if (!isApiSupported) {
      isInitializing.value = false;
      return;
    }

    try {
      const handle = await workspaceHandleStorage.value?.get();
      if (!handle) {
        isInitializing.value = false;
        return;
      }

      const handleWithPerm = handle as unknown as {
        queryPermission?: (options: {
          mode: 'readwrite' | 'readonly';
        }) => Promise<'granted' | 'denied' | 'prompt'>;
      };
      const options = { mode: 'readwrite' as const };
      if ((await handleWithPerm.queryPermission?.(options)) === 'granted') {
        await setupWorkspace(handle);
      }
    } catch (e) {
      console.warn('Failed to restore workspace handle:', e);
    } finally {
      isInitializing.value = false;
    }
  }

  return {
    workspaceHandle,
    projectsHandle,
    projects,
    isLoading,
    error,
    isApiSupported,
    lastProjectName: skipHydrate(lastProjectName),
    userSettings: skipHydrate(userSettings),
    workspaceSettings: skipHydrate(workspaceSettings),
    init,
    openWorkspace,
    resetWorkspace,
    setupWorkspace,
    loadProjects,
    isInitializing,
    clearVardata: async () => {
      if (!workspaceHandle.value) return;
      try {
        await workspaceHandle.value.removeEntry(VARDATA_DIR_NAME, { recursive: true });
      } catch (e: unknown) {
        if ((e as { name?: unknown }).name !== 'NotFoundError') {
          console.warn('Failed to clear vardata', e);
        }
      }
      try {
        const vardataDir = await workspaceHandle.value.getDirectoryHandle(VARDATA_DIR_NAME, {
          create: true,
        });
        await vardataDir.getDirectoryHandle(VARDATA_PROJECTS_DIR_NAME, { create: true });
      } catch {
        // ignore
      }
    },
    clearProjectVardata: async (projectId: string) => {
      const parts = getProjectVardataSegments(projectId);
      try {
        const vardataDir = await workspaceHandle.value?.getDirectoryHandle(parts[0]!);
        const projectsDir = await vardataDir?.getDirectoryHandle(parts[1]!);
        await projectsDir?.removeEntry(parts[2]!, { recursive: true });
      } catch {
        // ignore
      }
    },
    deleteProject: async (name: string, projectId?: string) => {
      if (!projectsHandle.value) return;

      try {
        if (projectId) {
          const parts = getProjectVardataSegments(projectId);
          try {
            const vardataDir = await workspaceHandle.value?.getDirectoryHandle(parts[0]!);
            const projectsDir = await vardataDir?.getDirectoryHandle(parts[1]!);
            await projectsDir?.removeEntry(parts[2]!, { recursive: true });
          } catch {
            // ignore
          }
        }

        await projectsHandle.value.removeEntry(name, { recursive: true });
        await loadProjects();

        if (lastProjectName.value === name) {
          lastProjectName.value = null;
        }
      } catch (e: unknown) {
        if ((e as { name?: unknown }).name !== 'NotFoundError') {
          console.warn('Failed to delete project', name, e);
          throw e;
        }
      }
    },
  };
});
