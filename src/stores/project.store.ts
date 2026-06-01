import { createDevLogger } from '~/utils/dev-logger';
import { defineStore, storeToRefs } from 'pinia';
import { ref, computed } from 'vue';

import { createTimelineDocId } from '~/timeline/id';
import type { TimelineDocument } from '~/timeline/types';
import { createDefaultTimelineDocument, serializeTimelineToOtio } from '~/timeline/otio-serializer';
import { toProjectStoragePath } from '~/utils/workspace-common';
import { isTauriRuntime } from '~/utils/runtime';

const isAbsoluteStorageRoot = (path: string): boolean => {
  return /^\//.test(path) || /^[a-zA-Z]:[\\/]/.test(path);
};
import { createTimelineFormatFromProjectDefaults } from '~/timeline/format';

import { createDefaultProjectSettings } from '~/utils/project-settings';

import {
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  TIMELINES_DIR_NAME,
  DOCUMENTS_DIR_NAME,
  EXPORT_DIR_NAME,
} from '~/utils/constants';

import { useWorkspaceStore } from './workspace.store';
import { useProjectSettingsStore } from './project-settings.store';
import { createDefaultLayoutState, createEditorViewModule } from './editor-view.store';
import { useMediaStore } from './media.store';
import { useTimelineStore } from './timeline.store';
import { useSelectionStore } from './selection.store';
import { useFileManagerStore } from './file-manager.store';
import { useHistoryStore } from './history.store';

import { createProjectFsModule } from '~/stores/project/project-fs';
import { createProjectMetaModule } from '~/stores/project/project-meta';
import { useVfs } from '~/composables/useVfs';
import { createProjectTimelinesModule } from '~/stores/project/project-timelines';
import { useProjectLock } from '~/composables/editor/useProjectLock';
import { getErrorMessage } from '~/utils/errors';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { thumbnailGenerator } from '~/utils/thumbnail-generator';
const log = createDevLogger('project.store');

export const useProjectStore = defineStore('project', () => {
  const workspaceStore = useWorkspaceStore();
  const projectSettingsStore = useProjectSettingsStore();
  const projectLock = useProjectLock();

  const {
    projectSettings,
    isLoadingProjectSettings,
    isSavingProjectSettings,
    activeMonitor,
    activeMonitorView,
  } = storeToRefs(projectSettingsStore);

  const currentProjectName = ref<string | null>(null);
  const currentProjectDirHandle = ref<FileSystemDirectoryHandle | null>(null);
  const currentProjectId = ref<string | null>(null);
  const currentTimelinePath = ref<string | null>(null);
  const currentFileName = ref<string | null>(null);

  const isReadOnly = ref(false);

  const editorViewModule = createEditorViewModule(currentProjectId, {
    getProjectOrientation: () => projectSettingsStore.projectSettings.project.orientation,
    getLayout: () => projectSettingsStore.projectSettings.ui.layout,
    updateLayout: (updater) => {
      const layout = projectSettingsStore.projectSettings.ui.layout ?? createDefaultLayoutState();
      projectSettingsStore.projectSettings.ui.layout = layout;
      updater(layout);
    },
  });

  const fsModule = createProjectFsModule({
    workspaceHandle: computed(() => workspaceStore.workspaceHandle),
    projectsHandle: computed(() => workspaceStore.projectsHandle),
    currentProjectDirHandle,
    currentProjectName,
    getVfs: () => useVfs(),
  });

  const {
    toProjectRelativePath,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    getFileByPath,
    getDirectoryHandleByPath,
    getProjectDirHandle,
    readTextByPath,
    writeTextByPath,
    writeFileByPath,
    deleteByPath,
    listEntryNames,
    pathExists,
    getFileMetadata,
  } = fsModule;

  const metaModule = createProjectMetaModule({
    currentProjectName,
    currentProjectId,
    getVfs: () => useVfs(),
  });
  const { loadProjectMeta, clearProjectMetaState } = metaModule;

  async function closeProject() {
    projectSettingsStore.closeProjectSettings();
    currentProjectName.value = null;
    currentProjectDirHandle.value = null;
    currentProjectId.value = null;
    currentTimelinePath.value = null;
    currentFileName.value = null;
    isReadOnly.value = false;

    // Reset dependent stores before async gap to prevent stale debounced
    // history timeouts from firing while the timeline document is gone.
    const mediaStore = useMediaStore();
    const timelineStore = useTimelineStore();
    const selectionStore = useSelectionStore();
    const fileManagerStore = useFileManagerStore();
    const historyStore = useHistoryStore();

    mediaStore.resetMediaState();
    timelineStore.resetTimelineState();
    selectionStore.clearSelection();
    fileManagerStore.resetFileManagerState();
    historyStore.clearAll();

    fileThumbnailGenerator.reset();
    thumbnailGenerator.reset();

    await projectLock.releaseLock();
    clearProjectMetaState();
  }

  const timelinesModule = createProjectTimelinesModule({
    currentProjectName,
    currentTimelinePath,
    currentFileName,
    projectSettings,
    toProjectRelativePath,
    saveProjectMeta: metaModule.saveProjectMeta,
    setWorkspaceError: (message) => {
      workspaceStore.error = message;
    },
    onActiveTimelineChanged: async () => {
      const timelineStore = useTimelineStore();
      if (currentTimelinePath.value) {
        await timelineStore.loadTimeline();
      } else {
        // No tabs left open — clear the editor instead of leaving a stale doc.
        timelineStore.resetTimelineState();
      }
    },
  });

  const {
    openTimelineFile,
    closeTimelineFile,
    reorderTimelines,
    closeOtherTimelineFiles,
    closeAllTimelineFiles,
  } = timelinesModule;

  watch(currentTimelinePath, async (newPath) => {
    if (newPath && metaModule.projectMeta.value) {
      if (metaModule.projectMeta.value.lastOpenedTimelinePath !== newPath) {
        await metaModule.saveProjectMeta({ lastOpenedTimelinePath: newPath });

        if (currentProjectName.value && currentProjectId.value) {
          workspaceStore.updateRecentProject({
            projectName: currentProjectName.value,
            projectId: currentProjectId.value,
            lastTimelinePath: newPath,
          });
        }
      }
    }
  });

  projectSettingsStore.setContext({
    getProjectDirHandle,
    getCurrentProjectName: () => currentProjectName.value,
    getIsReadOnly: () => isReadOnly.value,
    getProjectMeta: () => metaModule.projectMeta.value,
    saveProjectMeta: metaModule.saveProjectMeta,
    getCurrentEditorView: () => editorViewModule.currentView.value,
    getLastViewBeforeFullscreen: () => editorViewModule.lastViewBeforeFullscreen.value,
  });

  watch(projectLock.isLockLost, (isLost) => {
    if (isLost) {
      isReadOnly.value = true;
    }
  });

  // Register emergency autosave so pending changes are flushed before lock is
  // handed over to another tab on steal.
  const timelineStoreForFlush = useTimelineStore();
  projectLock.setOnBeforeRelease(async () => {
    if (!isReadOnly.value) {
      await timelineStoreForFlush.flushTimelineAutosave();
    }
  });

  async function stealProjectLock() {
    if (!currentProjectId.value) return;
    const lockAcquired = await projectLock.stealLock(currentProjectId.value);
    isReadOnly.value = !lockAcquired;

    if (lockAcquired) {
      // Reload timeline to get latest changes from the previous tab
      const timelineStore = useTimelineStore();
      await timelineStore.loadTimeline();
    }
  }

  async function loadProjectSettings() {
    await projectSettingsStore.loadProjectSettings();
  }

  async function saveProjectSettings() {
    await projectSettingsStore.saveProjectSettings();
  }

  async function createProject(
    name: string,
    options?: {
      presetId?: string;
      width?: number;
      height?: number;
      fps?: number;
      resolutionFormat?: string;
      orientation?: 'landscape' | 'portrait';
      aspectRatio?: string;
      isCustomResolution?: boolean;
      sampleRate?: number;
      parentPath?: string;
    },
  ) {
    const isTauri = isTauriRuntime();

    if (!isTauri && !workspaceStore.projectsHandle) {
      workspaceStore.error = 'Workspace not initialized';
      return;
    }

    if (!isTauri && workspaceStore.projects.includes(name)) {
      workspaceStore.error = 'Project already exists';
      return;
    }

    workspaceStore.error = null;
    workspaceStore.isLoading = true;

    try {
      const vfs = useVfs();
      let projectPath = '';

      if (isTauri) {
        const { join } = await import('@tauri-apps/api/path');
        const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
        const parentDir = options?.parentPath || workspaceStore.resolvedStorageTopology.projectsRoot;
        projectPath = await join(parentDir, name);

        if (await exists(projectPath)) {
          workspaceStore.error = `Project folder "${name}" already exists`;
          workspaceStore.isLoading = false;
          return;
        }

        await mkdir(projectPath, { recursive: true });
        const { TauriDirectoryHandle } = await import('~/stores/workspace/provider/tauri-handle');
        currentProjectDirHandle.value = new TauriDirectoryHandle(projectPath, name) as unknown as FileSystemDirectoryHandle;
      }

      currentProjectName.value = name;

      // Create folder structure inside the project
      for (const dirName of [
        VIDEO_DIR_NAME,
        AUDIO_DIR_NAME,
        IMAGES_DIR_NAME,
        DOCUMENTS_DIR_NAME,
        TIMELINES_DIR_NAME,
        EXPORT_DIR_NAME,
        '.fastcat',
      ]) {
        if (isTauri) {
          const { mkdir } = await import('@tauri-apps/plugin-fs');
          const { join } = await import('@tauri-apps/api/path');
          await mkdir(await join(projectPath, dirName), { recursive: true });
        } else {
          await vfs.createDirectory(toProjectStoragePath(name, dirName));
        }
      }

      try {
        if (isTauri) {
          await projectSettingsStore.saveInitialProjectSettingsForNewProject({ projectName: '' });
        } else {
          await projectSettingsStore.saveInitialProjectSettingsForNewProject({ projectName: name });
        }
      } catch (e) {
        log.warn('Failed to create project settings file', e);
      }

      const initialSettings = createDefaultProjectSettings(workspaceStore.userSettings);
      initialSettings.project.isAutoSettings = true;

      if (options?.presetId) {
        workspaceStore.userSettings.projectPresets.lastUsedPresetId = options.presetId;
      }

      if (options) {
        // If user provided specific options, it's not "Auto" anymore
        const hasProjectOptions =
          options.width !== undefined ||
          options.height !== undefined ||
          options.fps !== undefined ||
          options.resolutionFormat !== undefined ||
          options.orientation !== undefined ||
          options.aspectRatio !== undefined ||
          options.sampleRate !== undefined;

        if (hasProjectOptions) {
          initialSettings.project.isAutoSettings = false;
        }

        if (options.width !== undefined) initialSettings.project.width = options.width;
        if (options.height !== undefined) initialSettings.project.height = options.height;
        if (options.fps !== undefined) initialSettings.project.fps = options.fps;
        if (options.resolutionFormat !== undefined)
          initialSettings.project.resolutionFormat = options.resolutionFormat;
        if (options.orientation !== undefined)
          initialSettings.project.orientation = options.orientation;
        if (options.aspectRatio !== undefined)
          initialSettings.project.aspectRatio = options.aspectRatio;
        if (options.isCustomResolution !== undefined)
          initialSettings.project.isCustomResolution = options.isCustomResolution;
        if (options.sampleRate !== undefined)
          initialSettings.project.sampleRate = options.sampleRate;
      }

      const otioFileName = `${name}_001.otio`;
      const initialTimeline = `${TIMELINES_DIR_NAME}/${otioFileName}`;

      const payload = createDefaultTimelineDocument({
        id: name,
        name,
        format: createTimelineFormatFromProjectDefaults(initialSettings.project),
      });

      await vfs.writeFile(
        toProjectStoragePath(name, initialTimeline),
        serializeTimelineToOtio(payload),
      );

      currentProjectName.value = name;
      await loadProjectMeta();

      // Acquire lock immediately after the project ID is assigned, so this tab
      // is the exclusive owner from the start.
      if (currentProjectId.value) {
        const lockAcquired = await projectLock.acquireLock(currentProjectId.value);
        isReadOnly.value = !lockAcquired;
      } else {
        log.warn('createProject: projectId is unknown after loadProjectMeta');
      }

      currentTimelinePath.value = initialTimeline;
      currentFileName.value = initialTimeline;

      initialSettings.timelines.openPaths = [initialTimeline];
      projectSettings.value = initialSettings;

      await metaModule.saveProjectMeta({ lastOpenedTimelinePath: initialTimeline });

      if (currentProjectId.value) {
        workspaceStore.updateRecentProject({
          projectName: name,
          projectId: currentProjectId.value,
          lastTimelinePath: initialTimeline,
        });
      }

      await workspaceStore.loadProjects();
      await saveProjectSettings();
    } catch (e: unknown) {
      workspaceStore.error = getErrorMessage(e, 'Failed to create project');
    } finally {
      workspaceStore.isLoading = false;
    }
  }

  async function openProject(nameOrPath: string) {
    const isTauri = isTauriRuntime();
    let name = nameOrPath;
    let path = nameOrPath;

    if (isTauri) {
      const isAbsolute = isAbsoluteStorageRoot(nameOrPath);
      if (isAbsolute) {
        const { basename } = await import('@tauri-apps/api/path');
        name = await basename(nameOrPath);
        path = nameOrPath;
      } else {
        const { join } = await import('@tauri-apps/api/path');
        path = await join(workspaceStore.resolvedStorageTopology.projectsRoot, nameOrPath);
        name = nameOrPath;
      }

      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('allow_path_scope', { path }).catch(() => {});

      const { TauriDirectoryHandle } = await import('~/stores/workspace/provider/tauri-handle');
      currentProjectDirHandle.value = new TauriDirectoryHandle(path, name) as unknown as FileSystemDirectoryHandle;
    } else {
      if (!workspaceStore.projects.includes(name)) {
        workspaceStore.error = 'Project not found';
        return;
      }
    }

    currentProjectName.value = name;
    workspaceStore.lastProjectName = name;

    await loadProjectMeta();
    if (currentProjectId.value) {
      workspaceStore.updateRecentProject({
        projectName: name,
        projectId: currentProjectId.value,
        lastTimelinePath: metaModule.projectMeta.value?.lastOpenedTimelinePath,
      });
    }

    // Acquire lock after project ID is known (loaded from meta).
    // Fall back to project name as lock key for legacy projects without a stored ID.
    const lockKey = currentProjectId.value ?? currentProjectName.value;
    if (lockKey) {
      const lockAcquired = await projectLock.acquireLock(lockKey);
      isReadOnly.value = !lockAcquired;
    } else {
      log.warn('Cannot acquire lock: neither projectId nor projectName is available');
      isReadOnly.value = false;
    }

    await loadProjectSettings();

    // If no timelines are open, open the last one from meta or default
    const openPaths = projectSettings.value.timelines.openPaths;

    if (openPaths.length === 0) {
      const lastPath =
        metaModule.projectMeta.value?.lastOpenedTimelinePath ||
        `${TIMELINES_DIR_NAME}/${name}_001.otio`;
      await openTimelineFile(lastPath);
    } else {
      const lastPath = metaModule.projectMeta.value?.lastOpenedTimelinePath;
      if (lastPath && openPaths.includes(lastPath)) {
        await openTimelineFile(lastPath);
      } else {
        await openTimelineFile(openPaths[0]!);
      }
    }

    if (!isReadOnly.value) {
      await saveProjectSettings();
    }
  }

  function createFallbackTimelineDoc(): TimelineDocument {
    if (!currentProjectName.value) {
      return createDefaultTimelineDocument({
        id: 'unknown',
        name: 'unknown',
        format: createTimelineFormatFromProjectDefaults({ fps: 25 }),
      });
    }

    return createDefaultTimelineDocument({
      id: createTimelineDocId(currentProjectName.value),
      name: currentProjectName.value,
      format: createTimelineFormatFromProjectDefaults(projectSettings.value.project),
    });
  }

  async function deleteCurrentProject() {
    if (!currentProjectName.value) return;
    if (isReadOnly.value) {
      log.warn('deleteCurrentProject blocked: project is read-only');
      return;
    }
    await workspaceStore.deleteProject(
      currentProjectName.value,
      currentProjectId.value ?? undefined,
    );
    closeProject();
  }

  return {
    currentProjectName,
    currentProjectId,
    currentTimelinePath,
    currentFileName,
    isReadOnly,
    projectSettings,
    isLoadingProjectSettings,
    isSavingProjectSettings,
    createProject,
    openProject,
    openTimelineFile,
    closeTimelineFile,
    reorderTimelines,
    closeOtherTimelineFiles,
    closeAllTimelineFiles,
    closeProject,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    getFileByPath,
    getDirectoryHandleByPath,
    getProjectDirHandle,
    readTextByPath,
    writeTextByPath,
    writeFileByPath,
    deleteByPath,
    listEntryNames,
    pathExists,
    getFileMetadata,
    createFallbackTimelineDoc,
    loadProjectSettings,
    saveProjectSettings,
    deleteCurrentProject,
    stealProjectLock,
    projectMeta: metaModule.projectMeta,
    saveProjectMeta: metaModule.saveProjectMeta,
    loadProjectMeta: metaModule.loadProjectMeta,
    activeMonitor,
    activeMonitorView,
    ...editorViewModule,
  };
});
