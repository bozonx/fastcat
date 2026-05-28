<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { storeToRefs } from 'pinia';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const { currentTimelinePath, projectSettings } = storeToRefs(projectStore);
const { loadTimeline } = useProjectActions();
const { getHotkeyTitle } = useHotkeyLabel();
const { t } = useI18n();

const scrollContainer = ref<HTMLElement | null>(null);

const openPaths = computed({
  get: () => projectSettings.value.timelines.openPaths,
  set: (val) => projectStore.reorderTimelines(val),
});

interface PendingClose {
  type: 'single' | 'others' | 'all';
  path?: string;
  dirtyPaths: string[];
}

const pendingClose = ref<PendingClose | null>(null);

const isConfirmOpen = computed({
  get: () => pendingClose.value !== null,
  set: (val) => {
    if (!val) pendingClose.value = null;
  },
});

const confirmTitle = computed(() => {
  return t('videoEditor.timeline.closeUnsavedTitle');
});

const confirmDescription = computed(() => {
  if (!pendingClose.value) return '';
  if (pendingClose.value.type === 'single' && pendingClose.value.path) {
    return t('videoEditor.timeline.closeUnsavedMessage', {
      name: getFileName(pendingClose.value.path),
    });
  }
  return t('videoEditor.timeline.closeUnsavedMessageMultiple');
});

function getFileName(path: string) {
  const name = path.split('/').pop() || path;
  return name.replace(/\.[^.]+$/i, '');
}

function isActive(path: string) {
  return currentTimelinePath.value === path;
}

function isDirty(path: string) {
  return timelineStore.isPathDirty(path);
}

function selectTab(path: string) {
  loadTimeline(path);
}

function confirmCloseTab(path: string) {
  if (isDirty(path)) {
    pendingClose.value = {
      type: 'single',
      path,
      dirtyPaths: [path],
    };
  } else {
    projectStore.closeTimelineFile(path);
  }
}

function confirmCloseOthers(activePath: string) {
  const dirty = openPaths.value.filter((p) => p !== activePath && isDirty(p));
  if (dirty.length > 0) {
    pendingClose.value = {
      type: 'others',
      path: activePath,
      dirtyPaths: dirty,
    };
  } else {
    projectStore.closeOtherTimelineFiles(activePath);
  }
}

function confirmCloseAll() {
  const dirty = openPaths.value.filter((p) => isDirty(p));
  if (dirty.length > 0) {
    pendingClose.value = {
      type: 'all',
      dirtyPaths: dirty,
    };
  } else {
    projectStore.closeAllTimelineFiles();
  }
}

async function handleConfirmClose() {
  if (!pendingClose.value) return;
  const { type, path, dirtyPaths } = pendingClose.value;
  pendingClose.value = null;

  timelineStore.skipRecoveryDialog = true;
  try {
    for (const p of dirtyPaths) {
      if (currentTimelinePath.value === p) {
        await timelineStore.saveTimeline();
      } else {
        await loadTimeline(p);
        await timelineStore.saveTimeline();
      }
    }

    if (type === 'single' && path) {
      await projectStore.closeTimelineFile(path);
    } else if (type === 'others' && path) {
      await projectStore.closeOtherTimelineFiles(path);
    } else if (type === 'all') {
      await projectStore.closeAllTimelineFiles();
    }
  } finally {
    timelineStore.skipRecoveryDialog = false;
  }
}

async function handleDiscardClose() {
  if (!pendingClose.value) return;
  const { type, path, dirtyPaths } = pendingClose.value;
  pendingClose.value = null;

  timelineStore.skipRecoveryDialog = true;
  try {
    for (const p of dirtyPaths) {
      await timelineStore.deleteTimelineAutosaveFile(p);
    }

    if (type === 'single' && path) {
      await projectStore.closeTimelineFile(path);
    } else if (type === 'others' && path) {
      await projectStore.closeOtherTimelineFiles(path);
    } else if (type === 'all') {
      await projectStore.closeAllTimelineFiles();
    }
  } finally {
    timelineStore.skipRecoveryDialog = false;
  }
}

function closeTab(path: string, event: Event) {
  event.stopPropagation();
  confirmCloseTab(path);
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
  void confirmCloseTab(path);
}

const timelineTabContextMenuItems = computed(() => {
  if (!currentTimelinePath.value) return [];

  const activePath = currentTimelinePath.value;

  return [
    [
      {
        label: 'Close',
        icon: 'i-heroicons-x-mark',
        onSelect: () => confirmCloseTab(activePath),
      },
      {
        label: 'Close Others',
        icon: 'i-heroicons-minus-circle',
        onSelect: () => confirmCloseOthers(activePath),
      },
      {
        label: 'Close All',
        icon: 'i-heroicons-x-circle',
        onSelect: () => confirmCloseAll(),
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
            v-for="(path, index) in openPaths"
            :key="path"
            :data-path="path"
            class="group relative flex items-center h-full px-4 gap-2 border-r border-ui-border cursor-pointer min-w-[120px] max-w-[220px] transition-all duration-200 border-b"
            :class="[
              isActive(path)
                ? 'active-tab text-selection-accent-400 border-b-transparent'
                : 'text-ui-text-muted bg-black/10 hover:bg-black/5 hover:text-ui-text border-b-ui-border',
            ]"
            :title="
              index < 9
                ? getHotkeyTitle(path, ('general.tab' + (index + 1)) as HotkeyCommandId)
                : path
            "
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

            <span
              v-if="isDirty(path)"
              class="w-2 h-2 rounded-full bg-amber-400 ring-2 ring-amber-400/20 shrink-0"
              :title="$t('videoEditor.timeline.unsavedChanges')"
            />

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

    <UiConfirmModal
      v-model:open="isConfirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-text="$t('common.save')"
      :secondary-text="$t('common.dontSave')"
      :cancel-text="$t('common.cancel')"
      color="primary"
      secondary-color="error"
      icon="i-heroicons-exclamation-triangle"
      @confirm="handleConfirmClose"
      @secondary="handleDiscardClose"
    />
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
  background: color-mix(in srgb, var(--color-primary-500) 10%, transparent);
}

.tab-close-btn {
  margin-right: -4px;
}

/* Glassmorphism subtle effect for active tab */
.active-tab {
  background: linear-gradient(to bottom, var(--ui-bg-elevated), var(--ui-bg));
}
</style>
