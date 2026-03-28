import { defineStore, storeToRefs } from 'pinia';
import { ref, computed } from 'vue';

import { createTimelineDocId } from '~/timeline/id';
import type { TimelineDocument } from '~/timeline/types';
import { createDefaultTimelineDocument } from '~/timeline/otioSerializer';

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
import { createEditorViewModule } from './editor-view.store';
import { useMediaStore } from './media.store';
import { useTimelineStore } from './timeline.store';
import { useSelectionStore } from './selection.store';
import { useFilesPageStore } from './files-page.store';
import { useHistoryStore } from './history.store';

import { createProjectFsModule } from '~/stores/project/projectFs';
import { createProjectMetaModule } from '~/stores/project/projectMeta';
import { createProjectTimelinesModule } from '~/stores/project/projectTimelines';
import { useProjectLock } from '~/composables/editor/useProjectLock';
import { getErrorMessage } from '~/utils/errors';

export const useProjectStore = defineStore('project', () => {
  const workspaceStore = useWorkspaceStore();
  const projectSettingsStore = useProjectSettingsStore();
  const projectLock = useProjectLock();

  const { projectSettings, isLoadingProjectSettings, isSavingProjectSettings, activeMonitor } =
    storeToRefs(projectSettingsStore);

  const currentProjectName = ref<string | null>(null);
  const currentProjectId = ref<string | null>(null);
  const currentTimelinePath = ref<string | null>(null);
  const currentFileName = ref<string | null>(null);

  const isReadOnly = ref(false);

  const editorViewModule = createEditorViewModule(currentProjectId, {
    getProjectOrientation: () => projectSettingsStore.projectSettings.project.orientation,
  });

  const fsModule = createProjectFsModule({
    workspaceHandle: computed(() => workspaceStore.workspaceHandle),
    projectsHandle: computed(() => workspaceStore.projectsHandle),
    currentProjectName,
  });

  const {
    toProjectRelativePath,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    getFileByPath,
    getDirectoryHandleByPath,
    getProjectDirHandle,
  } = fsModule;

  const metaModule = createProjectMetaModule({
    currentProjectName,
    currentProjectId,
    getProjectDirHandle,
  });
  const { loadProjectMeta, clearProjectMetaState } = metaModule;

  async function closeProject() {
    projectSettingsStore.closeProjectSettings();
    currentProjectName.value = null;
    currentProjectId.value = null;
    currentTimelinePath.value = null;
    currentFileName.value = null;
    isReadOnly.value = false;
    await projectLock.releaseLock();
    clearProjectMetaState();

    // Reset dependent stores when a project is closed
    const mediaStore = useMediaStore();
    const timelineStore = useTimelineStore();
    const selectionStore = useSelectionStore();
    const filesPageStore = useFilesPageStore();
    const historyStore = useHistoryStore();

    mediaStore.resetMediaState();
    timelineStore.resetTimelineState();
    selectionStore.clearSelection();
    filesPageStore.resetFilesPageState();
    historyStore.clear('timeline');
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
    },
  ) {
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
      await projectDir.getDirectoryHandle(VIDEO_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(AUDIO_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(IMAGES_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(DOCUMENTS_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(TIMELINES_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(EXPORT_DIR_NAME, { create: true });

      try {
        await projectDir.getDirectoryHandle('.fastcat', { create: true });
        await projectSettingsStore.saveInitialProjectSettingsForNewProject({ projectDir });
      } catch (e) {
        console.warn('Failed to create project settings file', e);
      }

      const otioFileName = `${name}_001.otio`;
      const timelinesDir = await projectDir.getDirectoryHandle(TIMELINES_DIR_NAME, {
        create: true,
      });
      const otioFile = await timelinesDir.getFileHandle(otioFileName, { create: true });
      if (typeof (otioFile as FileSystemFileHandle).createWritable !== 'function') {
        throw new Error('Failed to create timeline: createWritable is not available');
      }
      const writable = await (otioFile as FileSystemFileHandle).createWritable();
      const payload = {
        OTIO_SCHEMA: 'Timeline.1',
        name,
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          children: [],
          name: 'tracks',
        },
      };
      await writable.write(`${JSON.stringify(payload, null, 2)}\n`);
      await writable.close();

      const initialTimeline = `${TIMELINES_DIR_NAME}/${otioFileName}`;

      currentProjectName.value = name;
      await loadProjectMeta();

      currentTimelinePath.value = initialTimeline;
      currentFileName.value = initialTimeline;

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

  async function openProject(name: string) {
    if (!workspaceStore.projects.includes(name)) {
      workspaceStore.error = 'Project not found';
      return;
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

    // Acquire lock after project ID is known (loaded from meta)
    if (currentProjectId.value) {
      const lockAcquired = await projectLock.acquireLock(currentProjectId.value);
      isReadOnly.value = !lockAcquired;
    } else {
      console.warn('Cannot acquire lock: projectId is unknown');
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
      return createDefaultTimelineDocument({ id: 'unknown', name: 'unknown', fps: 25 });
    }

    return createDefaultTimelineDocument({
      id: createTimelineDocId(currentProjectName.value),
      name: currentProjectName.value,
      fps: projectSettings.value.project.fps,
    });
  }

  async function deleteCurrentProject() {
    if (!currentProjectName.value) return;
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
    createFallbackTimelineDoc,
    loadProjectSettings,
    saveProjectSettings,
    deleteCurrentProject,
    projectMeta: metaModule.projectMeta,
    saveProjectMeta: metaModule.saveProjectMeta,
    loadProjectMeta: metaModule.loadProjectMeta,
    activeMonitor,
    ...editorViewModule,
  };
});
