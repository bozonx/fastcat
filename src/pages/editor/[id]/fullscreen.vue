<script setup lang="ts">
import { until } from '@vueuse/core';
import { onMounted, ref } from 'vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

definePageMeta({
  layout: 'blank',
});

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const { openProject } = useProjectActions();
const isReady = ref(false);

onMounted(async () => {
  const projectId = route.params.id as string;
  if (!projectId) {
    await router.push('/');
    return;
  }

  if (workspaceStore.isInitializing) {
    await until(() => workspaceStore.isInitializing).toBe(false);
  }

  if (!workspaceStore.workspaceHandle) {
    await router.push('/');
    return;
  }

  const decodedProjectId = decodeURIComponent(projectId);
  if (projectStore.currentProjectName !== decodedProjectId) {
    await openProject(decodedProjectId);
  }

  projectStore.goToFullscreen();
  isReady.value = true;
});
</script>

<template>
  <ClientOnly>
    <MonitorContainer v-if="isReady" is-fullscreen class="h-full w-full" />
  </ClientOnly>
</template>
