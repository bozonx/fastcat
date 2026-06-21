import { createDevLogger } from '~/utils/dev-logger';
import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
const log = createDevLogger('useProjectManagement');

interface ProjectActionTarget {
  projectName: string;
  projectId?: string;
  projectPath?: string;
}

function createProjectCreationState(workspaceStore: ReturnType<typeof useWorkspaceStore>) {
  return {
    name: '',
    width: 1920,
    height: 1080,
    fps: 30,
    resolutionFormat: '1080p',
    orientation: 'landscape' as const,
    aspectRatio: '16:9',
    isCustomResolution: false,
    sampleRate: 48000,
    isAdvancedSettingsOpen: false,
    location: workspaceStore.resolvedStorageTopology.projectsRoot,
  };
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

  const isDuplicateModalOpen = ref(false);
  const duplicateValue = ref('');
  const duplicateTargetProject = ref<ProjectActionTarget | null>(null);

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

  function startDuplicate(project: ProjectActionTarget | string) {
    duplicateTargetProject.value =
      typeof project === 'string' ? { projectName: project } : { ...project };
    duplicateValue.value = duplicateTargetProject.value.projectName;
    isDuplicateModalOpen.value = true;
  }

  async function confirmDuplicate() {
    const target = duplicateTargetProject.value;
    if (!target || !duplicateValue.value.trim()) {
      closeDuplicateModal();
      return;
    }
    try {
      await workspaceStore.duplicateProject({
        sourceName: target.projectName,
        targetName: duplicateValue.value.trim(),
        sourceProjectId: target.projectId,
        sourceProjectPath: target.projectPath,
      });
      closeDuplicateModal();
    } catch (e) {
      log.error('Failed to duplicate project', e);
    }
  }

  function closeDuplicateModal() {
    isDuplicateModalOpen.value = false;
    duplicateTargetProject.value = null;
    duplicateValue.value = '';
  }

  async function selectProjectLocation() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: projectCreationSettings.value.location,
    });
    if (selected && typeof selected === 'string') {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('allow_path_scope', { path: selected }).catch(() => {});
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
    isDuplicateModalOpen,
    duplicateValue,
    duplicateTargetProject,
    createNewProject,
    startCreateProject,
    handleOpenProject,
    renameProject,
    startRename,
    closeRenameModal,
    startDelete,
    confirmDelete,
    closeDeleteModal,
    startDuplicate,
    confirmDuplicate,
    closeDuplicateModal,
    selectProjectLocation,
    openProjectFromDisk,
  };
}

const pendingFilesForNewProject = ref<File[]>([]);

export function usePendingNewProjectFiles() {
  return {
    pendingFilesForNewProject,
  };
}
