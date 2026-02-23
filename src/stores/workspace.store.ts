import { defineStore, skipHydrate } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';
import { PROXY_DIR_NAME } from '~/utils/constants';

export interface GranVideoEditorUserSettings {
  openLastProjectOnStart: boolean;
  optimization: {
    proxyResolution: '360p' | '480p' | '720p' | '1080p';
    proxyVideoBitrateMbps: number;
    proxyAudioBitrateKbps: number;
    proxyCopyOpusAudio: boolean;
  };
  exportDefaults: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    encoding: {
      format: 'mp4' | 'webm' | 'mkv';
      videoCodec: string;
      bitrateMbps: number;
      excludeAudio: boolean;
      audioCodec: 'aac' | 'opus';
      audioBitrateKbps: number;
    };
  };
}

export interface GranVideoEditorWorkspaceSettings {
  proxyStorageLimitBytes: number;
  cacheStorageLimitBytes: number;
  thumbnailsStorageLimitBytes: number;
}

const DEFAULT_USER_SETTINGS: GranVideoEditorUserSettings = {
  openLastProjectOnStart: true,
  optimization: {
    proxyResolution: '720p',
    proxyVideoBitrateMbps: 2,
    proxyAudioBitrateKbps: 128,
    proxyCopyOpusAudio: true,
  },
  exportDefaults: {
    width: 1920,
    height: 1080,
    fps: 25,
    resolutionFormat: '1080p',
    orientation: 'landscape',
    aspectRatio: '16:9',
    isCustomResolution: false,
    encoding: {
      format: 'mp4',
      videoCodec: 'avc1.640032',
      bitrateMbps: 5,
      excludeAudio: false,
      audioCodec: 'aac',
      audioBitrateKbps: 128,
    },
  },
};

const DEFAULT_WORKSPACE_SETTINGS: GranVideoEditorWorkspaceSettings = {
  proxyStorageLimitBytes: 10 * 1024 * 1024 * 1024,
  cacheStorageLimitBytes: 2 * 1024 * 1024 * 1024,
  thumbnailsStorageLimitBytes: 1 * 1024 * 1024 * 1024,
};

function getResolutionPreset(width: number, height: number) {
  const isPortrait = height > width;
  const w = isPortrait ? height : width;
  const h = isPortrait ? width : height;

  let format = '';
  if (w === 1280 && h === 720) format = '720p';
  else if (w === 1920 && h === 1080) format = '1080p';
  else if (w === 2560 && h === 1440) format = '2.7k';
  else if (w === 3840 && h === 2160) format = '4k';

  let aspectRatio = '16:9';
  if (Math.abs(w / h - 16 / 9) < 0.01) aspectRatio = '16:9';
  else if (Math.abs(w / h - 4 / 3) < 0.01) aspectRatio = '4:3';
  else if (Math.abs(w / h - 1) < 0.01) aspectRatio = '1:1';
  else if (Math.abs(w / h - 21 / 9) < 0.01) aspectRatio = '21:9';

  return {
    isCustomResolution: !format,
    resolutionFormat: format || '1080p',
    orientation: isPortrait ? 'portrait' : 'landscape',
    aspectRatio,
  };
}

function createDefaultExportDefaults(): GranVideoEditorUserSettings['exportDefaults'] {
  const preset = getResolutionPreset(
    DEFAULT_USER_SETTINGS.exportDefaults.width,
    DEFAULT_USER_SETTINGS.exportDefaults.height,
  );

  return {
    width: DEFAULT_USER_SETTINGS.exportDefaults.width,
    height: DEFAULT_USER_SETTINGS.exportDefaults.height,
    fps: DEFAULT_USER_SETTINGS.exportDefaults.fps,
    resolutionFormat: preset.resolutionFormat,
    orientation: preset.orientation as 'landscape' | 'portrait',
    aspectRatio: preset.aspectRatio,
    isCustomResolution: preset.isCustomResolution,
    encoding: { ...DEFAULT_USER_SETTINGS.exportDefaults.encoding },
  };
}

function createDefaultUserSettings(): GranVideoEditorUserSettings {
  return {
    openLastProjectOnStart: DEFAULT_USER_SETTINGS.openLastProjectOnStart,
    optimization: { ...DEFAULT_USER_SETTINGS.optimization },
    exportDefaults: createDefaultExportDefaults(),
  };
}

function normalizeUserSettings(raw: unknown): GranVideoEditorUserSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultUserSettings();
  }

  const input = raw as Record<string, any>;
  const exportInput = input.exportDefaults ?? input.export ?? null;
  const encodingInput = exportInput?.encoding ?? {};

  const width = Number(exportInput?.width);
  const height = Number(exportInput?.height);
  const fps = Number(exportInput?.fps);
  const bitrateMbps = Number(encodingInput?.bitrateMbps);
  const audioBitrateKbps = Number(encodingInput?.audioBitrateKbps);
  const format = encodingInput?.format;

  const normalizedWidth =
    Number.isFinite(width) && width > 0
      ? Math.round(width)
      : DEFAULT_USER_SETTINGS.exportDefaults.width;
  const normalizedHeight =
    Number.isFinite(height) && height > 0
      ? Math.round(height)
      : DEFAULT_USER_SETTINGS.exportDefaults.height;

  const preset = getResolutionPreset(normalizedWidth, normalizedHeight);
  const isWidthHeightCustom =
    normalizedWidth !== DEFAULT_USER_SETTINGS.exportDefaults.width ||
    normalizedHeight !== DEFAULT_USER_SETTINGS.exportDefaults.height;

  const resolutionFormat =
    typeof exportInput?.resolutionFormat === 'string' &&
    exportInput.resolutionFormat &&
    !isWidthHeightCustom
      ? exportInput.resolutionFormat
      : preset.resolutionFormat;
  const orientation =
    (exportInput?.orientation === 'portrait' || exportInput?.orientation === 'landscape') &&
    !isWidthHeightCustom
      ? exportInput.orientation
      : (preset.orientation as 'landscape' | 'portrait');
  const aspectRatio =
    typeof exportInput?.aspectRatio === 'string' && exportInput.aspectRatio && !isWidthHeightCustom
      ? exportInput.aspectRatio
      : preset.aspectRatio;
  const isCustomResolution =
    exportInput?.isCustomResolution !== undefined && !isWidthHeightCustom
      ? Boolean(exportInput.isCustomResolution)
      : preset.isCustomResolution;

  const openLastProjectOnStartRaw = input.openLastProjectOnStart;
  const openBehavior = input.openBehavior;
  const openLastProjectOnStart =
    typeof openLastProjectOnStartRaw === 'boolean'
      ? openLastProjectOnStartRaw
      : openBehavior === 'show_project_picker'
        ? false
        : DEFAULT_USER_SETTINGS.openLastProjectOnStart;

  const optimizationInput = input.optimization ?? {};
  const proxyResolution = optimizationInput.proxyResolution;
  const proxyVideoBitrateMbps = Number(optimizationInput.proxyVideoBitrateMbps);
  const proxyAudioBitrateKbps = Number(optimizationInput.proxyAudioBitrateKbps);
  const proxyCopyOpusAudio = optimizationInput.proxyCopyOpusAudio;

  return {
    openLastProjectOnStart,
    optimization: {
      proxyResolution: ['360p', '480p', '720p', '1080p'].includes(proxyResolution)
        ? proxyResolution
        : DEFAULT_USER_SETTINGS.optimization.proxyResolution,
      proxyVideoBitrateMbps:
        Number.isFinite(proxyVideoBitrateMbps) && proxyVideoBitrateMbps > 0
          ? Math.min(50, Math.max(0.1, proxyVideoBitrateMbps))
          : DEFAULT_USER_SETTINGS.optimization.proxyVideoBitrateMbps,
      proxyAudioBitrateKbps:
        Number.isFinite(proxyAudioBitrateKbps) && proxyAudioBitrateKbps > 0
          ? Math.min(512, Math.max(32, proxyAudioBitrateKbps))
          : DEFAULT_USER_SETTINGS.optimization.proxyAudioBitrateKbps,
      proxyCopyOpusAudio:
        typeof proxyCopyOpusAudio === 'boolean'
          ? proxyCopyOpusAudio
          : DEFAULT_USER_SETTINGS.optimization.proxyCopyOpusAudio,
    },
    exportDefaults: {
      width: normalizedWidth,
      height: normalizedHeight,
      fps:
        Number.isFinite(fps) && fps > 0
          ? Math.round(Math.min(240, Math.max(1, fps)))
          : DEFAULT_USER_SETTINGS.exportDefaults.fps,
      resolutionFormat,
      orientation,
      aspectRatio,
      isCustomResolution,
      encoding: {
        format: format === 'webm' || format === 'mkv' ? format : 'mp4',
        videoCodec:
          typeof encodingInput?.videoCodec === 'string' &&
          encodingInput.videoCodec.trim().length > 0
            ? encodingInput.videoCodec
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.videoCodec,
        bitrateMbps:
          Number.isFinite(bitrateMbps) && bitrateMbps > 0
            ? Math.min(200, Math.max(0.2, bitrateMbps))
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.bitrateMbps,
        excludeAudio: Boolean(encodingInput?.excludeAudio),
        audioCodec: encodingInput?.audioCodec === 'opus' ? 'opus' : 'aac',
        audioBitrateKbps:
          Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
            ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.audioBitrateKbps,
      },
    },
  };
}

function createDefaultWorkspaceSettings(): GranVideoEditorWorkspaceSettings {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
  };
}

function normalizeWorkspaceSettings(raw: unknown): GranVideoEditorWorkspaceSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultWorkspaceSettings();
  }

  const input = raw as Record<string, any>;

  const proxyStorageLimitBytes = Number(input.proxyStorageLimitBytes);
  const cacheStorageLimitBytes = Number(input.cacheStorageLimitBytes);
  const thumbnailsStorageLimitBytes = Number(input.thumbnailsStorageLimitBytes);

  return {
    proxyStorageLimitBytes:
      Number.isFinite(proxyStorageLimitBytes) && proxyStorageLimitBytes > 0
        ? Math.round(proxyStorageLimitBytes)
        : DEFAULT_WORKSPACE_SETTINGS.proxyStorageLimitBytes,
    cacheStorageLimitBytes:
      Number.isFinite(cacheStorageLimitBytes) && cacheStorageLimitBytes > 0
        ? Math.round(cacheStorageLimitBytes)
        : DEFAULT_WORKSPACE_SETTINGS.cacheStorageLimitBytes,
    thumbnailsStorageLimitBytes:
      Number.isFinite(thumbnailsStorageLimitBytes) && thumbnailsStorageLimitBytes > 0
        ? Math.round(thumbnailsStorageLimitBytes)
        : DEFAULT_WORKSPACE_SETTINGS.thumbnailsStorageLimitBytes,
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
