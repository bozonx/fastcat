<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import type { AnyProjectTab } from '~/stores/tabs.store';
import { useProjectTabs } from '~/composables/project/useProjectTabs';

const emit = defineEmits<{
  (e: 'tab-drag-start', event: DragEvent, tabId: string): void;
}>();

const {
  activateProjectTab,
  fileTabsModel,
  isDropTarget,
  onFileTabAuxClick,
  onFileTabDragStart,
  onFileTabMouseDown,
  onStaticTabAuxClick,
  onStaticTabDragStart,
  onStaticTabMouseDown,
  onTabBarDragLeave,
  onTabBarDragOver,
  onTabBarDrop,
  projectTabContextMenuItems,
  staticTabs,
  tabBarRef,
  tabContainerRef,
  tabsStore,
} = useProjectTabs({
  onStaticTabDragStart: (event, tabId) => emit('tab-drag-start', event, tabId),
});

const { t } = useI18n();

function handleStaticTabDragStart(event: DragEvent, tab: AnyProjectTab) {
  onStaticTabDragStart(event, tab);
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
          @dragstart="tab.id !== 'files' ? handleStaticTabDragStart($event, tab) : undefined"
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
                :class="
                  tabsStore.activeTabId === tab.id ? 'text-primary-400' : 'text-ui-text-muted'
                "
              />
              <span class="text-[10px] font-semibold tracking-wide truncate max-w-[140px]">
                {{ tab.fileName }}
              </span>
            </div>

            <button
              class="ml-0.5 p-0.5 rounded hover:bg-red-500/15 hover:text-red-400 transition-colors"
              :title="t('common.close', 'Close')"
              @click.stop="tabsStore.removeFileTab(tab.id)"
            >
              <UIcon name="i-heroicons-x-mark" class="w-3 h-3" />
            </button>
          </div>
        </VueDraggable>
      </UContextMenu>
    </div>

    <div
      v-if="isDropTarget"
      class="flex items-center gap-1 px-2 text-[10px] text-primary-400 font-semibold uppercase tracking-wider shrink-0 pointer-events-none"
    >
      <UIcon name="i-heroicons-arrow-down-tray" class="w-3.5 h-3.5" />
      {{ t('videoEditor.projectTabs.dropHint', 'Add as tab') }}
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
