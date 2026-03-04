<script setup lang="ts">
import { onMounted, markRaw, ref, computed, watch, nextTick } from 'vue';
import {
  useProjectTabs,
  registerProjectTab,
  isFileTab,
  type AnyProjectTab,
  type ProjectTab,
  type ProjectFileTab,
} from '~/composables/project/useProjectTabs';
import { FILE_MANAGER_MOVE_DRAG_TYPE } from '~/composables/useDraggedFile';
import ProjectFiles from '~/components/project/ProjectFiles.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import ProjectTabFileViewer from '~/components/project/ProjectTabFileViewer.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';

const { t } = useI18n();

const { tabs, activeTabId, setActiveTab, initDefaultTab, reorderTabs, addFileTab, removeFileTab } =
  useProjectTabs();

/** Static tabs (not reorderable via VueDraggable — use native drag) */
const staticTabs = computed(() => tabs.value.filter((t) => !isFileTab(t)) as ProjectTab[]);

/** File tabs (reorderable via VueDraggable) */
const fileTabsModel = computed({
  get: () => tabs.value.filter((t) => isFileTab(t)) as ProjectFileTab[],
  set: (val) => reorderTabs([...staticTabs.value, ...val]),
});

const activeFileTab = computed(() => {
  const tab = tabs.value.find((t) => t.id === activeTabId.value);
  return tab && isFileTab(tab) ? tab : null;
});

const activeStaticTab = computed<ProjectTab | null>(() => {
  const tab = tabs.value.find((t) => t.id === activeTabId.value);
  return tab && !isFileTab(tab) ? (tab as ProjectTab) : null;
});

const activeStaticComponent = computed(() => activeStaticTab.value?.component ?? null);

/** Whether the tab bar drop zone is active */
const isDropTarget = ref(false);

const tabContainerRef = ref<HTMLElement | null>(null);

const emit = defineEmits<{
  (e: 'tab-drag-start', event: DragEvent, tabId: string): void;
}>();

watch(activeTabId, async (newId) => {
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

function onTabsWheel(e: WheelEvent) {
  const container = tabContainerRef.value;
  if (!container) return;

  const horizontalDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (horizontalDelta === 0) return;

  e.preventDefault();
  container.scrollLeft += horizontalDelta;
}

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
      if (payload.kind === 'file' && payload.path) {
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
      if (payload.kind === 'file' && payload.path && payload.name) {
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
      if (payload.filePath && payload.fileName) {
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
    component: markRaw(ProjectFiles),
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

  initDefaultTab();
});
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 overflow-hidden"
  >
    <!-- Tab bar -->
    <div
      class="flex items-center border-b border-ui-border shrink-0 select-none transition-colors duration-150 min-h-[36px]"
      :class="isDropTarget ? 'bg-primary-500/10 border-primary-500/50' : ''"
      @wheel="onTabsWheel"
      @dragover="onTabBarDragOver"
      @dragleave="onTabBarDragLeave"
      @drop="onTabBarDrop"
    >
      <!-- Static tabs (draggable out of Project → separate panel) -->
      <div class="flex items-center h-full px-1 gap-0.5 py-1 shrink-0">
        <div
          v-for="tab in staticTabs"
          :key="tab.id"
          :data-tab-id="tab.id"
          class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0"
          :class="
            activeTabId === tab.id
              ? 'bg-primary-500/15 text-primary-400'
              : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
          "
          :title="tab.label"
          :draggable="tab.id !== 'files'"
          @dragstart="tab.id !== 'files' ? onStaticTabDragStart($event, tab) : undefined"
          @click="setActiveTab(tab.id)"
        >
          <UIcon
            :name="tab.icon ?? 'i-heroicons-rectangle-stack'"
            class="w-3.5 h-3.5 shrink-0"
            :class="activeTabId === tab.id ? 'text-primary-400' : 'text-ui-text-muted'"
          />
          <span class="text-[10px] font-semibold uppercase tracking-wider">
            {{ tab.label }}
          </span>
        </div>
      </div>

      <!-- File tabs (draggable out of Project → separate panel) -->
      <div
        ref="tabContainerRef"
        class="flex items-center h-full flex-1 min-w-0 overflow-x-auto no-scrollbar px-1 gap-0.5 py-1"
      >
        <div
          v-for="tab in fileTabsModel"
          :key="tab.id"
          :data-tab-id="tab.id"
          class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0"
          :class="
            activeTabId === tab.id
              ? 'bg-primary-500/15 text-primary-400'
              : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
          "
          :title="tab.fileName"
          draggable="true"
          @dragstart="onFileTabDragStart($event, tab)"
          @click="setActiveTab(tab.id)"
        >
          <UIcon
            :name="tab.icon"
            class="w-3.5 h-3.5 shrink-0"
            :class="activeTabId === tab.id ? 'text-primary-400' : 'text-ui-text-muted'"
          />

          <!-- Close button for file tabs -->
          <button
            class="ml-0.5 p-0.5 rounded hover:bg-red-500/15 hover:text-red-400 transition-colors"
            :title="t('common.close', 'Close')"
            @click.stop="removeFileTab(tab.id)"
          >
            <UIcon name="i-heroicons-x-mark" class="w-3 h-3" />
          </button>
        </div>
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
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
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

    <TimelineToolbar />
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
