import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';

export function useProjectManagement(options: { isMobile?: boolean } = {}) {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const router = useRouter();

  const searchQuery = ref('');
  const newProjectName = ref('');
  const isRenaming = ref<string | null>(null);
  const renameValue = ref('');

  const filteredProjects = computed(() => {
    if (!searchQuery.value.trim()) {
      return workspaceStore.projects;
    }
    const query = searchQuery.value.toLowerCase();
    return workspaceStore.projects.filter((p) => p.toLowerCase().includes(query));
  });

  async function createNewProject() {
    if (!newProjectName.value.trim()) return;
    const name = newProjectName.value.trim();
    await projectStore.createProject(name);
    if (workspaceStore.userSettings.openLastProjectOnStart) {
      handleOpenProject(name);
    }
    newProjectName.value = '';
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
    newProjectName,
    isRenaming,
    renameValue,
    filteredProjects,
    createNewProject,
    handleOpenProject,
    renameProject,
    startRename,
  };
}
