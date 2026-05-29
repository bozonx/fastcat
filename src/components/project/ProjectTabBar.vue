<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import { isFileTab, type AnyProjectTab } from '~/stores/project-tabs.store';
import { useProjectTabs } from '~/composables/project/useProjectTabs';

const emit = defineEmits<{
  (e: 'tab-drag-start', event: DragEvent, tabId: string): void;
}>();

const {
  activateProjectTab,
  allTabsModel,
  getFileTabContextMenuItems,
  getStaticTabContextMenuItems,
  isDropTarget,
  onTabAuxClick,
  onTabDragStart,
  onTabMouseDown,
  onTabBarDragLeave,
  onTabBarDragOver,
  onTabBarDrop,
  tabsStore,
} = useProjectTabs({
  onStaticTabDragStart: (event, tabId) => emit('tab-drag-start', event, tabId),
});

const { t } = useI18n();

function tabIcon(tab: AnyProjectTab): string {
  if (isFileTab(tab)) return tab.icon;
  return tab.icon ?? 'i-heroicons-rectangle-stack';
}

function tabLabel(tab: AnyProjectTab): string {
  if (isFileTab(tab)) return tab.fileName;
  return tab.label;
}

function isDraggable(tab: AnyProjectTab): boolean {
  if (isFileTab(tab)) return true;
  return tab.id !== 'files';
}
</script>

<template>
  <div
    ref="tabBarRef"
    class="flex items-center border-b border-ui-border shrink-0 select-none transition-colors duration-150 min-h-[36px]"
    :class="isDropTarget ? 'bg-primary-500/10 border-primary-500/50' : ''"
    @dragover="onTabBarDragOver"
    @dragleave="onTabBarDragLeave"
    @drop="onTabBarDrop"
  >
    <div
      ref="tabContainerRef"
      class="flex items-center h-full flex-1 min-w-0 overflow-x-auto no-scrollbar"
    >
      <VueDraggable
        v-model="allTabsModel"
        class="flex items-center px-1 gap-0.5 py-1 min-w-max"
        :animation="150"
        ghost-class="project-tab-ghost"
        fallback-on-body
        force-fallback
      >
        <UContextMenu
          v-for="tab in allTabsModel"
          :key="tab.id"
          :items="isFileTab(tab) ? getFileTabContextMenuItems(tab.id) : getStaticTabContextMenuItems(tab.id)"
        >
          <div
            :data-tab-id="tab.id"
            class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0"
            :class="
              tabsStore.activeTabId === tab.id
                ? 'bg-selection-accent-500/15 text-selection-accent-400'
                : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
            "
            :title="tabLabel(tab)"
            :draggable="isDraggable(tab)"
            @mousedown="onTabMouseDown($event, tab)"
            @auxclick="onTabAuxClick($event, tab)"
            @dragstart="isDraggable(tab) ? onTabDragStart($event, tab) : undefined"
            @click="activateProjectTab(tab.id)"
          >
            <UIcon
              :name="tabIcon(tab)"
              class="w-3.5 h-3.5 shrink-0"
              :class="
                tabsStore.activeTabId === tab.id
                  ? 'text-selection-accent-400'
                  : 'text-ui-text-muted'
              "
            />
            <span
              class="text-2xs font-semibold tracking-wide truncate max-w-[140px]"
              :class="!isFileTab(tab) ? 'uppercase' : ''"
            >
              {{ tabLabel(tab) }}
            </span>

            <button
              v-if="isFileTab(tab)"
              class="ml-0.5 p-0.5 rounded hover:bg-red-500/15 hover:text-red-400 transition-colors"
              :title="t('common.close')"
              @click.stop="tabsStore.removeFileTab(tab.id)"
            >
              <UIcon name="i-heroicons-x-mark" class="w-3 h-3" />
            </button>
          </div>
        </UContextMenu>
      </VueDraggable>
    </div>

    <div
      v-if="isDropTarget"
      class="flex items-center gap-1 px-2 text-2xs text-primary-400 font-semibold uppercase tracking-wider shrink-0 pointer-events-none"
    >
      <UIcon name="i-heroicons-arrow-down-tray" class="w-3.5 h-3.5" />
      {{ t('videoEditor.projectTabs.dropHint') }}
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
