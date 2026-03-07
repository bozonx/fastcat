<script setup lang="ts">
import { onMounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const workspaceStore = useWorkspaceStore();

onMounted(async () => {
  if (!workspaceStore.workspaceHandle) {
    await workspaceStore.init();
  }
});
</script>

<template>
  <div class="flex h-dvh w-full flex-col bg-slate-950 text-slate-200">
    <!-- Main Content Area -->
    <main class="flex-1 min-h-0 overflow-hidden relative">
      <slot />
    </main>
  </div>
</template>
