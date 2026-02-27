<script setup lang="ts">
import { computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useProjectStore } from '~/stores/project.store';
import { storeToRefs } from 'pinia';

const projectStore = useProjectStore();
const { currentTimelinePath, projectSettings } = storeToRefs(projectStore);

const openPaths = computed({
  get: () => projectSettings.value.timelines.openPaths,
  set: (val) => projectStore.reorderTimelines(val),
});

function getFileName(path: string) {
  const name = path.split('/').pop() || path;
  return name.replace(/\.otio$/i, '');
}

function isActive(path: string) {
  return currentTimelinePath.value === path;
}

function selectTab(path: string) {
  projectStore.openTimelineFile(path);
}

function closeTab(path: string, event: Event) {
  event.stopPropagation();
  projectStore.closeTimelineFile(path);
}
</script>

<template>
  <div
    class="timeline-tabs flex items-center bg-ui-bg border-b border-ui-border h-9 overflow-hidden select-none"
  >
    <VueDraggable
      v-model="openPaths"
      class="flex h-full min-w-0 overflow-x-auto no-scrollbar"
      :animation="150"
      ghost-class="tab-ghost"
    >
      <div
        v-for="path in openPaths"
        :key="path"
        class="group relative flex items-center h-full px-4 gap-2 border-r border-ui-border cursor-pointer min-w-[120px] max-w-[220px] transition-all duration-200"
        :class="[
          isActive(path)
            ? 'active-tab text-primary-400 shadow-inner'
            : 'text-ui-text-muted hover:bg-ui-bg-elevated hover:text-ui-text',
        ]"
        @click="selectTab(path)"
      >
        <!-- Active Indicator Line -->
        <div v-if="isActive(path)" class="absolute top-0 left-0 right-0 h-0.5 bg-primary-500" />

        <UIcon
          name="i-heroicons-film-20-solid"
          class="w-4 h-4 shrink-0"
          :class="
            isActive(path)
              ? 'text-primary-500'
              : 'text-ui-text-disabled group-hover:text-ui-text-muted'
          "
        />

        <span class="text-[10px] truncate flex-1 font-bold tracking-widest uppercase">
          {{ getFileName(path) }}
        </span>

        <button
          class="tab-close-btn opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-red-500/10 hover:text-red-500 transition-all duration-200"
          @click="closeTab(path, $event)"
        >
          <UIcon name="i-heroicons-x-mark-20-solid" class="w-4 h-4" />
        </button>
      </div>
    </VueDraggable>
  </div>
</template>

<style scoped>
.timeline-tabs {
  scrollbar-width: none;
}
.timeline-tabs::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.tab-ghost {
  opacity: 0.3;
  background: rgba(var(--color-primary-500), 0.1);
}

.tab-close-btn {
  margin-right: -4px;
}

/* Glassmorphism subtle effect for active tab */
.active-tab {
  background: linear-gradient(to bottom, var(--ui-bg-elevated), var(--ui-bg));
}
</style>
