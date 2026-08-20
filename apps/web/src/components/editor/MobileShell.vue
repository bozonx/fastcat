<script setup lang="ts">
/**
 * Touch-oriented editing shell: virtual tabs, a resizable monitor/timeline
 * split and the bottom navigation bar.
 *
 * Owns layout only — opening a project belongs to the caller, so the same shell
 * serves the routed mobile page and the embeddable session. Tab state lives in
 * `projectStore.currentView`; the `tab-change` event lets a routed caller mirror
 * it into the URL, which the embedded caller simply ignores.
 */
import { computed, ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useResizablePanel } from '~/composables/layout/useResizablePanel';

import MobileFilesView from '~/components/file-manager/MobileFilesView.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';
import MobileSettingsView from '~/components/settings/MobileSettingsView.vue';
import MobileBottomNav from '~/components/layout/MobileBottomNav.vue';
import { useWindowSize } from '@vueuse/core';

export type MobileShellTab = 'files' | 'edit' | 'export' | 'settings';

const props = withDefaults(
  defineProps<{
    /** Tabs the bottom bar offers; a trimmed list drives the embed profile. */
    tabs?: MobileShellTab[];
    showBottomNav?: boolean;
    /** Passed through to the bar: `embedded` drops the home button. */
    navMode?: 'routed' | 'embedded';
  }>(),
  {
    tabs: () => ['files', 'edit', 'export', 'settings'],
    showBottomNav: true,
    navMode: 'routed',
  },
);

const emit = defineEmits<{ (e: 'tab-change', tab: MobileShellTab): void }>();

const projectStore = useProjectStore();

const tabToViewMap = {
  files: 'files',
  edit: 'cut',
  export: 'export',
  settings: 'settings',
} as const;

const viewToTabMap: Record<string, MobileShellTab> = {
  files: 'files',
  cut: 'edit',
  sound: 'edit',
  export: 'export',
  settings: 'settings',
  fullscreen: 'edit',
};

const activeTab = computed<MobileShellTab>({
  get: () => viewToTabMap[projectStore.currentView as string] ?? 'edit',
  set: (tab: MobileShellTab) => {
    projectStore.setView(tabToViewMap[tab]);
    emit('tab-change', tab);
  },
});

const { width: windowWidth, height: windowHeight } = useWindowSize();
const isLandscapeMode = computed(() => windowWidth.value > windowHeight.value);
const mobilePanelMaxPercent = computed(() => (isLandscapeMode.value ? 84 : 82));

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

const navTabs = computed(() => props.tabs);
</script>

<template>
  <div class="flex h-full w-full flex-col landscape:flex-row">
    <main class="relative flex-1 min-h-0 overflow-hidden bg-ui-bg">
      <div v-if="activeTab === 'files'" class="h-full">
        <MobileFilesView />
      </div>

      <div
        v-else-if="activeTab === 'edit'"
        ref="containerRef"
        class="flex h-full overflow-hidden bg-ui-bg"
        :class="[isLandscapeMode ? 'flex-row' : 'flex-col']"
      >
        <MobileMonitorContainer mode="edit" flexible :style="monitorStyle" class="shrink-0" />

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

    <MobileBottomNav
      v-if="showBottomNav"
      v-model:active-tab="activeTab"
      :tabs="navTabs"
      :mode="navMode"
      class="landscape:order-first"
    />
  </div>
</template>
