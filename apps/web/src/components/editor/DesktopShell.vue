<script setup lang="ts">
/**
 * Desktop editing shell: splitpanes, dynamic panels and the timeline.
 *
 * Owns layout only. Opening a project is the caller's job, so the same shell
 * serves the routed editor page and the embeddable session.
 */
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import EditorCutView from '~/components/editor/EditorCutView.vue';
import EditorExportView from '~/components/editor/EditorExportView.vue';
import EditorFilesView from '~/components/editor/EditorFilesView.vue';
import EditorSoundView from '~/components/editor/EditorSoundView.vue';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useProjectStore } from '~/stores/project.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useEditorDynamicPanels } from '~/composables/editor/useEditorDynamicPanels';
import { useNativeMonitorBridge } from '~/composables/monitor/useNativeMonitorBridge';
import { computed, ref } from 'vue';
import EditorTimeline from '~/components/layout-panels/EditorTimeline.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false,
  },
);

const projectStore = useProjectStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();
const { t } = useI18n();

const menuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const activeResetAction = ref<(() => void) | null>(null);

function onMainContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const splitter = target.closest('.splitpanes__splitter');
  if (!splitter) return;

  e.preventDefault();
  e.stopPropagation();

  // Find which splitter it is
  // Horizontal splitter between Top and Bottom (Timeline)
  const isHorizontalSplitter = splitter.parentElement?.classList.contains('splitpanes--horizontal');
  if (isHorizontalSplitter) {
    activeResetAction.value = () => projectStore.resetTimelineHeight();
  } else if (activeEditorView.value === 'files') {
    activeResetAction.value = () => filesReset();
  } else if (activeEditorView.value === 'sound') {
    activeResetAction.value = () => soundReset();
  } else if (activeEditorView.value === 'export') {
    activeResetAction.value = () => exportReset();
  } else {
    // Other views? They use EditorDynamicPanelsView which has its own menu
    return;
  }

  menuRef.value?.open(e);
}

const mainSplitterMenuItems = computed(() => [
  [
    {
      label: t('common.actions.reset'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => {
        activeResetAction.value?.();
      },
    },
  ],
]);
const { currentProjectId } = storeToRefs(projectStore);

const activeEditorView = computed(() => {
  if (projectStore.currentView === 'fullscreen') {
    return projectStore.lastViewBeforeFullscreen ?? 'cut';
  }

  return projectStore.currentView;
});

const defaultCutPanelSizes = computed(() => {
  const len = projectStore.cutPanels?.length || 0;
  if (len === 0) return [];
  const size = 100 / len;
  return Array(len).fill(size);
});

const defaultSoundPanelSizes = computed(() => {
  const len = projectStore.soundPanels?.length || 0;
  if (len === 0) return [];
  const size = 100 / len;
  return Array(len).fill(size);
});

const projectSplitSizesStorage = {
  get: (key: string) => projectStore.projectSettings.ui.layout.splitSizes[key] ?? null,
  set: (key: string, value: number[]) => {
    projectStore.projectSettings.ui.layout.splitSizes[key] = value;
  },
};

const {
  sizes: topSplitSizes,
  onResized: onTopSplitResize,
  reset: topSplitReset,
} = usePersistedSplitpanes(
  'editor-cut-top-dynamic',
  currentProjectId,
  defaultCutPanelSizes,
  projectSplitSizesStorage,
);

const {
  sizes: soundTopSplitSizes,
  onResized: onSoundTopSplitResize,
  reset: soundTopSplitReset,
} = usePersistedSplitpanes(
  'editor-sound-dynamic',
  currentProjectId,
  defaultSoundPanelSizes,
  projectSplitSizesStorage,
);

const {
  sizes: filesSizes,
  onResized: onFilesResize,
  reset: filesReset,
} = usePersistedSplitpanes(
  'editor-files-top',
  currentProjectId,
  [80, 20],
  projectSplitSizesStorage,
);

const {
  sizes: soundSizes,
  onResized: onSoundResize,
  reset: soundReset,
} = usePersistedSplitpanes(
  'editor-sound-top',
  currentProjectId,
  [75, 25],
  projectSplitSizesStorage,
);

const {
  sizes: exportSizes,
  onResized: onExportResize,
  reset: exportReset,
} = usePersistedSplitpanes(
  'editor-export-top',
  currentProjectId,
  [40, 60],
  projectSplitSizesStorage,
);

const {
  draggingPanelId,
  dragOverPanelId,
  dropPosition,
  getDynamicPanelFocusId,
  getVerticalSize,
  focusDynamicPanel,
  closePanelAndRestoreTab,
  movePanelToView,
  onVerticalSplitResize,
  resetVerticalSizes,
  onPanelPointerDown,
  panelDndZoneAttrs,
} = useEditorDynamicPanels({
  currentProjectId,
});

function isDynamicPanelFocused(panelId: string) {
  if (focusStore.isPanelFocused(getDynamicPanelFocusId(panelId))) return true;

  // When Tab switches focus to the 'monitor' main panel (activePanelId = 'monitor'),
  // the monitor panel inside dynamic layout also needs to show its focus frame,
  // since MonitorContainer uses useExternalFocus and delegates frame rendering here.
  const activePanelId = focusStore.activePanelId;
  if (activePanelId !== 'monitor') return false;

  for (const col of projectStore.cutPanels) {
    const panel = col.panels.find((p) => p.id === panelId);
    if (panel) return panel.type === 'monitor';
  }
  for (const col of projectStore.soundPanels) {
    const panel = col.panels.find((p) => p.id === panelId);
    if (panel) return panel.type === 'monitor';
  }

  return false;
}

useNativeMonitorBridge();

function onMainSplitResize(event: { panes: { size: number }[] }) {
  if (!Array.isArray(event?.panes) || event.panes.length < 2) return;
  const lastPane = event.panes[event.panes.length - 1];
  if (typeof lastPane?.size === 'number') {
    projectStore.timelineHeight = lastPane.size;
  }
}
</script>

<template>
  <ClientOnly>
    <div ref="containerRef" class="flex flex-col h-full min-h-0 overflow-hidden relative">
      <UiContextMenuPortal
        ref="menuRef"
        :items="mainSplitterMenuItems"
        :target-el="containerRef"
        manual
      />
      <Splitpanes
        class="flex-1 min-h-0 overflow-hidden editor-splitpanes"
        horizontal
        @resized="onMainSplitResize"
        @contextmenu="onMainContextMenu"
      >
        <!-- Top Panel: varies by view -->
        <Pane :size="100 - projectStore.timelineHeight" min-size="10">
          <EditorFilesView
            v-if="activeEditorView === 'files'"
            :sizes="filesSizes"
            :selected-entity="selectionStore.selectedEntity"
            @resized="onFilesResize"
            @clear-selection="selectionStore.clearSelection"
          />

          <EditorCutView
            v-else-if="activeEditorView === 'cut'"
            :embedded="props.embedded"
            :columns="projectStore.cutPanels"
            :top-sizes="topSplitSizes"
            :dragging-panel-id="draggingPanelId"
            :drag-over-panel-id="dragOverPanelId"
            :drop-position="dropPosition"
            :get-vertical-size="
              (colId, rowIndex, totalRows, view) =>
                getVerticalSize({ colId, rowIndex, totalRows, view })
            "
            :is-focused="isDynamicPanelFocused"
            :get-focus-id="getDynamicPanelFocusId"
            :panel-dnd-zone-attrs="panelDndZoneAttrs"
            @top-resize="onTopSplitResize"
            @vertical-resize="(event, colId, view) => onVerticalSplitResize({ event, colId, view })"
            @focus="focusDynamicPanel"
            @close="(panel, view) => closePanelAndRestoreTab(panel, { view })"
            @move-to-view="movePanelToView"
            @top-reset="topSplitReset"
            @vertical-reset="resetVerticalSizes"
            @panel-pointer-down="onPanelPointerDown"
          />

          <EditorSoundView
            v-else-if="activeEditorView === 'sound'"
            :sizes="soundSizes"
            :columns="projectStore.soundPanels"
            :top-sizes="soundTopSplitSizes"
            :dragging-panel-id="draggingPanelId"
            :drag-over-panel-id="dragOverPanelId"
            :drop-position="dropPosition"
            :get-vertical-size="
              (colId, rowIndex, totalRows, view) =>
                getVerticalSize({ colId, rowIndex, totalRows, view })
            "
            :is-focused="isDynamicPanelFocused"
            :get-focus-id="getDynamicPanelFocusId"
            :panel-dnd-zone-attrs="panelDndZoneAttrs"
            @resized="onSoundResize"
            @top-resize="onSoundTopSplitResize"
            @vertical-resize="(event, colId, view) => onVerticalSplitResize({ event, colId, view })"
            @focus="focusDynamicPanel"
            @close="(panel, view) => closePanelAndRestoreTab(panel, { view })"
            @move-to-view="movePanelToView"
            @top-reset="soundTopSplitReset"
            @vertical-reset="resetVerticalSizes"
            @panel-pointer-down="onPanelPointerDown"
          />

          <EditorExportView
            v-else-if="activeEditorView === 'export'"
            :sizes="exportSizes"
            @resized="onExportResize"
          />
        </Pane>

        <!-- Bottom Panel: Timeline (always visible, height varies) -->
        <Pane :size="projectStore.timelineHeight" min-size="5">
          <div class="h-full min-h-0 overflow-hidden text-clip">
            <EditorTimeline class="h-full" />
          </div>
        </Pane>
      </Splitpanes>
    </div>
  </ClientOnly>
</template>
