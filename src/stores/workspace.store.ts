import { defineStore, skipHydrate } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';

export interface GranVideoEditorUserSettings {
  openBehavior: 'open_last_project' | 'show_project_picker';
}

export interface GranVideoEditorWorkspaceSettings {
  proxyStorageLimitBytes: number;
  defaults: {
    newProject: {
      width: number;
      height: number;
      fps: number;
    };
  };
}

const DEFAULT_USER_SETTINGS: GranVideoEditorUserSettings = {
  openBehavior: 'open_last_project',
};

const DEFAULT_WORKSPACE_SETTINGS: GranVideoEditorWorkspaceSettings = {
  proxyStorageLimitBytes: 10 * 1024 * 1024 * 1024,
  defaults: {
    newProject: {
      width: 1920,
      height: 1080,
      fps: 25,
    },
  },
};

function createDefaultUserSettings(): GranVideoEditorUserSettings {
  return {
    openBehavior: DEFAULT_USER_SETTINGS.openBehavior,
  };
}

function normalizeUserSettings(raw: unknown): GranVideoEditorUserSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultUserSettings();
  }

  const input = raw as Record<string, unknown>;
  const openBehavior = input.openBehavior;

  return {
    openBehavior:
      openBehavior === 'show_project_picker'
        ? 'show_project_picker'
        : DEFAULT_USER_SETTINGS.openBehavior,
  };
}

function createDefaultWorkspaceSettings(): GranVideoEditorWorkspaceSettings {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    defaults: { newProject: { ...DEFAULT_WORKSPACE_SETTINGS.defaults.newProject } },
  };
}

function normalizeWorkspaceSettings(raw: unknown): GranVideoEditorWorkspaceSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultWorkspaceSettings();
  }

  const input = raw as Record<string, any>;
  const defaultsInput = input.defaults ?? {};
  const newProjectInput = defaultsInput.newProject ?? {};

  const proxyStorageLimitBytes = Number(input.proxyStorageLimitBytes);
  const width = Number(newProjectInput.width);
  const height = Number(newProjectInput.height);
  const fps = Number(newProjectInput.fps);

  return {
    proxyStorageLimitBytes:
      Number.isFinite(proxyStorageLimitBytes) && proxyStorageLimitBytes > 0
        ? Math.round(proxyStorageLimitBytes)
        : DEFAULT_WORKSPACE_SETTINGS.proxyStorageLimitBytes,
    defaults: {
      newProject: {
        width:
          Number.isFinite(width) && width > 0
            ? Math.round(width)
            : DEFAULT_WORKSPACE_SETTINGS.defaults.newProject.width,
        height:
          Number.isFinite(height) && height > 0
            ? Math.round(height)
            : DEFAULT_WORKSPACE_SETTINGS.defaults.newProject.height,
        fps:
          Number.isFinite(fps) && fps > 0
            ? Math.round(Math.min(240, Math.max(1, fps)))
            : DEFAULT_WORKSPACE_SETTINGS.defaults.newProject.fps,
      },
    },
  };
}

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
  let persistUserSettingsTimeout: number | null = null;
  let userSettingsRevision = 0;
  let savedUserSettingsRevision = 0;
  const userSettingsSaveQueue = new PQueue({ concurrency: 1 });

  const isSavingWorkspaceSettings = ref(false);
  let persistWorkspaceSettingsTimeout: number | null = null;
  let workspaceSettingsRevision = 0;
  let savedWorkspaceSettingsRevision = 0;
  const workspaceSettingsSaveQueue = new PQueue({ concurrency: 1 });

  function clearPersistUserSettingsTimeout() {
    if (typeof window === 'undefined') return;
    if (persistUserSettingsTimeout === null) return;
    window.clearTimeout(persistUserSettingsTimeout);
    persistUserSettingsTimeout = null;
  }

  function clearPersistWorkspaceSettingsTimeout() {
    if (typeof window === 'undefined') return;
    if (persistWorkspaceSettingsTimeout === null) return;
    window.clearTimeout(persistWorkspaceSettingsTimeout);
    persistWorkspaceSettingsTimeout = null;
  }

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
    if (options?.immediate) {
      clearPersistUserSettingsTimeout();
      await enqueueUserSettingsSave();
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueUserSettingsSave();
      return;
    }

    clearPersistUserSettingsTimeout();
    persistUserSettingsTimeout = window.setTimeout(() => {
      persistUserSettingsTimeout = null;
      void enqueueUserSettingsSave();
    }, 500);
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
    if (options?.immediate) {
      clearPersistWorkspaceSettingsTimeout();
      await enqueueWorkspaceSettingsSave();
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueWorkspaceSettingsSave();
      return;
    }

    clearPersistWorkspaceSettingsTimeout();
    persistWorkspaceSettingsTimeout = window.setTimeout(() => {
      persistWorkspaceSettingsTimeout = null;
      void enqueueWorkspaceSettingsSave();
    }, 500);
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
      return await granDir.getFileHandle('editor.settings.json', {
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

  async function saveWorkspaceSettingsToDisk() {
    await requestWorkspaceSettingsSave({ immediate: true });
  }

  async function saveUserSettingsToDisk() {
    await requestUserSettingsSave({ immediate: true });
  }

  async function saveHandleToIndexedDB(handle: FileSystemDirectoryHandle) {
    const request = indexedDB.open('GranVideoEditor', 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles');
      }
    };

    return new Promise<void>((resolve, reject) => {
      request.onsuccess = (e: any) => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        store.put(handle, 'workspace');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function getHandleFromIndexedDB(): Promise<FileSystemDirectoryHandle | null> {
    const request = indexedDB.open('GranVideoEditor', 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles');
      }
    };

    return new Promise((resolve) => {
      request.onsuccess = (e: any) => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const getReq = store.get('workspace');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  }

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    workspaceHandle.value = handle;

    const folders = ['proxies', 'thumbs', 'cache', 'projects'];
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
      await saveHandleToIndexedDB(handle);
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

    const request = indexedDB.open('GranVideoEditor', 1);
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete('workspace');
    };
  }

  async function init() {
    if (!isApiSupported) {
      isInitializing.value = false;
      return;
    }

    try {
      const handle = await getHandleFromIndexedDB();
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
