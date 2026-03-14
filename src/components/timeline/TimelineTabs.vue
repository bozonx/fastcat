<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useProjectStore } from '~/stores/project.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { storeToRefs } from 'pinia';

const projectStore = useProjectStore();
const { currentTimelinePath, projectSettings } = storeToRefs(projectStore);
const { loadTimeline } = useProjectActions();

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
  loadTimeline(path);
}

function closeTab(path: string, event: Event) {
  event.stopPropagation();
  projectStore.closeTimelineFile(path);
}

watch(currentTimelinePath, async (newPath) => {
  if (!newPath) return;
  await nextTick();
  const el = scrollContainer.value;
  if (!el) return;
  const activeEl = el.querySelector(`[data-path="${CSS.escape(newPath)}"]`) as HTMLElement | null;
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
});

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

onMounted(() => {
  scrollContainer.value?.addEventListener('wheel', onWheel, { passive: false });
});

onBeforeUnmount(() => {
  scrollContainer.value?.removeEventListener('wheel', onWheel);
});
</script>

<template>
  <div class="timeline-tabs flex items-center h-full min-w-0 flex-1 select-none">
    <div ref="scrollContainer" class="flex h-full w-full overflow-x-auto no-scrollbar items-center">
      <VueDraggable
        v-model="openPaths"
        class="flex h-full items-center"
        :animation="150"
        ghost-class="tab-ghost"
      >
        <div
          v-for="path in openPaths"
          :key="path"
          :data-path="path"
          class="group relative flex items-center h-full px-4 gap-2 border-r border-ui-border cursor-pointer min-w-30 max-w-55 transition-all duration-200 border-b"
          :class="[
            isActive(path)
              ? 'active-tab text-primary-400 border-b-transparent'
              : 'text-ui-text-muted bg-black/10 hover:bg-black/5 hover:text-ui-text border-b-ui-border',
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
            class="tab-close-btn text-ui-text-muted hover:bg-red-500/10 hover:text-red-500 p-0.5 rounded-md transition-all duration-200"
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
