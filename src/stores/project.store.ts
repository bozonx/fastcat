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
  EXPORT_DIR_NAME,
} from '~/utils/constants';

import { useWorkspaceStore } from './workspace.store';
import { useProjectSettingsStore } from './project-settings.store';
import { createEditorViewModule } from './editorView.store';

import { createProjectFsModule } from '~/stores/project/projectFs';
import { createProjectMetaModule } from '~/stores/project/projectMeta';
import { createProjectTimelinesModule } from '~/stores/project/projectTimelines';

export const useProjectStore = defineStore('project', () => {
  const workspaceStore = useWorkspaceStore();
  const projectSettingsStore = useProjectSettingsStore();

  const { projectSettings, isLoadingProjectSettings, isSavingProjectSettings } =
    storeToRefs(projectSettingsStore);

  function getErrorMessage(e: unknown, fallback: string): string {
    if (!e || typeof e !== 'object') return fallback;
    if (!('message' in e)) return fallback;
    const msg = (e as { message?: unknown }).message;
    return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
  }

  const currentProjectName = ref<string | null>(null);
  const currentProjectId = ref<string | null>(null);
  const currentTimelinePath = ref<string | null>(null);
  const currentFileName = ref<string | null>(null);

  const editorViewModule = createEditorViewModule(currentProjectId);

  const fsModule = createProjectFsModule({
    projectsHandle: computed(() => workspaceStore.projectsHandle) as any,
    currentProjectName,
  });

  const {
    toProjectRelativePath,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    getProjectDirHandle,
  } = fsModule;

  const metaModule = createProjectMetaModule({
    currentProjectName,
    currentProjectId,
    getProjectDirHandle,
  });
  const { loadProjectMeta, clearProjectMetaState } = metaModule;

  function closeProject() {
    projectSettingsStore.closeProjectSettings();
    currentProjectName.value = null;
    currentProjectId.value = null;
    currentTimelinePath.value = null;
    currentFileName.value = null;
    clearProjectMetaState();
  }

  const timelinesModule = createProjectTimelinesModule({
    currentProjectName,
    currentTimelinePath,
    currentFileName,
    projectSettings: projectSettings as any,
    toProjectRelativePath,
    setWorkspaceError: (message) => {
      workspaceStore.error = message;
    },
  });

  const { openTimelineFile, closeTimelineFile, reorderTimelines } = timelinesModule;

  projectSettingsStore.setContext({
    getProjectDirHandle,
    getCurrentProjectName: () => currentProjectName.value,
  });

  async function loadProjectSettings() {
    await projectSettingsStore.loadProjectSettings();
  }

  async function saveProjectSettings() {
    await projectSettingsStore.saveProjectSettings();
  }

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
      await projectDir.getDirectoryHandle(VIDEO_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(AUDIO_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(IMAGES_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(TIMELINES_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(EXPORT_DIR_NAME, { create: true });

      try {
        await projectDir.getDirectoryHandle('.gran', { create: true });
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
      initialSettings.timelines.openPaths = [initialTimeline];
      initialSettings.timelines.lastOpenedPath = initialTimeline;
      projectSettings.value = initialSettings;

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

    await loadProjectSettings();

    // If no timelines are open, open the default one
    if (projectSettings.value.timelines.openPaths.length === 0) {
      const defaultTimeline = `${TIMELINES_DIR_NAME}/${name}_001.otio`;
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
    projectSettings,
    isLoadingProjectSettings,
    isSavingProjectSettings,
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
    deleteCurrentProject,
    ...editorViewModule,
  };
});
