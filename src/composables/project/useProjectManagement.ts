import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';

export function useProjectManagement(options: { isMobile?: boolean } = {}) {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const router = useRouter();

  const searchQuery = ref('');
  const isRenaming = ref<string | null>(null);
  const renameValue = ref('');

  const isCreateModalOpen = ref(false);
  const projectCreationSettings = ref({
    name: '',
    width: workspaceStore.userSettings.projectDefaults.width,
    height: workspaceStore.userSettings.projectDefaults.height,
    fps: workspaceStore.userSettings.projectDefaults.fps,
    resolutionFormat: workspaceStore.userSettings.projectDefaults.resolutionFormat,
    orientation: workspaceStore.userSettings.projectDefaults.orientation,
    aspectRatio: workspaceStore.userSettings.projectDefaults.aspectRatio,
    isCustomResolution: workspaceStore.userSettings.projectDefaults.isCustomResolution,
    sampleRate: workspaceStore.userSettings.projectDefaults.sampleRate,
  });

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

    await projectStore.createProject(name, {
      width: projectCreationSettings.value.width,
      height: projectCreationSettings.value.height,
      fps: projectCreationSettings.value.fps,
      resolutionFormat: projectCreationSettings.value.resolutionFormat,
      orientation: projectCreationSettings.value.orientation,
      aspectRatio: projectCreationSettings.value.aspectRatio,
      isCustomResolution: projectCreationSettings.value.isCustomResolution,
      sampleRate: projectCreationSettings.value.sampleRate,
    });

    if (workspaceStore.userSettings.openLastProjectOnStart) {
      handleOpenProject(name);
    }

    isCreateModalOpen.value = false;
    projectCreationSettings.value.name = '';
  }

  function startCreateProject() {
    projectCreationSettings.value = {
      name: '',
      width: workspaceStore.userSettings.projectDefaults.width,
      height: workspaceStore.userSettings.projectDefaults.height,
      fps: workspaceStore.userSettings.projectDefaults.fps,
      resolutionFormat: workspaceStore.userSettings.projectDefaults.resolutionFormat,
      orientation: workspaceStore.userSettings.projectDefaults.orientation,
      aspectRatio: workspaceStore.userSettings.projectDefaults.aspectRatio,
      isCustomResolution: workspaceStore.userSettings.projectDefaults.isCustomResolution,
      sampleRate: workspaceStore.userSettings.projectDefaults.sampleRate,
    };
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

  async function renameProject(oldName: string) {
    if (!renameValue.value.trim() || renameValue.value === oldName) {
      isRenaming.value = null;
      return;
    }
    try {
      await workspaceStore.renameProject(oldName, renameValue.value.trim());
      isRenaming.value = null;
    } catch (e) {
      console.error('Failed to rename project', e);
    }
  }

  function startRename(project: string) {
    isRenaming.value = project;
    renameValue.value = project;
  }

  return {
    searchQuery,
    isRenaming,
    renameValue,
    isCreateModalOpen,
    projectCreationSettings,
    filteredProjects,
    createNewProject,
    startCreateProject,
    handleOpenProject,
    renameProject,
    startRename,
  };
}
