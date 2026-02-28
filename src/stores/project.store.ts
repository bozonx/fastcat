import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';

import { createTimelineDocId } from '~/timeline/id';
import type { TimelineDocument } from '~/timeline/types';
import { createDefaultTimelineDocument } from '~/timeline/otioSerializer';

import {
  createDefaultProjectSettings,
  normalizeProjectSettings,
  type GranVideoEditorProjectSettings,
} from '~/utils/project-settings';

import {
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  TIMELINES_DIR_NAME,
  EXPORT_DIR_NAME,
} from '~/utils/constants';

import {
  createProjectSettingsRepository,
  type ProjectSettingsRepository,
} from '~/repositories/project-settings.repository';

import {
  createProjectMetaRepository,
  type ProjectMetaRepository,
} from '~/repositories/project-meta.repository';

import { useWorkspaceStore } from './workspace.store';

function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export const useProjectStore = defineStore('project', () => {
  const workspaceStore = useWorkspaceStore();

  function getErrorMessage(e: unknown, fallback: string): string {
    if (!e || typeof e !== 'object') return fallback;
    if (!('message' in e)) return fallback;
    const msg = (e as { message?: unknown }).message;
    return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
  }

  const projectSettingsRepo = ref<ProjectSettingsRepository | null>(null);
  const projectMetaRepo = ref<ProjectMetaRepository | null>(null);

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
    isSavingProjectSettings.value = false;
    projectSettingsRepo.value = null;
    projectMetaRepo.value = null;

    projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
    projectSettingsRevision = 0;
    savedProjectSettingsRevision = 0;
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
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        console.error('Failed to get project file handle by path:', input.relativePath, e);
      }
      return null;
    }
  }

  async function getFileHandleByPath(path: string): Promise<FileSystemFileHandle | null> {
    return await getProjectFileHandleByRelativePath({ relativePath: path, create: false });
  }

  async function getProjectDirHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!workspaceStore.projectsHandle || !currentProjectName.value) return null;
    try {
      return await workspaceStore.projectsHandle.getDirectoryHandle(currentProjectName.value);
    } catch {
      return null;
    }
  }

  async function loadProjectMeta() {
    if (!workspaceStore.projectsHandle || !currentProjectName.value) return;

    try {
      if (!projectMetaRepo.value) {
        const dir = await getProjectDirHandle();
        projectMetaRepo.value = dir ? createProjectMetaRepository({ projectDir: dir }) : null;
      }

      const meta = await projectMetaRepo.value?.load();
      if (meta?.id) {
        currentProjectId.value = meta.id;
        return;
      }
    } catch {
      // ignore
    }

    const nextId = createProjectId();
    currentProjectId.value = nextId;

    try {
      if (!projectMetaRepo.value) {
        const dir = await getProjectDirHandle();
        projectMetaRepo.value = dir ? createProjectMetaRepository({ projectDir: dir }) : null;
      }

      await projectMetaRepo.value?.save({ id: nextId });
    } catch (e) {
      console.warn('Failed to write project meta file', e);
    }
  }

  async function loadProjectSettings() {
    isLoadingProjectSettings.value = true;

    const dir = await getProjectDirHandle();
    projectSettingsRepo.value = dir ? createProjectSettingsRepository({ projectDir: dir }) : null;

    try {
      if (!projectSettingsRepo.value) {
        projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
        return;
      }

      const raw = await projectSettingsRepo.value.load();
      projectSettings.value = normalizeProjectSettings(raw, workspaceStore.userSettings);
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name === 'NotFoundError') {
        projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
        return;
      }

      console.warn('Failed to load project settings, fallback to defaults', e);
      projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
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
      if (!projectSettingsRepo.value) {
        const dir = await getProjectDirHandle();
        projectSettingsRepo.value = dir
          ? createProjectSettingsRepository({ projectDir: dir })
          : null;
      }

      if (!projectSettingsRepo.value) return;

      await projectSettingsRepo.value.save(projectSettings.value);

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
      await projectDir.getDirectoryHandle(VIDEO_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(AUDIO_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(IMAGES_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(TIMELINES_DIR_NAME, { create: true });
      await projectDir.getDirectoryHandle(EXPORT_DIR_NAME, { create: true });

      try {
        await projectDir.getDirectoryHandle('.gran', { create: true });
        try {
          const id = createProjectId();
          projectMetaRepo.value = createProjectMetaRepository({ projectDir });
          await projectMetaRepo.value.save({ id });
        } catch (e) {
          console.warn('Failed to create project meta file', e);
        }

        projectSettingsRepo.value = createProjectSettingsRepository({ projectDir });

        const initial = createDefaultProjectSettings(workspaceStore.userSettings);
        projectSettings.value = initial;

        await projectSettingsRepo.value.save(projectSettings.value);
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
  };
});
