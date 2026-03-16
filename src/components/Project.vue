<script setup lang="ts">
import { onBeforeUnmount, onMounted, markRaw, ref, computed, watch, nextTick } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import {
  useProjectTabsStore,
  isFileTab,
  type AnyProjectTab,
  type ProjectTab,
  type ProjectFileTab,
} from '~/stores/tabs.store';
import { FILE_MANAGER_MOVE_DRAG_TYPE } from '~/composables/useDraggedFile';
import { isOpenableProjectFileName } from '~/utils/media-types';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import ProjectLibrary from '~/components/project/ProjectLibrary.vue';
import ProjectTabFileViewer from '~/components/project/ProjectTabFileViewer.vue';
import { useFocusStore } from '~/stores/focus.store';

const { t } = useI18n();
const focusStore = useFocusStore();

const props = withDefaults(
  defineProps<{
    useExternalFocus?: boolean;
  }>(),
  {
    useExternalFocus: false,
  },
);

const tabsStore = useProjectTabsStore();
const {
  setActiveTab,
  initDefaultTab,
  reorderTabs,
  addFileTab,
  removeFileTab,
  removeOtherFileTabs,
  removeAllFileTabs,
  registerProjectTab,
} = tabsStore;

/** Static tabs (not reorderable via VueDraggable — use native drag) */
const staticTabs = computed(() => {
  const t = tabsStore.tabs;
  if (!t) return [];
  return t.filter((tab: AnyProjectTab) => !isFileTab(tab)) as ProjectTab[];
});

/** File tabs (reorderable via VueDraggable) */
const fileTabsModel = computed({
  get: () => {
    const t = tabsStore.tabs;
    if (!t) return [];
    return t.filter((tab: AnyProjectTab) => isFileTab(tab)) as ProjectFileTab[];
  },
  set: (val) => reorderTabs([...staticTabs.value, ...val]),
});

const activeFileTab = computed(() => {
  const t = tabsStore.tabs;
  if (!t) return null;
  const tab = t.find((t: AnyProjectTab) => t.id === tabsStore.activeTabId);
  return tab && isFileTab(tab) ? tab : null;
});

const activeStaticTab = computed<ProjectTab | null>(() => {
  const t = tabsStore.tabs;
  if (!t) return null;
  const tab = t.find((t: AnyProjectTab) => t.id === tabsStore.activeTabId);
  return tab && !isFileTab(tab) ? (tab as ProjectTab) : null;
});

const activeStaticComponent = computed(() => activeStaticTab.value?.component ?? null);

/** Whether the tab bar drop zone is active */
const isDropTarget = ref(false);

const tabContainerRef = ref<HTMLElement | null>(null);

const emit = defineEmits<{
  (e: 'tab-drag-start', event: DragEvent, tabId: string): void;
}>();

function activateProjectFocus() {
  focusStore.setPanelFocus('project');
}

function activateProjectTab(tabId: string) {
  activateProjectFocus();
  setActiveTab(tabId);
}

function isMiddleClick(event: MouseEvent) {
  return event.button === 1;
}

function onStaticTabMouseDown(event: MouseEvent, tabId: string) {
  if (!isMiddleClick(event) || tabId === 'files') return;
  event.preventDefault();
}

function onStaticTabAuxClick(event: MouseEvent, tabId: string) {
  if (!isMiddleClick(event) || tabId === 'files') return;
  event.preventDefault();
}

function onFileTabMouseDown(event: MouseEvent) {
  if (!isMiddleClick(event)) return;
  event.preventDefault();
}

function onFileTabAuxClick(event: MouseEvent, tabId: string) {
  if (!isMiddleClick(event)) return;
  event.preventDefault();
  removeFileTab(tabId);
}

const projectTabContextMenuItems = computed(() => {
  if (!activeFileTab.value) return [];

  const activeTabId = activeFileTab.value.id;

  return [
    [
      {
        label: t('common.close', 'Close'),
        icon: 'i-heroicons-x-mark',
        onSelect: () => removeFileTab(activeTabId),
      },
      {
        label: t('videoEditor.projectTabs.closeOthers', 'Close Others'),
        icon: 'i-heroicons-minus-circle',
        onSelect: () => removeOtherFileTabs(activeTabId),
      },
      {
        label: t('videoEditor.projectTabs.closeAll', 'Close All'),
        icon: 'i-heroicons-x-circle',
        onSelect: () => removeAllFileTabs(),
      },
    ],
  ];
});

watch(() => tabsStore.activeTabId, async (newId) => {
  if (!newId) return;

  // Wait for DOM to update
  await nextTick();
  await nextTick();

  const activeEl = document.querySelector(`[data-tab-id="${newId}"]`) as HTMLElement;
  if (activeEl) {
    // block: nearest - vertical scroll (don't change if possible)
    // inline: center - horizontal scroll to center the tab
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
});

function onStaticTabDragStart(e: DragEvent, tab: AnyProjectTab) {
  if (isFileTab(tab)) return;
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(
    'static-tab-drag',
    JSON.stringify({ tabId: tab.id, label: (tab as ProjectTab).label }),
  );
  emit('tab-drag-start', e, tab.id);
}

function onFileTabDragStart(e: DragEvent, tab: ProjectFileTab) {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(
    'file-tab-drag',
    JSON.stringify({
      tabId: tab.id,
      filePath: tab.filePath,
      fileName: tab.fileName,
      mediaType: tab.mediaType,
    }),
  );
}

function onTabBarDragOver(e: DragEvent) {
  const types = e.dataTransfer?.types ?? [];
  if (
    types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
    types.includes('application/json') ||
    types.includes('panel-drag') ||
    types.includes('file-tab-drag') ||
    types.includes('static-tab-drag')
  ) {
    e.preventDefault();
    isDropTarget.value = true;
  }
}

const tabBarRef = ref<HTMLElement | null>(null);

function onTabsWheel(e: WheelEvent) {
  const container = tabContainerRef.value;
  if (!container) return;

  const horizontalDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (horizontalDelta === 0) return;

  e.preventDefault();
  container.scrollLeft += horizontalDelta;
}

onMounted(() => {
  tabBarRef.value?.addEventListener('wheel', onTabsWheel, { passive: false });
});

onBeforeUnmount(() => {
  tabBarRef.value?.removeEventListener('wheel', onTabsWheel);
});

function onTabBarDragLeave(e: DragEvent) {
  const currentTarget = e.currentTarget as HTMLElement | null;
  const related = e.relatedTarget as Node | null;
  if (!currentTarget?.contains(related)) {
    isDropTarget.value = false;
  }
}

function onTabBarDrop(e: DragEvent) {
  isDropTarget.value = false;
  e.preventDefault();
  // Prevent event from bubbling to editor.vue panel drop handler
  e.stopPropagation();

  // Drop from FileManager tree/browser (internal file drag)
  const movePayloadRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
  if (movePayloadRaw) {
    try {
      const payload = JSON.parse(movePayloadRaw) as { path: string; name: string; kind: string };
      if (payload.kind === 'file' && payload.path && isOpenableProjectFileName(payload.name)) {
        const tabId = addFileTab({ filePath: payload.path, fileName: payload.name });
        setActiveTab(tabId);
      }
    } catch {
      // ignore malformed payload
    }
    return;
  }

  // Fallback: file drag via application/json (e.g. from FileBrowser grid/list)
  const jsonPayloadRaw = e.dataTransfer?.getData('application/json');
  if (jsonPayloadRaw) {
    try {
      const payload = JSON.parse(jsonPayloadRaw) as { path?: string; name?: string; kind?: string };
      if (
        payload.kind === 'file' &&
        payload.path &&
        payload.name &&
        isOpenableProjectFileName(payload.name)
      ) {
        const tabId = addFileTab({ filePath: payload.path, fileName: payload.name });
        setActiveTab(tabId);
        return;
      }
    } catch {
      // ignore
    }
  }

  // Drop from file-tab-drag (re-docking a detached file tab)
  const fileTabRaw = e.dataTransfer?.getData('file-tab-drag');
  if (fileTabRaw) {
    try {
      const payload = JSON.parse(fileTabRaw) as { filePath: string; fileName: string };
      if (payload.filePath && payload.fileName) {
        const tabId = addFileTab({ filePath: payload.filePath, fileName: payload.fileName });
        setActiveTab(tabId);
      }
    } catch {
      // ignore
    }
    return;
  }

  // Drop from dynamic panel (media/text panel → tab)
  const panelPayloadRaw = e.dataTransfer?.getData('panel-drag');
  if (panelPayloadRaw) {
    try {
      const payload = JSON.parse(panelPayloadRaw) as {
        panelId: string;
        filePath?: string;
        fileName?: string;
      };
      if (payload.filePath && payload.fileName && isOpenableProjectFileName(payload.fileName)) {
        const tabId = addFileTab({
          filePath: payload.filePath,
          fileName: payload.fileName,
        });
        setActiveTab(tabId);
        // Remove the source panel
        const projectStore = useProjectStore();
        projectStore.removePanel(payload.panelId);
      }
    } catch {
      // ignore
    }
  }
}

onMounted(() => {
  registerProjectTab({
    id: 'files',
    label: t('videoEditor.fileManager.tabs.files', 'Files'),
    icon: 'i-heroicons-folder',
    component: markRaw(FileManagerPanel),
  });

  registerProjectTab({
    id: 'history',
    label: t('videoEditor.fileManager.tabs.history', 'History'),
    icon: 'i-heroicons-clock',
    component: markRaw(ProjectHistory),
  });

  registerProjectTab({
    id: 'effects',
    label: t('videoEditor.fileManager.tabs.effects', 'Effects'),
    icon: 'i-heroicons-sparkles',
    component: markRaw(ProjectEffects),
  });

  registerProjectTab({
    id: 'library',
    label: t('videoEditor.fileManager.tabs.library', 'Library'),
    icon: 'i-heroicons-rectangle-group',
    component: markRaw(ProjectLibrary),
  });

  initDefaultTab();
});
</script>

<template>
  <div
    class="panel-focus-frame flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 overflow-hidden"
    :class="{
      'panel-focus-frame--active': !props.useExternalFocus && focusStore.isPanelFocused('project'),
    }"
    @pointerdown.capture="!props.useExternalFocus && activateProjectFocus()"
  >
    <!-- Tab bar -->
    <div
      ref="tabBarRef"
      class="flex items-center border-b border-ui-border shrink-0 select-none transition-colors duration-150 min-h-[36px]"
      :class="isDropTarget ? 'bg-primary-500/10 border-primary-500/50' : ''"
      @dragover="onTabBarDragOver"
      @dragleave="onTabBarDragLeave"
      @drop="onTabBarDrop"
    >
      <!-- All tabs in a single scrollable container -->
      <div ref="tabContainerRef" class="flex items-center h-full flex-1 min-w-0 overflow-x-auto no-scrollbar">
        <!-- Static tabs -->
        <div class="flex items-center px-1 gap-0.5 py-1 shrink-0">
          <div
            v-for="tab in staticTabs"
            :key="tab.id"
            :data-tab-id="tab.id"
            class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0"
            :class="
              tabsStore.activeTabId === tab.id
                ? 'bg-primary-500/15 text-primary-400'
                : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
            "
            :title="tab.label"
            :draggable="tab.id !== 'files'"
            @mousedown="onStaticTabMouseDown($event, tab.id)"
            @auxclick="onStaticTabAuxClick($event, tab.id)"
            @dragstart="tab.id !== 'files' ? onStaticTabDragStart($event, tab) : undefined"
            @click="activateProjectTab(tab.id)"
          >
            <UIcon
              :name="tab.icon ?? 'i-heroicons-rectangle-stack'"
              class="w-3.5 h-3.5 shrink-0"
              :class="tabsStore.activeTabId === tab.id ? 'text-primary-400' : 'text-ui-text-muted'"
            />
            <span class="text-[10px] font-semibold uppercase tracking-wider">
              {{ tab.label }}
            </span>
          </div>
        </div>

        <!-- File tabs -->
        <UContextMenu
          v-if="fileTabsModel.length > 0"
          :items="projectTabContextMenuItems"
          class="min-w-0 flex-1"
        >
          <VueDraggable
            v-model="fileTabsModel"
            class="flex items-center px-1 gap-0.5 py-1 min-w-max"
            :animation="150"
            handle=".project-file-tab-drag-handle"
            ghost-class="project-tab-ghost"
            fallback-on-body
            force-fallback
          >
            <div
              v-for="tab in fileTabsModel"
              :key="tab.id"
              :data-tab-id="tab.id"
              class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0"
              :class="
                tabsStore.activeTabId === tab.id
                  ? 'bg-primary-500/15 text-primary-400'
                  : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
              "
              :title="tab.fileName"
              @mousedown="onFileTabMouseDown($event)"
              @auxclick="onFileTabAuxClick($event, tab.id)"
              @click="activateProjectTab(tab.id)"
            >
              <div
                class="project-file-tab-drag-handle flex items-center gap-1.5 min-w-0"
                draggable="true"
                @dragstart="onFileTabDragStart($event, tab)"
              >
                <UIcon
                  :name="tab.icon"
                  class="w-3.5 h-3.5 shrink-0"
                  :class="tabsStore.activeTabId === tab.id ? 'text-primary-400' : 'text-ui-text-muted'"
                />
                <span class="text-[10px] font-semibold tracking-wide truncate max-w-[140px]">
                  {{ tab.fileName }}
                </span>
              </div>

              <button
                class="ml-0.5 p-0.5 rounded hover:bg-red-500/15 hover:text-red-400 transition-colors"
                :title="t('common.close', 'Close')"
                @click.stop="removeFileTab(tab.id)"
              >
                <UIcon name="i-heroicons-x-mark" class="w-3 h-3" />
              </button>
            </div>
          </VueDraggable>
        </UContextMenu>
      </div>

      <!-- Drop hint when dragging over -->
      <div
        v-if="isDropTarget"
        class="flex items-center gap-1 px-2 text-[10px] text-primary-400 font-semibold uppercase tracking-wider shrink-0 pointer-events-none"
      >
        <UIcon name="i-heroicons-arrow-down-tray" class="w-3.5 h-3.5" />
        {{ t('videoEditor.projectTabs.dropHint', 'Add as tab') }}
      </div>
    </div>

    <!-- Content area -->
    <div
      class="flex flex-col flex-1 min-h-0 overflow-hidden"
      @pointerdown.capture="activateProjectFocus"
    >
      <!-- File viewer for file tabs -->
      <ProjectTabFileViewer
        v-if="activeFileTab"
        :file-path="activeFileTab.filePath"
        :file-name="activeFileTab.fileName"
        :media-type="activeFileTab.mediaType"
      />

      <!-- Static tab component -->
      <component :is="activeStaticComponent" v-else-if="activeStaticComponent" />
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar {
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
