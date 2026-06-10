<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import ProjectReadOnlyBanner from '~/components/editor/ProjectReadOnlyBanner.vue';
import FileConversionModal from '~/components/file-manager/FileConversionModal.vue';

const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const route = useRoute();

const showReadOnlyBanner = computed(() =>
  route.path.startsWith('/m/editor') &&
  projectStore.isReadOnly &&
  !!projectStore.currentProjectName,
);

useHead({
  htmlAttrs: { class: 'is-mobile-layout' },
  bodyAttrs: { class: 'is-mobile-layout' },
});

onMounted(async () => {
  if (!workspaceStore.workspaceHandle) {
    await workspaceStore.init();
  }
});
</script>

<template>
  <div class="mobile-app-container flex h-dvh w-full flex-col bg-zinc-950 text-zinc-200">
    <ProjectReadOnlyBanner v-if="showReadOnlyBanner" />
    <!-- Main Content Area -->
    <main class="flex-1 min-h-0 overflow-y-auto relative">
      <slot />
    </main>

    <FileConversionModal />
  </div>
</template>
