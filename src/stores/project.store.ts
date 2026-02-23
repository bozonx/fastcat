import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';

import { createTimelineDocId } from '~/timeline/id';
import type { TimelineDocument } from '~/timeline/types';
import { createDefaultTimelineDocument } from '~/timeline/otioSerializer';

import { useWorkspaceStore } from './workspace.store';

export interface GranVideoEditorProjectSettings {
  export: {
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
  proxy: {
    height: number;
  };
  monitor: {
    previewResolution: number;
    useProxy: boolean;
  };
}

const DEFAULT_PROJECT_SETTINGS = {
  export: {
    encoding: {
      format: 'mp4' as const,
      videoCodec: 'avc1.640032',
      bitrateMbps: 5,
      excludeAudio: false,
      audioCodec: 'aac' as const,
      audioBitrateKbps: 128,
    },
  },
  proxy: {
    height: 720,
  },
  monitor: {
    previewResolution: 480,
    useProxy: true,
  },
};

function getDefaultExportFromUserDefaults(userDefaults: {
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
}): GranVideoEditorProjectSettings['export'] {
  return {
    width: userDefaults.width,
    height: userDefaults.height,
    fps: userDefaults.fps,
    resolutionFormat: userDefaults.resolutionFormat,
    orientation: userDefaults.orientation,
    aspectRatio: userDefaults.aspectRatio,
    isCustomResolution: userDefaults.isCustomResolution,
    encoding: {
      format: userDefaults.encoding.format,
      videoCodec: userDefaults.encoding.videoCodec,
      bitrateMbps: userDefaults.encoding.bitrateMbps,
      excludeAudio: userDefaults.encoding.excludeAudio,
      audioCodec: userDefaults.encoding.audioCodec,
      audioBitrateKbps: userDefaults.encoding.audioBitrateKbps,
    },
  };
}

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

function createDefaultProjectSettings(userExportDefaults: {
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
}): GranVideoEditorProjectSettings {
  return {
    export: getDefaultExportFromUserDefaults(userExportDefaults),
    proxy: {
      height: DEFAULT_PROJECT_SETTINGS.proxy.height,
    },
    monitor: {
      previewResolution: DEFAULT_PROJECT_SETTINGS.monitor.previewResolution,
      useProxy: DEFAULT_PROJECT_SETTINGS.monitor.useProxy,
    },
  };
}

function normalizeProjectSettings(
  raw: unknown,
  userExportDefaults: {
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
  },
): GranVideoEditorProjectSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultProjectSettings(userExportDefaults);
  }

  const input = raw as Record<string, any>;
  const exportInput = input.export ?? {};
  const encodingInput = exportInput.encoding ?? {};
  const proxyInput = input.proxy ?? {};
  const monitorInput = input.monitor ?? {};

  const defaultSettings = createDefaultProjectSettings(userExportDefaults);

  const width = Number(exportInput.width);
  const height = Number(exportInput.height);
  const bitrateMbps = Number(encodingInput.bitrateMbps);
  const audioBitrateKbps = Number(encodingInput.audioBitrateKbps);
  const proxyHeight = Number(proxyInput.height);
  const fps = Number(exportInput.fps);
  const format = encodingInput.format;
  const previewResolution = Number(monitorInput.previewResolution);
  const useProxy = monitorInput.useProxy;

  const finalWidth =
    Number.isFinite(width) && width > 0 ? Math.round(width) : defaultSettings.export.width;
  const finalHeight =
    Number.isFinite(height) && height > 0 ? Math.round(height) : defaultSettings.export.height;

  const isWidthHeightCustom =
    finalWidth !== defaultSettings.export.width || finalHeight !== defaultSettings.export.height;
  const preset = isWidthHeightCustom
    ? getResolutionPreset(finalWidth, finalHeight)
    : {
        resolutionFormat: defaultSettings.export.resolutionFormat,
        orientation: defaultSettings.export.orientation,
        aspectRatio: defaultSettings.export.aspectRatio,
        isCustomResolution: defaultSettings.export.isCustomResolution,
      };

  return {
    export: {
      width: finalWidth,
      height: finalHeight,
      fps:
        Number.isFinite(fps) && fps > 0
          ? Math.round(Math.min(240, Math.max(1, fps)))
          : defaultSettings.export.fps,
      resolutionFormat:
        typeof exportInput.resolutionFormat === 'string' &&
        exportInput.resolutionFormat &&
        !isWidthHeightCustom
          ? exportInput.resolutionFormat
          : preset.resolutionFormat,
      orientation:
        (exportInput.orientation === 'portrait' || exportInput.orientation === 'landscape') &&
        !isWidthHeightCustom
          ? exportInput.orientation
          : (preset.orientation as 'landscape' | 'portrait'),
      aspectRatio:
        typeof exportInput.aspectRatio === 'string' &&
        exportInput.aspectRatio &&
        !isWidthHeightCustom
          ? exportInput.aspectRatio
          : preset.aspectRatio,
      isCustomResolution:
        exportInput.isCustomResolution !== undefined && !isWidthHeightCustom
          ? Boolean(exportInput.isCustomResolution)
          : preset.isCustomResolution,
      encoding: {
        format: format === 'webm' || format === 'mkv' ? format : 'mp4',
        videoCodec:
          typeof encodingInput.videoCodec === 'string' && encodingInput.videoCodec.trim().length > 0
            ? encodingInput.videoCodec
            : DEFAULT_PROJECT_SETTINGS.export.encoding.videoCodec,
        bitrateMbps:
          Number.isFinite(bitrateMbps) && bitrateMbps > 0
            ? Math.min(200, Math.max(0.2, bitrateMbps))
            : DEFAULT_PROJECT_SETTINGS.export.encoding.bitrateMbps,
        excludeAudio: Boolean(encodingInput.excludeAudio),
        audioCodec: encodingInput.audioCodec === 'opus' ? 'opus' : 'aac',
        audioBitrateKbps:
          Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
            ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
            : DEFAULT_PROJECT_SETTINGS.export.encoding.audioBitrateKbps,
      },
    },
    proxy: {
      height:
        Number.isFinite(proxyHeight) && proxyHeight > 0
          ? Math.round(proxyHeight)
          : DEFAULT_PROJECT_SETTINGS.proxy.height,
    },
    monitor: {
      previewResolution:
        Number.isFinite(previewResolution) && previewResolution > 0
          ? Math.round(previewResolution)
          : DEFAULT_PROJECT_SETTINGS.monitor.previewResolution,
      useProxy:
        useProxy === undefined ? DEFAULT_PROJECT_SETTINGS.monitor.useProxy : Boolean(useProxy),
    },
  };
}

export const useProjectStore = defineStore('project', () => {
  const workspaceStore = useWorkspaceStore();

  const currentProjectName = ref<string | null>(null);
  const currentTimelinePath = ref<string | null>(null);
  const currentFileName = ref<string | null>(null);

  const projectSettings = ref<GranVideoEditorProjectSettings>(
    createDefaultProjectSettings(workspaceStore.userSettings.exportDefaults),
  );
  const isLoadingProjectSettings = ref(false);
  const isSavingProjectSettings = ref(false);

  let persistProjectSettingsTimeout: number | null = null;
  let projectSettingsRevision = 0;
  let savedProjectSettingsRevision = 0;

  const projectSettingsSaveQueue = new PQueue({ concurrency: 1 });

  function clearPersistProjectSettingsTimeout() {
    if (typeof window === 'undefined') return;
    if (persistProjectSettingsTimeout === null) return;
    window.clearTimeout(persistProjectSettingsTimeout);
    persistProjectSettingsTimeout = null;
  }

  function closeProject() {
    clearPersistProjectSettingsTimeout();
    currentProjectName.value = null;
    currentTimelinePath.value = null;
    currentFileName.value = null;
    isLoadingProjectSettings.value = false;
  }

  function markProjectSettingsAsDirty() {
    projectSettingsRevision += 1;
  }

  function markProjectSettingsAsCleanForCurrentRevision() {
    savedProjectSettingsRevision = projectSettingsRevision;
  }

  function toProjectRelativePath(path: string): string {
    return path
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('/');
  }

  async function getProjectFileHandleByRelativePath(input: {
    relativePath: string;
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!workspaceStore.projectsHandle || !currentProjectName.value) return null;
    const normalizedPath = toProjectRelativePath(input.relativePath);
    if (!normalizedPath) return null;

    const parts = normalizedPath.split('/');
    const fileName = parts.pop();
    if (!fileName) return null;

    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        currentProjectName.value,
      );
      let currentDir = projectDir;
      for (const dirName of parts) {
        currentDir = await currentDir.getDirectoryHandle(dirName, {
          create: input.create ?? false,
        });
      }

      return await currentDir.getFileHandle(fileName, {
        create: input.create ?? false,
      });
    } catch (e) {
      console.error('Failed to get project file handle by path:', input.relativePath, e);
      return null;
    }
  }

  async function getFileHandleByPath(path: string): Promise<FileSystemFileHandle | null> {
    return await getProjectFileHandleByRelativePath({ relativePath: path, create: false });
  }

  async function ensureProjectSettingsFile(options?: {
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!workspaceStore.projectsHandle || !currentProjectName.value) return null;

    const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
      currentProjectName.value,
    );
    const granDir = await projectDir.getDirectoryHandle('.gran', {
      create: options?.create ?? false,
    });

    return await granDir.getFileHandle('project.settings.json', {
      create: options?.create ?? false,
    });
  }

  function applyWorkspaceDefaultsToProjectSettings(input: GranVideoEditorProjectSettings) {
    // This function is now mostly redundant since defaults are injected during normalization,
    // but we'll keep it for compatibility if it's called elsewhere, or just return input.
    return input;
  }

  async function loadProjectSettings() {
    isLoadingProjectSettings.value = true;

    try {
      const settingsFileHandle = await ensureProjectSettingsFile({ create: false });
      if (!settingsFileHandle) {
        projectSettings.value = createDefaultProjectSettings(
          workspaceStore.userSettings.exportDefaults,
        );
        return;
      }

      const settingsFile = await settingsFileHandle.getFile();
      const text = await settingsFile.text();
      if (!text.trim()) {
        projectSettings.value = createDefaultProjectSettings(
          workspaceStore.userSettings.exportDefaults,
        );
        return;
      }

      const parsed = JSON.parse(text);
      projectSettings.value = normalizeProjectSettings(
        parsed,
        workspaceStore.userSettings.exportDefaults,
      );
    } catch (e: any) {
      if (e?.name === 'NotFoundError') {
        projectSettings.value = createDefaultProjectSettings(
          workspaceStore.userSettings.exportDefaults,
        );
        return;
      }

      console.warn('Failed to load project settings, fallback to defaults', e);
      projectSettings.value = createDefaultProjectSettings(
        workspaceStore.userSettings.exportDefaults,
      );
    } finally {
      isLoadingProjectSettings.value = false;
      projectSettingsRevision = 0;
      markProjectSettingsAsCleanForCurrentRevision();
    }
  }

  async function persistProjectSettingsNow() {
    if (
      !workspaceStore.projectsHandle ||
      !currentProjectName.value ||
      isLoadingProjectSettings.value
    ) {
      return;
    }

    if (savedProjectSettingsRevision >= projectSettingsRevision) return;

    isSavingProjectSettings.value = true;
    const revisionToSave = projectSettingsRevision;

    try {
      const settingsFileHandle = await ensureProjectSettingsFile({ create: true });
      if (!settingsFileHandle) return;
      const writable = await (settingsFileHandle as any).createWritable();
      await writable.write(`${JSON.stringify(projectSettings.value, null, 2)}\n`);
      await writable.close();

      if (savedProjectSettingsRevision < revisionToSave) {
        savedProjectSettingsRevision = revisionToSave;
      }
    } catch (e) {
      console.warn('Failed to save project settings', e);
    } finally {
      isSavingProjectSettings.value = false;
    }
  }

  async function enqueueProjectSettingsSave() {
    await projectSettingsSaveQueue.add(async () => {
      await persistProjectSettingsNow();
    });
  }

  async function requestProjectSettingsSave(options?: { immediate?: boolean }) {
    if (options?.immediate) {
      clearPersistProjectSettingsTimeout();
      await enqueueProjectSettingsSave();
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueProjectSettingsSave();
      return;
    }

    clearPersistProjectSettingsTimeout();
    persistProjectSettingsTimeout = window.setTimeout(() => {
      persistProjectSettingsTimeout = null;
      void enqueueProjectSettingsSave();
    }, 500);
  }

  async function saveProjectSettings() {
    await requestProjectSettingsSave({ immediate: true });
  }

  watch(
    projectSettings,
    () => {
      if (isLoadingProjectSettings.value) return;
      markProjectSettingsAsDirty();
      void requestProjectSettingsSave();
    },
    { deep: true },
  );

  async function createProject(name: string) {
    if (!workspaceStore.projectsHandle) {
      workspaceStore.error = 'Workspace not initialized';
      return;
    }

    if (workspaceStore.projects.includes(name)) {
      workspaceStore.error = 'Project already exists';
      return;
    }

    workspaceStore.error = null;
    workspaceStore.isLoading = true;

    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(name, {
        create: true,
      });
      const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true });
      await sourcesDir.getDirectoryHandle('video', { create: true });
      await sourcesDir.getDirectoryHandle('audio', { create: true });
      await sourcesDir.getDirectoryHandle('images', { create: true });
      await sourcesDir.getDirectoryHandle('timelines', { create: true });

      try {
        const granDir = await projectDir.getDirectoryHandle('.gran', { create: true });
        const settingsHandle = await granDir.getFileHandle('project.settings.json', {
          create: true,
        });

        const initial = createDefaultProjectSettings(workspaceStore.userSettings.exportDefaults);
        // seeded is essentially redundant now but kept for backwards compatibility in structure
        const seeded = applyWorkspaceDefaultsToProjectSettings(initial);
        const writableSettings = await (settingsHandle as any).createWritable();
        await writableSettings.write(`${JSON.stringify(seeded, null, 2)}\n`);
        await writableSettings.close();
      } catch (e) {
        console.warn('Failed to create project settings file', e);
      }

      const otioFileName = `${name}_001.otio`;
      const otioFile = await projectDir.getFileHandle(otioFileName, { create: true });
      const writable = await (otioFile as any).createWritable();
      await writable.write(
        `{\n  \"OTIO_SCHEMA\": \"Timeline.1\",\n  \"name\": \"${name}\",\n  \"tracks\": {\n    \"OTIO_SCHEMA\": \"Stack.1\",\n    \"children\": [],\n    \"name\": \"tracks\"\n  }\n}\n`,
      );
      await writable.close();

      currentProjectName.value = name;
      currentTimelinePath.value = otioFileName;
      currentFileName.value = otioFileName;

      await workspaceStore.loadProjects();
    } catch (e: any) {
      workspaceStore.error = e?.message ?? 'Failed to create project';
    } finally {
      workspaceStore.isLoading = false;
    }
  }

  async function openProject(name: string) {
    if (!workspaceStore.projects.includes(name)) {
      workspaceStore.error = 'Project not found';
      return;
    }

    currentProjectName.value = name;
    currentTimelinePath.value = `${name}_001.otio`;
    currentFileName.value = `${name}_001.otio`;
    workspaceStore.lastProjectName = name;

    await loadProjectSettings();
    await saveProjectSettings();
  }

  async function openTimelineFile(path: string) {
    if (!currentProjectName.value) {
      workspaceStore.error = 'Project is not opened';
      return;
    }

    const normalizedPath = toProjectRelativePath(path);
    if (!normalizedPath.toLowerCase().endsWith('.otio')) return;

    currentTimelinePath.value = normalizedPath;
    currentFileName.value = normalizedPath.split('/').pop() ?? normalizedPath;
  }

  function createFallbackTimelineDoc(): TimelineDocument {
    if (!currentProjectName.value) {
      return createDefaultTimelineDocument({ id: 'unknown', name: 'unknown', fps: 25 });
    }

    return createDefaultTimelineDocument({
      id: createTimelineDocId(currentProjectName.value),
      name: currentProjectName.value,
      fps: projectSettings.value.export.fps,
    });
  }

  return {
    currentProjectName,
    currentTimelinePath,
    currentFileName,
    projectSettings,
    isLoadingProjectSettings,
    createProject,
    openProject,
    openTimelineFile,
    closeProject,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    createFallbackTimelineDoc,
    loadProjectSettings,
    saveProjectSettings,
  };
});
