import { defineStore, skipHydrate } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';
import { useDebounceFn } from '@vueuse/core';
import { PROXY_DIR_NAME } from '~/utils/constants';
import {
  type GranVideoEditorUserSettings,
  type GranVideoEditorWorkspaceSettings,
  createDefaultUserSettings,
  createDefaultWorkspaceSettings,
  normalizeUserSettings,
  normalizeWorkspaceSettings,
} from '~/utils/settings';
import {
  saveWorkspaceHandleToIndexedDB,
  getWorkspaceHandleFromIndexedDB,
  clearWorkspaceHandleFromIndexedDB,
} from '~/utils/indexedDB';

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
  const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);

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
    if (!workspaceHandle.value) return;
    if (savedUserSettingsRevision >= userSettingsRevision) return;

    isSavingUserSettings.value = true;
    const revisionToSave = userSettingsRevision;

    try {
      const handle = await ensureUserSettingsFile({ create: true });
      if (!handle) return;

      const writable = await (handle as any).createWritable();
      await writable.write(`${JSON.stringify(userSettings.value, null, 2)}\n`);
      await writable.close();

      if (savedUserSettingsRevision < revisionToSave) {
        savedUserSettingsRevision = revisionToSave;
      }
    } catch (e) {
      console.warn('Failed to save user settings', e);
    } finally {
      isSavingUserSettings.value = false;
    }
  }

  async function ensureUserSettingsFile(options?: {
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!workspaceHandle.value) return null;
    try {
      const granDir = await workspaceHandle.value.getDirectoryHandle('.gran', {
        create: options?.create ?? false,
      });
      return await granDir.getFileHandle('user.settings.json', {
        create: options?.create ?? false,
      });
    } catch {
      return null;
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
    if (!workspaceHandle.value) return;
    if (savedWorkspaceSettingsRevision >= workspaceSettingsRevision) return;

    isSavingWorkspaceSettings.value = true;
    const revisionToSave = workspaceSettingsRevision;

    try {
      const handle = await ensureWorkspaceSettingsFile({ create: true });
      if (!handle) return;
      const writable = await (handle as any).createWritable();
      await writable.write(`${JSON.stringify(workspaceSettings.value, null, 2)}\n`);
      await writable.close();

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
      const iterator =
        (projectsHandle.value as any).values?.() ?? (projectsHandle.value as any).entries?.();
      if (!iterator) return;

      for await (const value of iterator) {
        const handle = Array.isArray(value) ? value[1] : value;
        if (handle.kind === 'directory') {
          projects.value.push(handle.name);
        }
      }

      projects.value.sort((a, b) => a.localeCompare(b));
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to load projects';
    }
  }

  async function ensureWorkspaceSettingsFile(options?: {
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!workspaceHandle.value) return null;
    try {
      const granDir = await workspaceHandle.value.getDirectoryHandle('.gran', {
        create: options?.create ?? false,
      });
      return await granDir.getFileHandle('workspace.settings.json', {
        create: options?.create ?? false,
      });
    } catch (e) {
      return null;
    }
  }

  async function loadWorkspaceSettingsFromDisk() {
    if (!workspaceHandle.value) return;

    try {
      const handle = await ensureWorkspaceSettingsFile({ create: false });
      if (!handle) {
        workspaceSettings.value = normalizeWorkspaceSettings(null);
        return;
      }

      const file = await handle.getFile();
      const text = await file.text();
      workspaceSettings.value = normalizeWorkspaceSettings(text.trim() ? JSON.parse(text) : null);
    } catch {
      workspaceSettings.value = normalizeWorkspaceSettings(null);
    } finally {
      workspaceSettingsRevision = 0;
      markWorkspaceSettingsAsCleanForCurrentRevision();
    }
  }

  async function loadUserSettingsFromDisk() {
    if (!workspaceHandle.value) return;

    try {
      const handle = await ensureUserSettingsFile({ create: false });
      if (!handle) {
        userSettings.value = normalizeUserSettings(null);
        return;
      }

      const file = await handle.getFile();
      const text = await file.text();
      userSettings.value = normalizeUserSettings(text.trim() ? JSON.parse(text) : null);
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

    const folders = [PROXY_DIR_NAME, 'thumbs', 'cache', 'projects'];
    for (const folder of folders) {
      if (folder === 'projects') {
        projectsHandle.value = await handle.getDirectoryHandle(folder, { create: true });
      } else {
        await handle.getDirectoryHandle(folder, { create: true });
      }
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
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await setupWorkspace(handle);
      await saveWorkspaceHandleToIndexedDB(handle);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        error.value = e?.message ?? 'Failed to open workspace folder';
      }
    } finally {
      isLoading.value = false;
    }
  }

  function resetWorkspace() {
    workspaceHandle.value = null;
    projectsHandle.value = null;
    projects.value = [];
    error.value = null;

    clearWorkspaceHandleFromIndexedDB().catch(console.warn);
  }

  async function init() {
    if (!isApiSupported) {
      isInitializing.value = false;
      return;
    }

    try {
      const handle = await getWorkspaceHandleFromIndexedDB();
      if (!handle) {
        isInitializing.value = false;
        return;
      }

      const options = { mode: 'readwrite' };
      if ((await (handle as any).queryPermission(options)) === 'granted') {
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
  };
});
