<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue';

import { useMediaStore } from '~/stores/media.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import { useSelectionStore } from '~/stores/selection.store';
import { trackHasAudio } from '~/utils/audio';

import TimelineTrackLabelItem from '~/components/timeline/TimelineTrackLabelItem.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import { useTimelineEmptyAreaContextMenu } from '~/composables/timeline/useTimelineEmptyAreaContextMenu';
import { useTrackContextMenu } from '~/composables/timeline/useTrackContextMenu';
import { useExclusiveContextMenu } from '~/composables/ui/useExclusiveContextMenu';

const { t } = useI18n();

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  onZoomToFit?: () => void;
}>();

const emit = defineEmits<{
  (e: 'update:trackHeight', trackId: string, height: number): void;
  (e: 'scroll', event: Event): void;
}>();

const mediaStore = useMediaStore();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();

const labelsScrollContainer = ref<HTMLElement | null>(null);

defineExpose({ labelsScrollContainer });

const resizingTrackId = ref<string | null>(null);
const startY = ref(0);
const startHeight = ref(0);
const DEFAULT_TRACK_HEIGHT = 40;
const MIN_TRACK_HEIGHT = 32;
const MAX_TRACK_HEIGHT = 300;

// Pointer events (not mouse) so track height can also be resized with a finger
// or stylus. PointerEvent extends MouseEvent and fires identically for a mouse,
// so existing desktop behaviour is unchanged.
function onResizeStart(trackId: string, e: PointerEvent) {
  resizingTrackId.value = trackId;
  startY.value = e.clientY;
  startHeight.value = props.trackHeights[trackId] ?? DEFAULT_TRACK_HEIGHT;
  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerUp);
}

function onGlobalPointerMove(e: PointerEvent) {
  if (!resizingTrackId.value) return;
  const dy = e.clientY - startY.value;
  const nextHeight = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, startHeight.value + dy));
  emit('update:trackHeight', resizingTrackId.value, nextHeight);
}

function onGlobalPointerUp() {
  resizingTrackId.value = null;
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerUp);
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerUp);
});

const isConfirmDeleteOpen = ref(false);
const trackToDeleteId = ref<string | null>(null);
const selectedTrack = computed(() => props.tracks.find((t) => t.id === trackToDeleteId.value));

function requestDeleteTrack(track: TimelineTrack) {
  const skipConfirm = workspaceStore.userSettings.deleteWithoutConfirmation;
  if (track.items.length > 0 && !skipConfirm) {
    trackToDeleteId.value = track.id;
    isConfirmDeleteOpen.value = true;
  } else {
    timelineStore.deleteTrack(track.id);
  }
}

function confirmDelete() {
  if (trackToDeleteId.value) {
    timelineStore.deleteTrack(trackToDeleteId.value, { allowNonEmpty: true });
    trackToDeleteId.value = null;
  }
}

const trackNumbers = computed<Record<string, number>>(() => {
  const numbers: Record<string, number> = {};
  let remainingVideoTracks = props.tracks.filter((track) => track.kind === 'video').length;
  let audioTrackNumber = 1;

  for (const track of props.tracks) {
    if (track.kind === 'video') {
      numbers[track.id] = remainingVideoTracks;
      remainingVideoTracks -= 1;
      continue;
    }

    numbers[track.id] = audioTrackNumber;
    audioTrackNumber += 1;
  }

  return numbers;
});

/**
 * Track is "visually active" when the track itself OR any item (clip/gap/transition) on it is selected.
 * Used for background highlight and border brightness.
 */
function isTrackVisuallySelected(trackId: string) {
  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'timeline') {
    if (entity.kind === 'track') return entity.trackId === trackId;
    if (entity.kind === 'clip') return entity.trackId === trackId;
    if (entity.kind === 'gap') return entity.trackId === trackId;
    if (entity.kind === 'transition') return entity.trackId === trackId;
    if (entity.kind === 'clips') {
      const clips = entity as { items?: Array<{ trackId: string }> };
      if (clips.items) {
        return clips.items.some((item: { trackId: string }) => item.trackId === trackId);
      }
    }
  }
  return false;
}

/** Track is "directly selected" only when the track header itself was clicked (not a clip/gap/transition on it). */
function isTrackDirectlySelected(trackId: string) {
  const entity = selectionStore.selectedEntity;
  return entity?.source === 'timeline' && entity.kind === 'track' && entity.trackId === trackId;
}

function onSelectTrack(trackId: string) {
  timelineStore.selectTrack(trackId);
  selectionStore.selectTimelineTrack(trackId);
}

function onMiddleClickTrack(trackId: string, event: MouseEvent) {
  const action = workspaceStore.userSettings.mouse.trackHeaders.middleClick;
  if (action === 'select_all_clips') {
    timelineStore.selectAllClipsOnTrack(trackId, { append: event.shiftKey });
  } else if (action === 'select_track') {
    onSelectTrack(trackId);
  }
}

const renamingTrackId = ref<string | null>(null);

function handleRenameTrack(trackId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed) {
    const track = props.tracks.find((t) => t.id === trackId);
    if (track && trimmed !== track.name) {
      timelineStore.renameTrack(trackId, trimmed);
    }
  }
  renamingTrackId.value = null;
}

const { getTrackContextMenuItems } = useTrackContextMenu({
  onRequestDelete: (track) => requestDeleteTrack(track),
  onRequestRename: (track) => {
    renamingTrackId.value = track.id;
  },
});

const trackContextMenuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
const activeTrackForContextMenu = ref<TimelineTrack | null>(null);

function onTrackContextMenu(e: MouseEvent, track: TimelineTrack) {
  activeTrackForContextMenu.value = track;
  trackContextMenuRef.value?.open(e);
}

const activeTrackContextMenuItems = computed(() => {
  if (!activeTrackForContextMenu.value) return [];
  return getTrackContextMenuItems(activeTrackForContextMenu.value, props.tracks);
});

const { emptyAreaContextMenuItems: propertiesContextMenuItems } = useTimelineEmptyAreaContextMenu({
  onZoomToFit: () => props.onZoomToFit?.(),
});
const {
  isContextMenuOpen: isPropertiesContextMenuOpen,
  setContextMenuOpen: setPropertiesContextMenuOpen,
} = useExclusiveContextMenu();
</script>

<template>
  <UContextMenu
    :open="isPropertiesContextMenuOpen"
    :items="propertiesContextMenuItems"
    @update:open="setPropertiesContextMenuOpen"
  >
    <div
      v-bind="$attrs"
      ref="labelsScrollContainer"
      class="h-full overflow-y-scroll overflow-x-hidden labels-scroll-container bg-ui-bg"
      @scroll="emit('scroll', $event)"
      @click="
        timelineStore.selectTimelineProperties();
        selectionStore.selectTimelineProperties();
      "
    >
      <div class="flex flex-col min-h-full">
        <UiContextMenuPortal
          ref="trackContextMenuRef"
          :items="activeTrackContextMenuItems"
          :target-el="labelsScrollContainer"
          manual
        />

        <template v-for="(track, index) in tracks" :key="track.id">
          <TimelineTrackLabelItem
            :track="track"
            :track-number="trackNumbers[track.id] ?? index + 1"
            :height="trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT"
            :is-selected="isTrackVisuallySelected(track.id)"
            :is-directly-selected="isTrackDirectlySelected(track.id)"
            :is-hovered="timelineStore.hoveredTrackId === track.id"
            :is-renaming="renamingTrackId === track.id"
            :has-audio="trackHasAudio(track, mediaStore.mediaMetadata)"
            :level-db="timelineStore.audioLevels?.[track.id]?.peakDb"
            @select="onSelectTrack(track.id)"
            @middle-click="(e: MouseEvent) => onMiddleClickTrack(track.id, e)"
            @request-rename="renamingTrackId = track.id"
            @rename="(name) => handleRenameTrack(track.id, name)"
            @cancel-rename="renamingTrackId = null"
            @resize-start="(e: PointerEvent) => onResizeStart(track.id, e)"
            @mouseenter="timelineStore.hoveredTrackId = track.id"
            @mouseleave="timelineStore.hoveredTrackId = null"
            @contextmenu.prevent.stop="onTrackContextMenu($event, track)"
          />
        </template>
        <div class="w-full flex-1 min-h-7 shrink-0" />
        <!-- Trailing spacer mirrors TimelineTracks.vue so labels and tracks share
             identical scroll content height and stay vertically aligned. -->
        <div class="h-16 shrink-0" />
      </div>
    </div>

    <UiConfirmModal
      v-if="selectedTrack"
      v-model:open="isConfirmDeleteOpen"
      :title="t('fastcat.timeline.deleteTrackTitle')"
      :description="t('fastcat.timeline.deleteTrackDescription')"
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete')"
      @confirm="confirmDelete"
    />
  </UContextMenu>
</template>

<style scoped>
/* Hide scrollbar while keeping scroll functionality for JS-synced scroll */
.labels-scroll-container::-webkit-scrollbar {
  display: none;
}
.labels-scroll-container {
  scrollbar-width: none;
}
</style>
