<script setup lang="ts">
import { computed, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useProjectStore } from '~/stores/project.store';
import { storeToRefs } from 'pinia';

const projectStore = useProjectStore();
const { currentTimelinePath, projectSettings } = storeToRefs(projectStore);

const scrollContainer = ref<HTMLElement | null>(null);

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

function onWheel(e: WheelEvent) {
  const el = scrollContainer.value;
  if (!el) return;

  // Use both vertical and horizontal scroll to scroll horizontally
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  
  if (delta !== 0) {
    el.scrollLeft += delta;
    e.preventDefault();
  }
}
</script>

<template>
  <div
    class="timeline-tabs flex items-center h-full min-w-0 flex-1 select-none"
  >
    <div 
      ref="scrollContainer"
      class="flex h-full w-full overflow-x-auto no-scrollbar items-center"
      @wheel="onWheel"
    >
      <VueDraggable
        v-model="openPaths"
        class="flex h-full items-center"
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
  </div>
</template>

<style scoped>
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
