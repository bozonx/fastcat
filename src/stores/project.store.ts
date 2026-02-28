import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';

import { createTimelineDocId } from '~/timeline/id';
import type { TimelineDocument } from '~/timeline/types';
import { createDefaultTimelineDocument } from '~/timeline/otioSerializer';

import { SOURCES_DIR_NAME } from '~/utils/constants';

import { useWorkspaceStore } from './workspace.store';

interface ProjectMeta {
  id: string;
}

function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export interface GranVideoEditorProjectSettings {
  project: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
  };
  exportDefaults: {
    encoding: {
      format: 'mp4' | 'webm' | 'mkv';
      videoCodec: string;
      bitrateMbps: number;
      excludeAudio: boolean;
      audioCodec: 'aac' | 'opus';
      audioBitrateKbps: number;
    };
  };
  monitor: {
    previewResolution: number;
    useProxy: boolean;
    panX: number;
    panY: number;
  };
  timelines: {
    openPaths: string[];
    lastOpenedPath: string | null;
  };
  transitions: {
    defaultDurationUs: number;
  };
}

const DEFAULT_PROJECT_SETTINGS = {
  project: {
    width: 1920,
    height: 1080,
    fps: 25,
    resolutionFormat: '1080p',
    orientation: 'landscape' as const,
    aspectRatio: '16:9',
    isCustomResolution: false,
  },
  exportDefaults: {
    encoding: {
      format: 'mp4' as const,
      videoCodec: 'avc1.640032',
      bitrateMbps: 5,
      excludeAudio: false,
      audioCodec: 'aac' as const,
      audioBitrateKbps: 128,
    },
  },
  monitor: {
    previewResolution: 480,
    useProxy: true,
    panX: 0,
    panY: 0,
  },
  timelines: {
    openPaths: [],
    lastOpenedPath: null,
  },
  transitions: {
    defaultDurationUs: 2_000_000,
  },
};

function getProjectSettingsFromUserDefaults(userSettings: {
  projectDefaults: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
  };
  exportDefaults: {
    encoding: {
      format: 'mp4' | 'webm' | 'mkv';
      videoCodec: string;
      bitrateMbps: number;
      excludeAudio: boolean;
      audioCodec: 'aac' | 'opus';
      audioBitrateKbps: number;
    };
  };
}): Pick<GranVideoEditorProjectSettings, 'project' | 'exportDefaults'> {
  return {
    project: {
      width: userSettings.projectDefaults.width,
      height: userSettings.projectDefaults.height,
      fps: userSettings.projectDefaults.fps,
      resolutionFormat: userSettings.projectDefaults.resolutionFormat,
      orientation: userSettings.projectDefaults.orientation,
      aspectRatio: userSettings.projectDefaults.aspectRatio,
      isCustomResolution: userSettings.projectDefaults.isCustomResolution,
    },
    exportDefaults: {
      encoding: {
        format: userSettings.exportDefaults.encoding.format,
        videoCodec: userSettings.exportDefaults.encoding.videoCodec,
        bitrateMbps: userSettings.exportDefaults.encoding.bitrateMbps,
        excludeAudio: userSettings.exportDefaults.encoding.excludeAudio,
        audioCodec: userSettings.exportDefaults.encoding.audioCodec,
        audioBitrateKbps: userSettings.exportDefaults.encoding.audioBitrateKbps,
      },
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

function createDefaultProjectSettings(userSettings: {
  projectDefaults: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
  };
  exportDefaults: {
    encoding: {
      format: 'mp4' | 'webm' | 'mkv';
      videoCodec: string;
      bitrateMbps: number;
      excludeAudio: boolean;
      audioCodec: 'aac' | 'opus';
      audioBitrateKbps: number;
    };
  };
}): GranVideoEditorProjectSettings {
  const base = getProjectSettingsFromUserDefaults(userSettings);
  return {
    ...base,
    monitor: {
      previewResolution: DEFAULT_PROJECT_SETTINGS.monitor.previewResolution,
      useProxy: DEFAULT_PROJECT_SETTINGS.monitor.useProxy,
      panX: DEFAULT_PROJECT_SETTINGS.monitor.panX,
      panY: DEFAULT_PROJECT_SETTINGS.monitor.panY,
    },
    timelines: {
      openPaths: [],
      lastOpenedPath: null,
    },
    transitions: {
      defaultDurationUs: DEFAULT_PROJECT_SETTINGS.transitions.defaultDurationUs,
    },
  };
}

function normalizeProjectSettings(
  raw: unknown,
  userSettings: {
    projectDefaults: {
      width: number;
      height: number;
      fps: number;
      resolutionFormat: string;
      orientation: 'landscape' | 'portrait';
      aspectRatio: string;
      isCustomResolution: boolean;
    };
    exportDefaults: {
      encoding: {
        format: 'mp4' | 'webm' | 'mkv';
        videoCodec: string;
        bitrateMbps: number;
        excludeAudio: boolean;
        audioCodec: 'aac' | 'opus';
        audioBitrateKbps: number;
      };
    };
  },
): GranVideoEditorProjectSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultProjectSettings(userSettings);
  }

  const input = raw as Record<string, any>;

  // Migration: move resolution/fps from legacy export section to project section
  // Also handle rename of 'export' to 'exportDefaults'
  const legacyExportInput = input.exportDefaults ?? input.export ?? {};
  const projectInput = input.project ?? (input.export ? input.export : {}) ?? {};
  const encodingInput = legacyExportInput?.encoding ?? {};

  const monitorInput = input.monitor ?? {};
  const transitionsInput = input.transitions ?? {};

  const defaultSettings = createDefaultProjectSettings(userSettings);

  const width = Number(projectInput.width);
  const height = Number(projectInput.height);
  const fps = Number(projectInput.fps);

  const bitrateMbps = Number(encodingInput.bitrateMbps);
  const audioBitrateKbps = Number(encodingInput.audioBitrateKbps);
  const format = encodingInput.format;

  const previewResolution = Number(monitorInput.previewResolution);
  const useProxy = monitorInput.useProxy;
  const panX = Number(monitorInput.panX);
  const panY = Number(monitorInput.panY);
  const defaultTransitionDurationUs = Number(transitionsInput.defaultDurationUs);

  const finalWidth =
    Number.isFinite(width) && width > 0 ? Math.round(width) : defaultSettings.project.width;
  const finalHeight =
    Number.isFinite(height) && height > 0 ? Math.round(height) : defaultSettings.project.height;

  const isWidthHeightCustom =
    finalWidth !== defaultSettings.project.width || finalHeight !== defaultSettings.project.height;

  const preset = isWidthHeightCustom
    ? getResolutionPreset(finalWidth, finalHeight)
    : {
        resolutionFormat: projectInput.resolutionFormat || defaultSettings.project.resolutionFormat,
        orientation: projectInput.orientation || defaultSettings.project.orientation,
        aspectRatio: projectInput.aspectRatio || defaultSettings.project.aspectRatio,
        isCustomResolution:
          projectInput.isCustomResolution !== undefined
            ? projectInput.isCustomResolution
            : defaultSettings.project.isCustomResolution,
      };

  return {
    project: {
      width: finalWidth,
      height: finalHeight,
      fps:
        Number.isFinite(fps) && fps > 0
          ? Math.round(Math.min(240, Math.max(1, fps)))
          : defaultSettings.project.fps,
      resolutionFormat:
        typeof projectInput.resolutionFormat === 'string' &&
        projectInput.resolutionFormat &&
        !isWidthHeightCustom
          ? projectInput.resolutionFormat
          : preset.resolutionFormat,
      orientation:
        (projectInput.orientation === 'portrait' || projectInput.orientation === 'landscape') &&
        !isWidthHeightCustom
          ? projectInput.orientation
          : (preset.orientation as 'landscape' | 'portrait'),
      aspectRatio:
        typeof projectInput.aspectRatio === 'string' &&
        projectInput.aspectRatio &&
        !isWidthHeightCustom
          ? projectInput.aspectRatio
          : preset.aspectRatio,
      isCustomResolution:
        projectInput.isCustomResolution !== undefined && !isWidthHeightCustom
          ? Boolean(projectInput.isCustomResolution)
          : preset.isCustomResolution,
    },
    exportDefaults: {
      encoding: {
        format: format === 'webm' || format === 'mkv' ? format : 'mp4',
        videoCodec:
          typeof encodingInput.videoCodec === 'string' && encodingInput.videoCodec.trim().length > 0
            ? encodingInput.videoCodec
            : DEFAULT_PROJECT_SETTINGS.exportDefaults.encoding.videoCodec,
        bitrateMbps:
          Number.isFinite(bitrateMbps) && bitrateMbps > 0
            ? Math.min(200, Math.max(0.2, bitrateMbps))
            : DEFAULT_PROJECT_SETTINGS.exportDefaults.encoding.bitrateMbps,
        excludeAudio: Boolean(encodingInput.excludeAudio),
        audioCodec: encodingInput.audioCodec === 'opus' ? 'opus' : 'aac',
        audioBitrateKbps:
          Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
            ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
            : DEFAULT_PROJECT_SETTINGS.exportDefaults.encoding.audioBitrateKbps,
      },
    },
    monitor: {
      previewResolution:
        Number.isFinite(previewResolution) && previewResolution > 0
          ? Math.round(previewResolution)
          : DEFAULT_PROJECT_SETTINGS.monitor.previewResolution,
      useProxy:
        useProxy === undefined ? DEFAULT_PROJECT_SETTINGS.monitor.useProxy : Boolean(useProxy),
      panX: Number.isFinite(panX) ? panX : DEFAULT_PROJECT_SETTINGS.monitor.panX,
      panY: Number.isFinite(panY) ? panY : DEFAULT_PROJECT_SETTINGS.monitor.panY,
    },
    timelines: {
      openPaths: Array.isArray(input.timelines?.openPaths)
        ? input.timelines.openPaths.filter((p: any) => typeof p === 'string')
        : [],
      lastOpenedPath:
        typeof input.timelines?.lastOpenedPath === 'string' ? input.timelines.lastOpenedPath : null,
    },
    transitions: {
      defaultDurationUs:
        Number.isFinite(defaultTransitionDurationUs) && defaultTransitionDurationUs > 0
          ? Math.round(defaultTransitionDurationUs)
          : defaultSettings.transitions.defaultDurationUs,
    },
  };
}

export const useProjectStore = defineStore('project', () => {
  const workspaceStore = useWorkspaceStore();

  const currentProjectName = ref<string | null>(null);
  const currentProjectId = ref<string | null>(null);
  const currentTimelinePath = ref<string | null>(null);
  const currentFileName = ref<string | null>(null);

  const projectSettings = ref<GranVideoEditorProjectSettings>(
    createDefaultProjectSettings(workspaceStore.userSettings),
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
    currentProjectId.value = null;
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
    } catch (e: any) {
      if (e.name !== 'NotFoundError') {
        console.error('Failed to get project file handle by path:', input.relativePath, e);
      }
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

  async function ensureProjectMetaFile(options?: {
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!workspaceStore.projectsHandle || !currentProjectName.value) return null;

    const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
      currentProjectName.value,
    );
    const granDir = await projectDir.getDirectoryHandle('.gran', {
      create: options?.create ?? false,
    });

    return await granDir.getFileHandle('project.meta.json', {
      create: options?.create ?? false,
    });
  }

  async function loadProjectMeta() {
    if (!workspaceStore.projectsHandle || !currentProjectName.value) return;

    try {
      const metaHandle = await ensureProjectMetaFile({ create: false });
      if (metaHandle) {
        const file = await metaHandle.getFile();
        const text = await file.text();
        if (text.trim()) {
          const parsed = JSON.parse(text) as ProjectMeta;
          if (parsed?.id && typeof parsed.id === 'string') {
            currentProjectId.value = parsed.id;
            return;
          }
        }
      }
    } catch {
      // ignore
    }

    const nextId = createProjectId();
    currentProjectId.value = nextId;

    try {
      const metaHandle = await ensureProjectMetaFile({ create: true });
      if (!metaHandle) return;
      const writable = await (metaHandle as any).createWritable();
      await writable.write(`${JSON.stringify({ id: nextId } satisfies ProjectMeta, null, 2)}\n`);
      await writable.close();
    } catch (e) {
      console.warn('Failed to write project meta file', e);
    }
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
          workspaceStore.userSettings,
        );
        return;
      }

      const settingsFile = await settingsFileHandle.getFile();
      const text = await settingsFile.text();
      if (!text.trim()) {
        projectSettings.value = createDefaultProjectSettings(
          workspaceStore.userSettings,
        );
        return;
      }

      const parsed = JSON.parse(text);
      projectSettings.value = normalizeProjectSettings(
        parsed,
        workspaceStore.userSettings,
      );
    } catch (e: any) {
      if (e?.name === 'NotFoundError') {
        projectSettings.value = createDefaultProjectSettings(
          workspaceStore.userSettings,
        );
        return;
      }

      console.warn('Failed to load project settings, fallback to defaults', e);
      projectSettings.value = createDefaultProjectSettings(
        workspaceStore.userSettings,
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
      const sourcesDir = await projectDir.getDirectoryHandle(SOURCES_DIR_NAME, { create: true });
      await sourcesDir.getDirectoryHandle('video', { create: true });
      await sourcesDir.getDirectoryHandle('audio', { create: true });
      await sourcesDir.getDirectoryHandle('images', { create: true });
      await sourcesDir.getDirectoryHandle('timelines', { create: true });

      try {
        const granDir = await projectDir.getDirectoryHandle('.gran', { create: true });
        try {
          const metaHandle = await granDir.getFileHandle('project.meta.json', { create: true });
          const id = createProjectId();
          const writableMeta = await (metaHandle as any).createWritable();
          await writableMeta.write(`${JSON.stringify({ id } satisfies ProjectMeta, null, 2)}\n`);
          await writableMeta.close();
        } catch (e) {
          console.warn('Failed to create project meta file', e);
        }

        const settingsHandle = await granDir.getFileHandle('project.settings.json', {
          create: true,
        });

        const initial = createDefaultProjectSettings(workspaceStore.userSettings);
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
      await loadProjectMeta();
      const initialTimeline = otioFileName;
      currentTimelinePath.value = initialTimeline;
      currentFileName.value = initialTimeline;

      const initialSettings = createDefaultProjectSettings(
        workspaceStore.userSettings,
      );
      initialSettings.timelines.openPaths = [initialTimeline];
      initialSettings.timelines.lastOpenedPath = initialTimeline;
      projectSettings.value = initialSettings;

      await workspaceStore.loadProjects();
      await saveProjectSettings();
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
    workspaceStore.lastProjectName = name;

    await loadProjectMeta();

    await loadProjectSettings();

    // If no timelines are open, open the default one
    if (projectSettings.value.timelines.openPaths.length === 0) {
      const defaultTimeline = `${name}_001.otio`;
      projectSettings.value.timelines.openPaths = [defaultTimeline];
    }

    // Set current timeline to the last opened one if it's in the list, otherwise use the first one
    const openPaths = projectSettings.value.timelines.openPaths;
    const lastOpened = projectSettings.value.timelines.lastOpenedPath;

    if (lastOpened && openPaths.includes(lastOpened)) {
      await openTimelineFile(lastOpened);
    } else if (openPaths.length > 0) {
      await openTimelineFile(openPaths[0]!);
    }

    await saveProjectSettings();
  }

  async function openTimelineFile(path: string) {
    if (!currentProjectName.value) {
      workspaceStore.error = 'Project is not opened';
      return;
    }

    const normalizedPath = toProjectRelativePath(path);
    if (!normalizedPath.toLowerCase().endsWith('.otio')) return;

    if (!projectSettings.value.timelines.openPaths.includes(normalizedPath)) {
      projectSettings.value.timelines.openPaths.push(normalizedPath);
    }

    projectSettings.value.timelines.lastOpenedPath = normalizedPath;

    currentTimelinePath.value = normalizedPath;
    currentFileName.value = normalizedPath.split('/').pop() ?? normalizedPath;
  }

  async function closeTimelineFile(path: string) {
    const index = projectSettings.value.timelines.openPaths.indexOf(path);
    if (index === -1) return;

    projectSettings.value.timelines.openPaths.splice(index, 1);

    if (currentTimelinePath.value === path) {
      const nextPath = projectSettings.value.timelines.openPaths[0] || null;
      if (nextPath) {
        await openTimelineFile(nextPath);
      } else {
        currentTimelinePath.value = null;
        currentFileName.value = null;
      }
    }
  }

  function reorderTimelines(paths: string[]) {
    projectSettings.value.timelines.openPaths = paths;
  }

  function createFallbackTimelineDoc(): TimelineDocument {
    if (!currentProjectName.value) {
      return createDefaultTimelineDocument({ id: 'unknown', name: 'unknown', fps: 25 });
    }

    return createDefaultTimelineDocument({
      id: createTimelineDocId(currentProjectName.value),
      name: currentProjectName.value,
      fps: projectSettings.value.project.fps,
    });
  }

  return {
    currentProjectName,
    currentProjectId,
    currentTimelinePath,
    currentFileName,
    projectSettings,
    isLoadingProjectSettings,
    createProject,
    openProject,
    openTimelineFile,
    closeTimelineFile,
    reorderTimelines,
    closeProject,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    createFallbackTimelineDoc,
    loadProjectSettings,
    saveProjectSettings,
  };
});
