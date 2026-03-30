<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useUiStore } from '~/stores/ui.store';

import MobileFileBrowser from '~/components/file-manager/MobileFileBrowser.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';
import MobileSettingsView from '~/components/settings/MobileSettingsView.vue';

import { useFileManagerStore } from '~/stores/file-manager.store';
import { until } from '@vueuse/core';

definePageMeta({
  layout: 'mobile',
});

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUiStore();
const route = useRoute();
const router = useRouter();
const { openProject, leaveProject } = useProjectActions();
const isOpeningProject = ref(true);
const projectOpenError = ref<string | null>(null);

const tabToViewMap = {
  files: 'files',
  edit: 'cut',
  export: 'export',
  settings: 'settings',
} as const;

const viewToTabMap: Record<string, 'files' | 'edit' | 'export' | 'settings'> = {
  files: 'files',
  cut: 'edit',
  sound: 'edit',
  export: 'export',
  settings: 'settings',
  fullscreen: 'edit',
};

onMounted(async () => {
  const projectId = route.params.id as string;
  if (!projectId) {
    router.push('/m');
    return;
  }

  isOpeningProject.value = true;
  projectOpenError.value = null;

  if (workspaceStore.isInitializing) {
    await until(() => workspaceStore.isInitializing).toBe(false);
  }

  if (!workspaceStore.workspaceHandle) {
    router.push('/m');
    return;
  }

  try {
    await openProject(decodeURIComponent(projectId));
    if (!projectStore.currentProjectName) {
      throw new Error('Project failed to open');
    }
  } catch (error: unknown) {
    projectOpenError.value = error instanceof Error ? error.message : 'Failed to open the project';
  } finally {
    isOpeningProject.value = false;
  }
});

type TabId = 'files' | 'edit' | 'export' | 'settings';

const activeTab = computed<TabId>({
  get: () => (viewToTabMap[projectStore.currentView as string] ?? 'edit') as TabId,
  set: (tab: TabId) => {
    projectStore.setView(tabToViewMap[tab] as any);
  },
});

const currentViewLabel = computed(() => {
  if (activeTab.value === 'files') return 'Project files';
  if (activeTab.value === 'export') return 'Export';
  return 'Edit timeline';
});

const navItems = computed(() => [
  { id: 'home', label: t('common.toHome'), icon: 'lucide:home', action: handleBack },
  { id: 'files', label: t('common.files'), icon: 'lucide:folder-open' },
  { id: 'edit', label: t('common.edit'), icon: 'lucide:clapperboard' },
  { id: 'export', label: t('common.export'), icon: 'lucide:download' },
  { id: 'settings', label: t('common.settings'), icon: 'lucide:settings' },
]);

const fileManagerStore = useFileManagerStore();

function handleTabClick(tabId: TabId) {
  if (activeTab.value === tabId && tabId === 'files') {
    fileManagerStore.selectedFolder = null;
  } else {
    activeTab.value = tabId;
  }
}

const showBottomNav = computed(() => !isOpeningProject.value && !projectOpenError.value);

async function handleBack() {
  await leaveProject('/m');
}


</script>

<template>
  <div class="flex h-full w-full flex-col">

    <!-- Main Content Area (Virtual Tabs) -->
    <main class="relative flex-1 min-h-0 overflow-hidden bg-slate-950">
      <div
        v-if="isOpeningProject"
        class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-slate-400"
      >
        <Icon name="lucide:loader-circle" class="h-8 w-8 animate-spin text-primary-400" />
        <div>
          <p class="text-sm font-medium text-slate-100">Opening project</p>
          <p class="text-xs text-slate-500">Preparing timeline, media, and mobile workspace</p>
        </div>
      </div>

      <div
        v-else-if="projectOpenError"
        class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div class="max-w-sm rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-200">
          <p class="text-sm font-semibold">Failed to open project</p>
          <p class="mt-2 text-xs text-red-200/80">{{ projectOpenError }}</p>
        </div>
        <UButton
          color="neutral"
          variant="soft"
          icon="lucide:arrow-left"
          label="Back"
          @click="handleBack"
        />
      </div>

      <div v-else-if="activeTab === 'files'" class="h-full">
        <MobileFileBrowser />
      </div>

      <div
        v-else-if="activeTab === 'edit'"
        class="flex h-full flex-col overflow-hidden bg-slate-950 landscape:flex-row"
      >
        <MobileMonitorContainer
          mode="edit"
          class="order-1 landscape:order-2 landscape:w-[42%] landscape:border-l landscape:border-slate-800 landscape:h-full! landscape:max-h-none!"
        />
        <MobileTimeline class="flex-1 order-2 landscape:order-1" />
      </div>



      <div v-else-if="activeTab === 'export'" class="h-full">
        <ExportForm />
      </div>

      <div v-else class="h-full">
        <MobileSettingsView />
      </div>
    </main>

    <!-- Bottom Navigation Bar -->
    <nav
      v-if="showBottomNav"
      class="shrink-0 border-t border-slate-800 bg-slate-950/95 pb-safe backdrop-blur"
    >
      <div class="grid h-16 grid-cols-5 items-center gap-1 px-1">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors outline-none"
          :class="
            (activeTab === item.id && !('action' in item))
              ? 'bg-primary-500/12 text-primary-400'
              : 'text-slate-400 active:bg-slate-900'
          "
          :aria-pressed="activeTab === item.id && !('action' in item)"
          @click="'action' in item ? (item as any).action() : handleTabClick(item.id as any)"
        >
          <Icon :name="item.icon" class="w-6 h-6 shrink-0" />
          <span class="text-[10px] font-medium truncate w-full px-0.5">{{ item.label }}</span>
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
