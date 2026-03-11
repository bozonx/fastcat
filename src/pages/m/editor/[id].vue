<script setup lang="ts">
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { watch, onMounted } from 'vue';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useRoute, useRouter } from 'vue-router';

import MobileFileBrowser from '~/components/file-manager/MobileFileBrowser.vue';
import MobileExportForm from '~/components/export/MobileExportForm.vue';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';

definePageMeta({
  layout: 'mobile',
});

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const { openProject } = useProjectActions();

onMounted(() => {
  const projectId = route.params.id as string;
  if (!projectId) {
    router.push('/m');
    return;
  }

  const initProject = () => {
    if (!workspaceStore.workspaceHandle) {
      router.push('/m');
      return;
    }
    openProject(decodeURIComponent(projectId));
  };

  if (workspaceStore.isInitializing) {
    const unwatch = watch(() => workspaceStore.isInitializing, (isInit) => {
      if (!isInit) {
        unwatch();
        initProject();
      }
    });
  } else {
    initProject();
  }
});
const { leaveProject } = useProjectActions();

type TabId = 'files' | 'edit' | 'sound' | 'export';

const activeTab = ref<TabId>('edit');

const navItems = [
  { id: 'files' as const, icon: 'lucide:file-video', label: 'Files' },
  { id: 'edit' as const, icon: 'lucide:film', label: 'Edit' },
  { id: 'sound' as const, icon: 'lucide:music', label: 'Sound' },
  { id: 'export' as const, icon: 'lucide:download', label: 'Export' },
];

async function handleBack() {
  await leaveProject('/m');
}
</script>

<template>
  <div class="flex flex-col h-full w-full">
    <!-- Header -->
    <header
      class="shrink-0 flex items-center justify-between h-12 px-4 border-b border-slate-800 bg-slate-900"
    >
      <div class="flex items-center gap-2">
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="lucide:arrow-left"
          @click="handleBack"
        />
        <span class="font-medium text-sm">{{ projectStore.currentProjectName }}</span>
      </div>
    </header>

    <!-- Main Content Area (Virtual Tabs) -->
    <main class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative">
      <div v-show="activeTab === 'files'" class="h-full">
        <MobileFileBrowser />
      </div>

      <div v-show="activeTab === 'edit'" class="flex flex-col h-full overflow-hidden bg-slate-950">
        <MobileMonitorContainer />
        <MobileTimeline />
      </div>

      <div v-show="activeTab === 'sound'" class="p-4 h-full">
        <h2 class="text-xl font-bold mb-4">Sound</h2>
        <div class="text-slate-400">Mobile audio editor will be here.</div>
      </div>

      <div v-show="activeTab === 'export'" class="h-full">
        <MobileExportForm />
      </div>
    </main>

    <!-- Bottom Navigation Bar -->
    <nav class="shrink-0 border-t border-slate-800 bg-slate-900 pb-safe">
      <div class="flex h-16 items-center justify-around px-2">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="flex flex-col items-center justify-center w-16 h-full gap-1 transition-colors outline-none"
          :class="activeTab === item.id ? 'text-blue-500' : 'text-slate-400 hover:text-slate-300'"
          @click="activeTab = item.id"
        >
          <Icon :name="item.icon" class="w-6 h-6" />
          <span class="text-[10px] font-medium">{{ item.label }}</span>
        </button>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
