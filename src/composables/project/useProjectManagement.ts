import { createDevLogger } from '~/utils/dev-logger';
import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { isValidFsEntryName } from '~/file-manager/core/rules';
const log = createDevLogger('useProjectManagement');

const I18N_KEYS = {
  nameRequired: 'fastcat.projects.nameRequired',
  nameInvalid: 'fastcat.projects.nameInvalid',
  nameAlreadyExists: 'fastcat.projects.nameAlreadyExists',
  nameSameAsCurrent: 'fastcat.projects.nameSameAsCurrent',
  nameSameAsSource: 'fastcat.projects.nameSameAsSource',
} as const;

type ValidationErrorKey = (typeof I18N_KEYS)[keyof typeof I18N_KEYS];

function getProjectNameValidationError(name: string): ValidationErrorKey | null {
  const trimmed = name.trim();
  if (!trimmed) return I18N_KEYS.nameRequired;
  if (!isValidFsEntryName(trimmed)) return I18N_KEYS.nameInvalid;
  return null;
}

export interface ProjectActionTarget {
  projectName: string;
  projectId?: string;
  projectPath?: string;
}

function createProjectCreationState(workspaceStore: ReturnType<typeof useWorkspaceStore>) {
  return {
    name: '',
    width: 1920,
    height: 1080,
    fps: 25,
    resolutionFormat: '1080p',
    orientation: 'landscape' as const,
    aspectRatio: '16:9',
    isCustomResolution: false,
    sampleRate: 48000,
    // Explicit opt-in: when unchecked, the project stays in "auto" mode and its
    // resolution/fps/sample rate are detected from the first dropped clips.
    specifyProjectSettings: false,
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

  const isForgetModalOpen = ref(false);
  const forgetTargetProject = ref<ProjectActionTarget | null>(null);

  const isDuplicateModalOpen = ref(false);
  const duplicateValue = ref('');
  const duplicateTargetProject = ref<ProjectActionTarget | null>(null);
  const duplicateLocation = ref('');

  const filteredProjects = computed(() => {
    if (!searchQuery.value.trim()) {
      return workspaceStore.projects;
    }
    const query = searchQuery.value.toLowerCase();
    return workspaceStore.projects.filter((p) => p.toLowerCase().includes(query));
  });

  function isProjectNameExists(name: string, excludeName?: string): boolean {
    if (excludeName && name === excludeName) return false;
    return (
      workspaceStore.projects.includes(name) ||
      workspaceStore.recentProjects.some((p) => p.projectName === name)
    );
  }

  const createError = computed<ValidationErrorKey | null>(() => {
    const name = projectCreationSettings.value.name;
    const validationError = getProjectNameValidationError(name);
    if (validationError) return validationError;
    if (isProjectNameExists(name.trim())) return I18N_KEYS.nameAlreadyExists;
    return null;
  });

  const isCreateNameValid = computed(() => !createError.value);

  const renameError = computed<ValidationErrorKey | null>(() => {
    const name = renameValue.value;
    const target = renameTargetProject.value;
    const validationError = getProjectNameValidationError(name);
    if (validationError) return validationError;
    if (target && name.trim() === target.projectName.trim()) return I18N_KEYS.nameSameAsCurrent;
    if (target && isProjectNameExists(name.trim(), target.projectName.trim())) {
      return I18N_KEYS.nameAlreadyExists;
    }
    return null;
  });

  const isRenameNameValid = computed(() => !renameError.value);

  const duplicateError = computed<ValidationErrorKey | null>(() => {
    const name = duplicateValue.value;
    const target = duplicateTargetProject.value;
    const validationError = getProjectNameValidationError(name);
    if (validationError) return validationError;
    if (target && name.trim() === target.projectName.trim()) return I18N_KEYS.nameSameAsSource;
    if (isProjectNameExists(name.trim())) return I18N_KEYS.nameAlreadyExists;
    return null;
  });

  const isDuplicateNameValid = computed(() => !duplicateError.value);

  async function createNewProject() {
    const name = projectCreationSettings.value.name.trim();
    if (!isCreateNameValid.value) return;

    const parentPath =
      workspaceStore.workspaceProviderId === 'tauri'
        ? projectCreationSettings.value.location
        : undefined;

    // Only pass format options when the user explicitly opted in. Otherwise omit
    // them entirely so the project is created in "auto" mode and detects its
    // format from the first dropped clip (createProject treats any provided
    // option as a manual configuration).
    const options = projectCreationSettings.value.specifyProjectSettings
      ? {
          width: projectCreationSettings.value.width,
          height: projectCreationSettings.value.height,
          fps: projectCreationSettings.value.fps,
          resolutionFormat: projectCreationSettings.value.resolutionFormat,
          orientation: projectCreationSettings.value.orientation,
          aspectRatio: projectCreationSettings.value.aspectRatio,
          isCustomResolution: projectCreationSettings.value.isCustomResolution,
          sampleRate: projectCreationSettings.value.sampleRate,
          parentPath,
        }
      : { parentPath };

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
    if (!oldName || !isRenameNameValid.value) {
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

  function startForget(project: ProjectActionTarget | string) {
    forgetTargetProject.value =
      typeof project === 'string' ? { projectName: project } : { ...project };
    isForgetModalOpen.value = true;
  }

  async function confirmForget() {
    const target = forgetTargetProject.value;
    if (!target) return;
    try {
      await workspaceStore.forgetProject({
        name: target.projectName,
        projectId: target.projectId,
        projectPath: target.projectPath,
      });
    } catch (e) {
      log.error('Failed to forget project', e);
    } finally {
      closeForgetModal();
    }
  }

  function closeForgetModal() {
    isForgetModalOpen.value = false;
    forgetTargetProject.value = null;
  }

  function isExternalProject(projectPath?: string): boolean {
    if (!projectPath) return false;
    const root = workspaceStore.resolvedStorageTopology.projectsRoot;
    if (!root) return false;

    const normPath = projectPath.replace(/\\/g, '/').replace(/\/$/, '');
    const normRoot = root.replace(/\\/g, '/').replace(/\/$/, '');

    return normPath !== normRoot && !normPath.startsWith(normRoot + '/');
  }

  function startDuplicate(project: ProjectActionTarget | string) {
    duplicateTargetProject.value =
      typeof project === 'string' ? { projectName: project } : { ...project };
    duplicateValue.value = duplicateTargetProject.value.projectName;
    // Default duplicate location to the source project's parent directory.
    duplicateLocation.value =
      duplicateTargetProject.value.projectPath
        ? duplicateTargetProject.value.projectPath.replace(/[\\/][^\\/]+$/, '')
        : workspaceStore.resolvedStorageTopology.projectsRoot;
    isDuplicateModalOpen.value = true;
  }

  async function confirmDuplicate() {
    const target = duplicateTargetProject.value;
    if (!target || !isDuplicateNameValid.value) {
      return;
    }
    try {
      await workspaceStore.duplicateProject({
        sourceName: target.projectName,
        targetName: duplicateValue.value.trim(),
        sourceProjectId: target.projectId,
        sourceProjectPath: target.projectPath,
        targetParentPath:
          workspaceStore.workspaceProviderId === 'tauri'
            ? duplicateLocation.value || undefined
            : undefined,
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
    duplicateLocation.value = '';
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

  async function selectDuplicateLocation() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: duplicateLocation.value || undefined,
    });
    if (selected && typeof selected === 'string') {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('allow_path_scope', { path: selected }).catch(() => {});
      duplicateLocation.value = selected;
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
    isForgetModalOpen,
    forgetTargetProject,
    isDuplicateModalOpen,
    duplicateValue,
    duplicateTargetProject,
    duplicateLocation,
    createError,
    isCreateNameValid,
    renameError,
    isRenameNameValid,
    duplicateError,
    isDuplicateNameValid,
    createNewProject,
    startCreateProject,
    handleOpenProject,
    renameProject,
    startRename,
    closeRenameModal,
    startDelete,
    confirmDelete,
    closeDeleteModal,
    startForget,
    confirmForget,
    closeForgetModal,
    isExternalProject,
    startDuplicate,
    confirmDuplicate,
    closeDuplicateModal,
    selectProjectLocation,
    selectDuplicateLocation,
    openProjectFromDisk,
  };
}

const pendingFilesForNewProject = ref<File[]>([]);

export function usePendingNewProjectFiles() {
  return {
    pendingFilesForNewProject,
  };
}
