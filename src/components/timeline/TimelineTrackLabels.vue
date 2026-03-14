<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue';

import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import type { TimelineTrack } from '~/timeline/types';
import { useSelectionStore } from '~/stores/selection.store';

import TrackLabelItem from '~/components/timeline/TrackLabelItem.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import { useDraggedFile } from '~/composables/useDraggedFile';

const { t } = useI18n();

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  scrollbarCompensation?: number;
}>();

const emit = defineEmits<{
  (e: 'update:trackHeight', trackId: string, height: number): void;
  (e: 'scroll', event: Event): void;
}>();

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const settingsStore = useTimelineSettingsStore();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();

const labelsScrollContainer = ref<HTMLElement | null>(null);

defineExpose({ labelsScrollContainer });

const resizingTrackId = ref<string | null>(null);
const startY = ref(0);
const startHeight = ref(0);
const DEFAULT_TRACK_HEIGHT = 40;
const MIN_TRACK_HEIGHT = 32;
const MAX_TRACK_HEIGHT = 300;

function onResizeStart(trackId: string, e: MouseEvent) {
  resizingTrackId.value = trackId;
  startY.value = e.clientY;
  startHeight.value = props.trackHeights[trackId] ?? DEFAULT_TRACK_HEIGHT;
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function onGlobalMouseMove(e: MouseEvent) {
  if (!resizingTrackId.value) return;
  const dy = e.clientY - startY.value;
  const nextHeight = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, startHeight.value + dy));
  emit('update:trackHeight', resizingTrackId.value, nextHeight);
}

function onGlobalMouseUp() {
  resizingTrackId.value = null;
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
});

const isConfirmDeleteOpen = ref(false);
const trackToDeleteId = ref<string | null>(null);
const selectedTrack = computed(() => props.tracks.find((t) => t.id === trackToDeleteId.value));

function requestDeleteTrack(track: TimelineTrack) {
  if (track.items.length > 0) {
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

const selectedTrackId = computed(() => timelineStore.selectedTrackId);

function onSelectTrack(trackId: string) {
  if (timelineStore.selectedTrackId === trackId) {
    const entity = selectionStore.selectedEntity;
    if (entity?.source === 'timeline' && entity.kind === 'timeline-properties') {
      timelineStore.selectTrack(trackId);
      selectionStore.selectTimelineTrack(trackId);
    } else {
      timelineStore.selectTimelineProperties();
    }
  } else {
    timelineStore.selectTrack(trackId);
    selectionStore.selectTimelineTrack(trackId);
  }
}

function getTrackContextMenuItems(track: TimelineTrack) {
  const kind = track.kind;
  const otherIdx = props.tracks.filter((tr) => tr.kind === kind).length + 1;

  return [
    [
      {
        label: t(`fastcat.timeline.add${kind === 'video' ? 'Video' : 'Audio'}TrackAbove`),
        icon: kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
        onSelect: () =>
          timelineStore.addTrack(kind, `${kind === 'video' ? 'Video' : 'Audio'} ${otherIdx}`, {
            insertBeforeId: track.id,
          }),
      },
      {
        label: t(`fastcat.timeline.add${kind === 'video' ? 'Video' : 'Audio'}TrackBelow`),
        icon: kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
        onSelect: () =>
          timelineStore.addTrack(kind, `${kind === 'video' ? 'Video' : 'Audio'} ${otherIdx}`, {
            insertAfterId: track.id,
          }),
      },
    ],
    [
      {
        label: t('fastcat.timeline.renameTrack'),
        icon: 'i-heroicons-pencil',
        onSelect: () => {
          timelineStore.renamingTrackId = track.id;
        },
      },
      {
        label: t('fastcat.timeline.deleteTrack'),
        icon: 'i-heroicons-trash',
        onSelect: () => requestDeleteTrack(track),
      },
    ],
  ];
}

const emptyAreaContextMenuItems = [
  [
    {
      label: t('fastcat.timeline.addVideoTrack'),
      icon: 'i-heroicons-video-camera',
      onSelect: () =>
        timelineStore.addTrack(
          'video',
          `Video ${props.tracks.filter((t) => t.kind === 'video').length + 1}`,
        ),
    },
    {
      label: t('fastcat.timeline.addAudioTrack'),
      icon: 'i-heroicons-musical-note',
      onSelect: () =>
        timelineStore.addTrack(
          'audio',
          `Audio ${props.tracks.filter((t) => t.kind === 'audio').length + 1}`,
        ),
    },
  ],
];

function addTextClip() {
  timelineStore.addTextClipAtPlayhead({
    name: t('fastcat.timeline.textClipDefaultName'),
    text: t('fastcat.timeline.textClipDefaultText'),
  });
}

function toggleClipSnapMode() {
  settingsStore.setClipSnapMode(settingsStore.clipSnapMode === 'clips' ? 'none' : 'clips');
}

function onDragVirtualStart(
  event: DragEvent,
  type: 'adjustment' | 'background' | 'text',
) {
  setDraggedFile({
    kind: type,
    name: t(`fastcat.timeline.${type}ClipDefaultName`, type.charAt(0).toUpperCase() + type.slice(1)),
    path: '',
  });
}

function onDragVirtualEnd() {
  clearDraggedFile();
}
</script>

<template>
  <div class="h-full w-full shrink-0 border-r border-ui-border flex flex-col bg-ui-bg">
    <TimelineToolbar
      :is-snap-active="settingsStore.clipSnapMode === 'clips'"
      @toggle-snap="toggleClipSnapMode"
      @select-properties="timelineStore.selectTimelineProperties()"
      @split="timelineStore.splitClipsAtPlayhead()"
      @drag-virtual-start="onDragVirtualStart"
      @drag-virtual-end="onDragVirtualEnd"
    />

    <div
      ref="labelsScrollContainer"
      class="flex-1 overflow-y-scroll overflow-x-hidden labels-scroll-container pb-16"
      @scroll="emit('scroll', $event)"
      @click="timelineStore.selectTimelineProperties()"
    >
      <div class="flex flex-col min-h-full">
        <UContextMenu
          v-for="track in tracks"
          :key="track.id"
          :items="getTrackContextMenuItems(track)"
        >
          <TrackLabelItem
            :track="track"
            :height="trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT"
            :is-selected="selectedTrackId === track.id"
            :is-hovered="timelineStore.hoveredTrackId === track.id"
            :is-renaming="timelineStore.renamingTrackId === track.id"
            @select="onSelectTrack(track.id)"
            @rename="(name) => timelineStore.renameTrack(track.id, name)"
            @cancel-rename="timelineStore.renamingTrackId = null"
            @resize-start="(e) => onResizeStart(track.id, e)"
            @mouseenter="timelineStore.hoveredTrackId = track.id"
            @mouseleave="timelineStore.hoveredTrackId = null"
          />
        </UContextMenu>
      </div>
    </div>

    <UiConfirmModal
      v-if="selectedTrack"
      v-model:open="isConfirmDeleteOpen"
      :title="t('fastcat.timeline.deleteTrackTitle', 'Delete track?')"
      :description="
        t(
          'fastcat.timeline.deleteTrackDescription',
          'Track is not empty. This action cannot be undone.',
        )
      "
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDelete"
    />
  </div>
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
