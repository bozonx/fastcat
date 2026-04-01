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

import MobileBottomNav from '~/components/layout/MobileBottomNav.vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { until, useLocalStorage, useMediaQuery } from '@vueuse/core';

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
    await until(() => !workspaceStore.isInitializing).toBeTruthy();
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

    // Handle view query parameter
    const viewParam = route.query.view as string;
    if (viewParam && ['files', 'edit', 'export', 'settings'].includes(viewParam)) {
      activeTab.value = viewParam as TabId;
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

const isLandscapeMode = useMediaQuery('(orientation: landscape)');

const isVerticalProject = computed(() => {
  const { width, height } = projectStore.projectSettings.project;
  return width < height;
});

// Persisted panel sizes (percent of container)
const portraitMonitorHeight = useLocalStorage('mobile_monitor_size_portrait', 38);
const landscapeMonitorWidth = useLocalStorage('mobile_monitor_size_landscape', 42);

const monitorStyle = computed(() =>
  isLandscapeMode.value
    ? { width: `${landscapeMonitorWidth.value}%` }
    : { height: `${portraitMonitorHeight.value}%` },
);

const containerRef = ref<HTMLElement | null>(null);

function onDividerPointerDown(e: PointerEvent) {
  const el = containerRef.value;
  const handle = e.currentTarget as HTMLElement;
  if (!el || !handle) return;

  e.preventDefault();
  handle.setPointerCapture(e.pointerId);

  const rect = el.getBoundingClientRect();

  const onMove = (ev: PointerEvent) => {
    if (isLandscapeMode.value) {
      // In flex-row, the monitor is on the left
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      landscapeMonitorWidth.value = Math.min(Math.max(pct, 20), 70);
    } else {
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      portraitMonitorHeight.value = Math.min(Math.max(pct, 20), 65);
    }
  };

  const cleanup = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', cleanup);
    handle.removeEventListener('pointercancel', cleanup);
    handle.removeEventListener('lostpointercapture', cleanup);
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', cleanup);
  handle.addEventListener('pointercancel', cleanup);
  handle.addEventListener('lostpointercapture', cleanup);
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
        ref="containerRef"
        class="flex h-full overflow-hidden bg-slate-950"
        :class="[
          isLandscapeMode ? 'flex-row' : 'flex-col'
        ]"
      >
        <MobileMonitorContainer
          mode="edit"
          flexible
          :style="monitorStyle"
          class="shrink-0"
        />

        <!-- Draggable divider -->
        <div
          class="relative flex shrink-0 items-center justify-center touch-none select-none z-10 bg-slate-900"
          :class="isLandscapeMode
            ? 'w-3 cursor-col-resize border-x border-slate-800/60'
            : 'h-3 cursor-row-resize border-y border-slate-800/60'"
          @pointerdown="onDividerPointerDown"
        >
          <div
            class="rounded-full bg-slate-600 pointer-events-none"
            :class="isLandscapeMode ? 'w-1 h-9' : 'h-1 w-10'"
          />
        </div>

        <MobileTimeline class="flex-1 min-h-0 min-w-0" />
      </div>



      <div v-else-if="activeTab === 'export'" class="h-full">
        <ExportForm disable-focus-frame />
      </div>

      <div v-else class="h-full">
        <MobileSettingsView />
      </div>
    </main>

    <!-- Bottom Navigation Bar -->
    <MobileBottomNav
      v-if="showBottomNav"
      v-model:active-tab="activeTab"
    />

  </div>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
