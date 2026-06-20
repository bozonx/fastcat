<script setup lang="ts">
import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import ClipProperties from '~/components/properties/ClipProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useProjectStore } from '~/stores/project.store';

const props = defineProps<{
  isOpen: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close' | 'open-delete-drawer' | 'open-trim-drawer' | 'open-transitions-drawer'): void;
}>();

const { width, height } = useWindowSize();
/** Landscape renders the drawer as a side panel, so the toolbar is a vertical rail. */
const toolbarOrientation = computed(() => (width.value > height.value ? 'vertical' : 'horizontal'));

/** Toolbar host: a top row in portrait, a full-height rail in landscape. */
const toolbarWrapperClass = computed(() =>
  toolbarOrientation.value === 'vertical'
    ? 'relative border-r border-ui-border bg-ui-bg-elevated flex flex-col h-full'
    : 'relative border-b border-ui-border bg-ui-bg-elevated flex flex-col w-full',
);

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const clipboardStore = useAppClipboard();
const uiStore = useUiStore();
const fileManagerStore = useFileManagerStore();
const focusStore = useFocusStore();
const fileManager = useFileManager();
const { setActiveTab } = useProjectTabsStore();
const projectStore = useProjectStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const currentClipAndTrack = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
  const track = timelineStore.timelineDoc?.tracks?.find((tr) => tr.id === entity.trackId) as
    | TimelineTrack
    | undefined;
  if (!track) return null;
  const item = track.items.find((i) => i.id === entity.itemId) as TimelineClipItem | undefined;
  if (!item || item.kind !== 'clip') return null;
  return { track, item };
});

const clip = computed(() => currentClipAndTrack.value?.item ?? null);
const clipTrack = computed(() => currentClipAndTrack.value?.track ?? null);
const clipTrackKind = computed(() => clipTrack.value?.kind ?? 'video');
const isLocked = computed(() => Boolean(clip.value?.locked || clipTrack.value?.locked));

const { handleToggleDisabled, handleToggleLocked, handleToggleMuted } = useClipPropertiesActions({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clip: clip as any,
  trackKind: clipTrackKind,
  timelineStore,
  projectStore,
  uiStore,
  fileManagerStore,
  selectionStore,
  focusStore,
  fileManager,
  setActiveTab,
});

function handleCopy() {
  if (!clip.value) return;
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'copy',
    items: timelineStore.copySelectedClips().map((i) => ({
      sourceTrackId: i.sourceTrackId,
      clip: i.clip,
    })),
  });
}

function handleCut() {
  if (!clip.value || isLocked.value) return;
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'cut',
    items: timelineStore.cutSelectedClips().map((i) => ({
      sourceTrackId: i.sourceTrackId,
      clip: i.clip,
    })),
  });
  emit('close');
}

function handleSplit() {
  if (!clip.value || isLocked.value) return;
  void timelineStore.splitClipAtPlayhead();
}

function handleOpenTrimPanel() {
  emit('open-trim-drawer');
}

function handleOpenTransitionsPanel() {
  emit('open-transitions-drawer');
}

function handleOpenDeleteDrawer() {
  if (isLocked.value) return;
  emit('open-delete-drawer');
}

const hasAudio = computed(() => {
  if (!clip.value) return false;
  return (
    clipTrack.value?.kind === 'audio' ||
    clip.value.clipType === 'media' ||
    clip.value.clipType === 'timeline'
  );
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    with-toolbar-snap
  >
    <template #toolbar>
      <div :class="toolbarWrapperClass">
        <MobileDrawerToolbar :orientation="toolbarOrientation" content-class="gap-1.5 px-2 py-1.5">
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :disabled="isLocked"
            @click="handleOpenDeleteDrawer"
          />

          <!-- 2. Copy -->
          <MobileDrawerToolbarButton icon="i-heroicons-document-duplicate" @click="handleCopy" />

          <!-- 3. Cut -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-scissors"
            :disabled="isLocked"
            @click="handleCut"
          />

          <!-- 4. Open Trim Panel -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-arrows-right-left"
            :disabled="isLocked"
            @click="handleOpenTrimPanel"
          />

          <!-- 5. Split -->
          <MobileDrawerToolbarButton
            icon="i-lucide-lab-razor-blade"
            :disabled="isLocked"
            @click="handleSplit"
          />

          <!-- 5b. Transitions (video tracks only) -->
          <MobileDrawerToolbarButton
            v-if="clipTrackKind === 'video'"
            icon="i-lucide-blend"
            :disabled="isLocked"
            @click="handleOpenTransitionsPanel"
          />

          <!-- 6. Active/disabled -->
          <MobileDrawerToolbarButton
            :icon="clip?.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            :active="clip?.disabled"
            @click="handleToggleDisabled"
          />

          <!-- 7. Mute -->
          <template v-if="hasAudio">
            <MobileDrawerToolbarButton
              :icon="clip?.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
              :active="clip?.audioMuted"
              @click="handleToggleMuted"
            />
          </template>

          <!-- 8. Locked -->
          <MobileDrawerToolbarButton
            :icon="clip?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
            :active="clip?.locked"
            @click="handleToggleLocked"
          />
        </MobileDrawerToolbar>
      </div>
    </template>

    <div v-if="clip" class="px-4 pb-8 pt-4">
      <ClipProperties :clip="clip" is-mobile />
    </div>
  </MobileTimelineDrawer>
</template>
