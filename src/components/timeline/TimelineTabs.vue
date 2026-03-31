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
  return name.replace(/\.[^.]+$/i, '');
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

function isMiddleClick(event: MouseEvent) {
  return event.button === 1;
}

function onTabMouseDown(event: MouseEvent) {
  if (!isMiddleClick(event)) return;
  event.preventDefault();
}

function onTabAuxClick(event: MouseEvent, path: string) {
  if (!isMiddleClick(event)) return;
  event.preventDefault();
  void projectStore.closeTimelineFile(path);
}

const timelineTabContextMenuItems = computed(() => {
  if (!currentTimelinePath.value) return [];

  const activePath = currentTimelinePath.value;

  return [
    [
      {
        label: 'Close',
        icon: 'i-heroicons-x-mark',
        onSelect: () => projectStore.closeTimelineFile(activePath),
      },
      {
        label: 'Close Others',
        icon: 'i-heroicons-minus-circle',
        onSelect: () => projectStore.closeOtherTimelineFiles(activePath),
      },
      {
        label: 'Close All',
        icon: 'i-heroicons-x-circle',
        onSelect: () => projectStore.closeAllTimelineFiles(),
      },
    ],
  ];
});

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
    <div
      ref="scrollContainer"
      class="flex h-full w-full overflow-x-auto no-scrollbar items-center min-w-0"
    >
      <div
        v-if="openPaths.length === 0"
        class="flex items-center h-full px-4 text-xs font-semibold uppercase tracking-wider text-ui-text-muted"
      >
        No timelines open
      </div>

      <UContextMenu v-else :items="timelineTabContextMenuItems" class="flex h-full min-w-max">
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
            class="group relative flex items-center h-full px-4 gap-2 border-r border-ui-border cursor-pointer min-w-[120px] max-w-[220px] transition-all duration-200 border-b"
            :class="[
              isActive(path)
                ? 'active-tab text-selection-accent-400 border-b-transparent'
                : 'text-ui-text-muted bg-black/10 hover:bg-black/5 hover:text-ui-text border-b-ui-border',
            ]"
            :title="path"
            @mousedown="onTabMouseDown($event)"
            @auxclick="onTabAuxClick($event, path)"
            @click="selectTab(path)"
          >
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

            <span class="text-2xs truncate flex-1 font-bold tracking-widest uppercase">
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
      </UContextMenu>
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
