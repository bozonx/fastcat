<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { until } from '@vueuse/core';

const workspaceStore = useWorkspaceStore();
const { isMobile } = useDevice();
const router = useRouter();

onMounted(async () => {
  if (workspaceStore.isInitializing) {
    await until(() => !workspaceStore.isInitializing).toBeTruthy();
  }

  // Auto-open last project ONLY for Tauri Desktop app
  const isTauri = workspaceStore.workspaceProviderId === 'tauri';
  const shouldAutoOpen =
    isTauri &&
    workspaceStore.userSettings.openLastProjectOnStart &&
    Boolean(workspaceStore.lastProjectName);

  if (shouldAutoOpen) {
    const target = workspaceStore.lastProjectPath || workspaceStore.lastProjectName!;
    router.replace(`/editor/${encodeURIComponent(target)}`);
    return;
  }

  if (isMobile) {
    router.replace('/m');
  } else {
    router.replace('/projects');
  }
});
</script>

<template>
  <div class="flex h-screen w-full items-center justify-center bg-ui-bg">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
  </div>
</template>
