<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useUiStore } from '~/stores/ui.store';

import MobileFileBrowser from '~/components/file-manager/MobileFileBrowser.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';
import MobileAudioMixer from '~/components/audio/MobileAudioMixer.vue';
import ProjectSettingsModal from '~/components/project-settings/ProjectSettingsModal.vue';
import EditorSettingsModal from '~/components/settings/EditorSettingsModal.vue';

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
  sound: 'sound',
  export: 'export',
} as const;

const viewToTabMap = {
  files: 'files',
  cut: 'edit',
  sound: 'sound',
  export: 'export',
  fullscreen: 'edit',
} as const;

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

type TabId = 'files' | 'edit' | 'sound' | 'export';

const activeTab = computed<TabId>({
  get: () => viewToTabMap[projectStore.currentView],
  set: (tab) => {
    projectStore.setView(tabToViewMap[tab]);
  },
});

const currentViewLabel = computed(() => {
  if (activeTab.value === 'files') return 'Project files';
  if (activeTab.value === 'sound') return 'Sound mix';
  if (activeTab.value === 'export') return 'Export';
  return 'Edit timeline';
});

const navItems: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'files', label: t('common.files', 'Files'), icon: 'lucide:folder-open' },
  { id: 'edit', label: t('common.edit', 'Edit'), icon: 'lucide:clapperboard' },
  { id: 'sound', label: t('common.sound', 'Sound'), icon: 'lucide:sliders-horizontal' },
  { id: 'export', label: t('common.export', 'Export'), icon: 'lucide:download' },
];

const showBottomNav = computed(() => !isOpeningProject.value && !projectOpenError.value);

async function handleBack() {
  await leaveProject('/m');
}

const isAppSettingsOpen = ref(false);

const topbarMenuItems = computed(() => [
  [
    {
      label: t('videoEditor.projectSettings.title', 'Project Settings'),
      icon: 'lucide:settings',
      onSelect: () => {
        uiStore.isProjectSettingsOpen = true;
      },
    },
    {
      label: t('common.settings', 'App Settings'),
      icon: 'lucide:sliders',
      onSelect: () => {
        isAppSettingsOpen.value = true;
      },
    },
  ],
]);
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- Header -->
    <header
      class="shrink-0 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur"
    >
      <div class="flex min-w-0 items-center gap-4">
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="lucide:home"
          aria-label="Back to projects"
          @click="handleBack"
        />
        <div class="flex min-w-0 items-center gap-2">
          <p class="truncate text-base font-semibold text-white">
            {{ projectStore.currentProjectName || 'Opening project' }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <div
          v-if="projectStore.isReadOnly"
          class="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-2xs font-medium text-amber-300"
        >
          Read only
        </div>
        <UDropdownMenu :items="topbarMenuItems" :content="{ align: 'end' }" :ui="{ content: 'w-48' }">
          <UButton icon="lucide:more-vertical" variant="ghost" color="neutral" size="sm" />
        </UDropdownMenu>
      </div>
    </header>

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

      <div
        v-else-if="activeTab === 'sound'"
        class="flex h-full flex-col overflow-hidden bg-slate-950 landscape:flex-row"
      >
        <MobileMonitorContainer
          mode="sound"
          class="order-1 landscape:order-2 landscape:w-[42%] landscape:border-l landscape:border-slate-800 landscape:h-full! landscape:max-h-none!"
        />
        <MobileAudioMixer class="flex-1 order-2 landscape:order-1" />
      </div>

      <div v-else class="h-full">
        <ExportForm />
      </div>
    </main>

    <!-- Bottom Navigation Bar -->
    <nav
      v-if="showBottomNav"
      class="shrink-0 border-t border-slate-800 bg-slate-950/95 pb-safe backdrop-blur"
    >
      <div class="grid h-16 grid-cols-4 items-center gap-1 px-2">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors outline-none"
          :class="
            activeTab === item.id
              ? 'bg-primary-500/12 text-primary-400'
              : 'text-slate-400 active:bg-slate-900'
          "
          :aria-pressed="activeTab === item.id"
          @click="activeTab = item.id"
        >
          <Icon :name="item.icon" class="w-6 h-6" />
          <span class="text-2xs font-medium">{{ item.label }}</span>
        </button>
      </div>
    </nav>

    <!-- Modals -->
    <ProjectSettingsModal v-model:open="uiStore.isProjectSettingsOpen" />
    <EditorSettingsModal v-model:open="isAppSettingsOpen" />
  </div>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
