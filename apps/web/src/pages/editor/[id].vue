<script setup lang="ts">
import { until } from '@vueuse/core';
import DesktopShell from '~/components/editor/DesktopShell.vue';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const { openProject } = useProjectActions();

onMounted(async () => {
  const projectId = route.params.id as string;
  if (!projectId) {
    router.push('/');
    return;
  }

  if (workspaceStore.isInitializing) {
    await until(() => workspaceStore.isInitializing).toBe(false);
  }

  const isTauri = workspaceStore.workspaceProviderId === 'tauri';
  if (!isTauri && !workspaceStore.workspaceHandle) {
    router.push('/');
    return;
  }

  try {
    await openProject(decodeURIComponent(projectId));
    if (!projectStore.currentProjectName) {
      if (route.path.startsWith('/editor/')) {
        router.push('/');
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to open project:', err);
    if (route.path.startsWith('/editor/')) {
      router.push('/');
    }
  }
});
</script>

<template>
  <DesktopShell />
</template>
