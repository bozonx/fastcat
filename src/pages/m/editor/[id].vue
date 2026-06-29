<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useResizablePanel } from '~/composables/layout/useResizablePanel';

import MobileFilesView from '~/components/file-manager/MobileFilesView.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';
import MobileSettingsView from '~/components/settings/MobileSettingsView.vue';

import MobileBottomNav from '~/components/layout/MobileBottomNav.vue';
import { until, useWindowSize } from '@vueuse/core';
import { usePendingNewProjectFiles } from '~/composables/project/useProjectManagement';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';
import { readLocalStorageString, writeLocalStorageString } from '~/stores/ui/uiLocalStorage';

definePageMeta({
  layout: 'mobile',
});

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUiStore();
const router = useRouter();
const route = useRoute();
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

  const isTauri = workspaceStore.workspaceProviderId === 'tauri';
  if (!isTauri && !workspaceStore.workspaceHandle) {
    router.push('/m');
    return;
  }

  try {
    await openProject(decodeURIComponent(projectId));
    if (!projectStore.currentProjectName) {
      throw new Error('Project failed to open');
    }

    // Handle view query parameter or restore last active tab from localStorage
    const viewParam = route.query.view as string;
    let targetTab: TabId = 'edit';
    if (viewParam && ['files', 'edit', 'export', 'settings'].includes(viewParam)) {
      targetTab = viewParam as TabId;
    } else {
      const lastTab = readLocalStorageString('fastcat:mobile:last-tab', 'edit') as TabId;
      targetTab = lastTab && ['files', 'edit'].includes(lastTab) ? lastTab : 'edit';
    }

    projectStore.setView(tabToViewMap[targetTab]);

    if (route.query.view !== targetTab) {
      router.replace({
        query: { ...route.query, view: targetTab },
      });
    }

    if (targetTab === 'edit' || targetTab === 'files') {
      writeLocalStorageString('fastcat:mobile:last-tab', targetTab);
    }

    // Auto-import pending files for new project
    const { pendingFilesForNewProject } = usePendingNewProjectFiles();
    if (pendingFilesForNewProject.value.length > 0) {
      const filesToImport = [...pendingFilesForNewProject.value];
      pendingFilesForNewProject.value = []; // Reset immediately to prevent double triggers

      filesToImport.sort((a, b) => a.lastModified - b.lastModified);

      const fileManager = useFileManager();
      const { addMediaToTimeline } = useAddMediaToTimeline();

      const uploadResults = await fileManager.handleFiles(filesToImport, {
        selectInFileManager: false,
      });

      if (uploadResults && uploadResults.length > 0) {
        const mediaEntries = uploadResults.map((r) => ({
          name: r.fileName,
          path: r.targetPath,
        }));
        await addMediaToTimeline(mediaEntries);
      }
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
    projectStore.setView(tabToViewMap[tab]);
    router.replace({
      query: { ...route.query, view: tab },
    });
    if (tab === 'edit' || tab === 'files') {
      writeLocalStorageString('fastcat:mobile:last-tab', tab);
    }
  },
});

const showBottomNav = computed(() => !isOpeningProject.value && !projectOpenError.value);

async function handleBack() {
  await leaveProject('/m');
}

const { width: windowWidth, height: windowHeight } = useWindowSize();
const isLandscapeMode = computed(() => windowWidth.value > windowHeight.value);
const mobilePanelMaxPercent = computed(() => (isLandscapeMode.value ? 84 : 82));

// Persisted panel sizes (percent of container)
const portraitMonitorHeight = computed({
  get: () =>
    projectStore.projectSettings.ui.layout.splitSizes['mobile-monitor:portrait']?.[0] ?? 38,
  set: (value: number) => {
    projectStore.projectSettings.ui.layout.splitSizes['mobile-monitor:portrait'] = [value];
  },
});
const landscapeMonitorWidth = computed({
  get: () =>
    projectStore.projectSettings.ui.layout.splitSizes['mobile-monitor:landscape']?.[0] ?? 42,
  set: (value: number) => {
    projectStore.projectSettings.ui.layout.splitSizes['mobile-monitor:landscape'] = [value];
  },
});

const monitorStyle = computed(() =>
  isLandscapeMode.value
    ? { width: `${landscapeMonitorWidth.value}%` }
    : { height: `${portraitMonitorHeight.value}%` },
);

const containerRef = ref<HTMLElement | null>(null);

const panelOrientation = computed<'horizontal' | 'vertical'>(() =>
  isLandscapeMode.value ? 'horizontal' : 'vertical',
);

const { onDividerPointerDown } = useResizablePanel({
  containerRef,
  orientation: panelOrientation,
  minPercent: 20,
  maxPercent: mobilePanelMaxPercent,
  getValue: () =>
    isLandscapeMode.value ? landscapeMonitorWidth.value : portraitMonitorHeight.value,
  setValue: (value: number) => {
    if (isLandscapeMode.value) {
      landscapeMonitorWidth.value = value;
    } else {
      portraitMonitorHeight.value = value;
    }
  },
});
</script>

<template>
  <div class="flex h-full w-full flex-col landscape:flex-row">
    <!-- Main Content Area (Virtual Tabs) -->
    <main class="relative flex-1 min-h-0 overflow-hidden bg-ui-bg">
      <div
        v-if="isOpeningProject"
        class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-ui-text-muted"
      >
        <Icon name="lucide:loader-circle" class="h-8 w-8 animate-spin text-primary-400" />
        <div>
          <p class="text-sm font-medium text-ui-text">Opening project</p>
          <p class="text-xs text-ui-text-muted">Preparing timeline, media, and mobile workspace</p>
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
        <MobileFilesView />
      </div>

      <div
        v-else-if="activeTab === 'edit'"
        ref="containerRef"
        class="flex h-full overflow-hidden bg-ui-bg"
        :class="[isLandscapeMode ? 'flex-row' : 'flex-col']"
      >
        <MobileMonitorContainer mode="edit" flexible :style="monitorStyle" class="shrink-0" />

        <!-- Draggable divider -->
        <div
          class="relative flex shrink-0 items-center justify-center touch-none select-none z-10 bg-ui-bg-elevated"
          :class="
            isLandscapeMode
              ? 'w-3 cursor-col-resize border-x border-ui-border/60'
              : 'h-3 cursor-row-resize border-y border-ui-border/60'
          "
          @pointerdown="onDividerPointerDown"
        >
          <div
            class="rounded-full bg-ui-text-muted pointer-events-none"
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
      v-if="showBottomNav && !uiStore.isMobileTimelineDrawerOpen"
      v-model:active-tab="activeTab"
      class="landscape:order-first"
    />
  </div>
</template>
