import { createDevLogger } from '~/utils/dev-logger';
import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { resolveLastUsedProjectPreset } from '~/utils/settings';
const log = createDevLogger('useProjectManagement');

interface ProjectActionTarget {
  projectName: string;
  projectId?: string;
  projectPath?: string;
}

function createProjectCreationState(workspaceStore: ReturnType<typeof useWorkspaceStore>) {
  const preset = resolveLastUsedProjectPreset(workspaceStore.userSettings.projectPresets);

  return {
    name: '',
    presetId: preset.id,
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    resolutionFormat: preset.resolutionFormat,
    orientation: preset.orientation,
    aspectRatio: preset.aspectRatio,
    isCustomResolution: preset.isCustomResolution,
    sampleRate: preset.sampleRate,
    isAdvancedSettingsOpen: false,
    location: workspaceStore.resolvedStorageTopology.projectsRoot,
  };
}

function applyProjectCreationPresetById(
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
  projectCreationSettings: {
    name: string;
    presetId: string;
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    sampleRate: number;
  },
  presetId: string,
) {
  const preset =
    workspaceStore.userSettings.projectPresets.items.find((item) => item.id === presetId) ??
    resolveLastUsedProjectPreset(workspaceStore.userSettings.projectPresets);

  projectCreationSettings.presetId = preset.id;
  projectCreationSettings.width = preset.width;
  projectCreationSettings.height = preset.height;
  projectCreationSettings.fps = preset.fps;
  projectCreationSettings.resolutionFormat = preset.resolutionFormat;
  projectCreationSettings.orientation = preset.orientation;
  projectCreationSettings.aspectRatio = preset.aspectRatio;
  projectCreationSettings.isCustomResolution = preset.isCustomResolution;
  projectCreationSettings.sampleRate = preset.sampleRate;
}

export function useProjectManagement(options: { isMobile?: boolean } = {}) {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const router = useRouter();

  const searchQuery = ref('');
  const renameValue = ref('');

  const isCreateModalOpen = ref(false);
  const projectCreationSettings = ref(createProjectCreationState(workspaceStore));

  const isRenameModalOpen = ref(false);
  const renameTargetProject = ref<ProjectActionTarget | null>(null);

  const isDeleteModalOpen = ref(false);
  const deleteTargetProject = ref<ProjectActionTarget | null>(null);

  const filteredProjects = computed(() => {
    if (!searchQuery.value.trim()) {
      return workspaceStore.projects;
    }
    const query = searchQuery.value.toLowerCase();
    return workspaceStore.projects.filter((p) => p.toLowerCase().includes(query));
  });

  async function createNewProject() {
    const name = projectCreationSettings.value.name.trim();
    if (!name) return;

    const options = {
      presetId: projectCreationSettings.value.presetId,
      width: projectCreationSettings.value.width,
      height: projectCreationSettings.value.height,
      fps: projectCreationSettings.value.fps,
      resolutionFormat: projectCreationSettings.value.resolutionFormat,
      orientation: projectCreationSettings.value.orientation,
      aspectRatio: projectCreationSettings.value.aspectRatio,
      isCustomResolution: projectCreationSettings.value.isCustomResolution,
      sampleRate: projectCreationSettings.value.sampleRate,
      parentPath:
        workspaceStore.workspaceProviderId === 'tauri'
          ? projectCreationSettings.value.location
          : undefined,
    };

    await projectStore.createProject(name, options);

    if (workspaceStore.error) {
      return;
    }

    if (options.presetId) {
      workspaceStore.userSettings.projectPresets.lastUsedPresetId = options.presetId;
    }

    if (workspaceStore.userSettings.openLastProjectOnStart) {
      if (workspaceStore.workspaceProviderId === 'tauri' && options.parentPath) {
        const { join } = await import('@tauri-apps/api/path');
        handleOpenProject(await join(options.parentPath, name));
      } else {
        handleOpenProject(name);
      }
    }

    isCreateModalOpen.value = false;
    projectCreationSettings.value = createProjectCreationState(workspaceStore);
  }

  function startCreateProject() {
    projectCreationSettings.value = createProjectCreationState(workspaceStore);
    isCreateModalOpen.value = true;
  }

  function applyProjectCreationPreset(presetId: string) {
    applyProjectCreationPresetById(workspaceStore, projectCreationSettings.value, presetId);
  }

  function handleOpenProject(project: string) {
    projectStore.goToCut();
    const basePath = options.isMobile ? '/m/editor' : '/editor';
    const url = `${basePath}/${encodeURIComponent(project)}`;
    if (options.isMobile) {
      router.push(url);
    } else {
      navigateTo(url);
    }
  }

  async function renameProject() {
    const oldName = renameTargetProject.value;
    if (!oldName || !renameValue.value.trim() || renameValue.value === oldName.projectName) {
      closeRenameModal();
      return;
    }
    try {
      await workspaceStore.renameProject({
        oldName: oldName.projectName,
        newName: renameValue.value.trim(),
        projectId: oldName.projectId,
        projectPath: oldName.projectPath,
      });
      closeRenameModal();
    } catch (e) {
      log.error('Failed to rename project', e);
    }
  }

  function startRename(project: ProjectActionTarget | string) {
    renameTargetProject.value =
      typeof project === 'string' ? { projectName: project } : { ...project };
    renameValue.value = renameTargetProject.value.projectName;
    isRenameModalOpen.value = true;
  }

  function closeRenameModal() {
    isRenameModalOpen.value = false;
    renameTargetProject.value = null;
    renameValue.value = '';
  }

  function startDelete(project: ProjectActionTarget | string) {
    deleteTargetProject.value =
      typeof project === 'string' ? { projectName: project } : { ...project };
    isDeleteModalOpen.value = true;
  }

  async function confirmDelete() {
    const target = deleteTargetProject.value;
    if (!target) return;
    try {
      await workspaceStore.deleteProject({
        name: target.projectName,
        projectId: target.projectId,
        projectPath: target.projectPath,
      });
    } catch (e) {
      log.error('Failed to delete project', e);
    } finally {
      closeDeleteModal();
    }
  }

  function closeDeleteModal() {
    isDeleteModalOpen.value = false;
    deleteTargetProject.value = null;
  }

  async function selectProjectLocation() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: projectCreationSettings.value.location,
    });
    if (selected && typeof selected === 'string') {
      projectCreationSettings.value.location = selected;
    }
  }

  async function openProjectFromDisk() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected && typeof selected === 'string') {
      handleOpenProject(selected);
    }
  }

  return {
    searchQuery,
    renameValue,
    isCreateModalOpen,
    projectCreationSettings,
    filteredProjects,
    isRenameModalOpen,
    renameTargetProject,
    isDeleteModalOpen,
    deleteTargetProject,
    createNewProject,
    startCreateProject,
    applyProjectCreationPreset,
    handleOpenProject,
    renameProject,
    startRename,
    closeRenameModal,
    startDelete,
    confirmDelete,
    closeDeleteModal,
    selectProjectLocation,
    openProjectFromDisk,
  };
}
