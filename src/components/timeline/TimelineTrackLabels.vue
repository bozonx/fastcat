<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue';

import { useMediaStore } from '~/stores/media.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import { useSelectionStore } from '~/stores/selection.store';
import { trackHasAudio } from '~/utils/audio';

import TimelineTrackLabelItem from '~/components/timeline/TimelineTrackLabelItem.vue';

const { t } = useI18n();

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  scrollbarCompensation?: number;
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

const selectedTrackId = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'timeline') {
    if (entity.kind === 'track') return entity.trackId;
    if (entity.kind === 'clip') return entity.trackId;
    if (entity.kind === 'transition') return entity.trackId;
    if (entity.kind === 'clips') {
      const clips = entity as any;
      if (clips.items && clips.items.length > 0) return clips.items[0].trackId;
    }
  }
  return null;
});

// A helper to determine if a specific track is "visually selected".
// A track is visually selected if the track itself is selected OR if any clips/transitions on it are selected.
function isTrackVisuallySelected(trackId: string) {
  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'timeline') {
    if (entity.kind === 'track') return entity.trackId === trackId;
    if (entity.kind === 'clip') return entity.trackId === trackId;
    if (entity.kind === 'transition') return entity.trackId === trackId;
    if (entity.kind === 'clips') {
      const clips = entity as any;
      if (clips.items) {
        return clips.items.some((item: any) => item.trackId === trackId);
      }
    }
  }
  return false;
}

function onSelectTrack(trackId: string) {
  if (timelineStore.selectedTrackId === trackId) {
    const entity = selectionStore.selectedEntity;
    if (entity?.source === 'timeline' && entity.kind === 'timeline-properties') {
      timelineStore.selectTrack(trackId);
      selectionStore.selectTimelineTrack(trackId);
    } else {
      timelineStore.selectTimelineProperties();
      selectionStore.selectTimelineProperties();
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
        label: track.locked
          ? t('fastcat.track.unlock', 'Unlock track')
          : t('fastcat.track.lock', 'Lock track'),
        icon: track.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
        onSelect: () => {
          timelineStore.updateTrackProperties(track.id, { locked: !track.locked });
        },
      },
      {
        label: t('fastcat.timeline.deleteTrack'),
        icon: 'i-heroicons-trash',
        onSelect: () => requestDeleteTrack(track),
      },
    ],
    [
      {
        label: t('fastcat.track.moveUp', 'Move track up'),
        icon: 'i-heroicons-arrow-up',
        disabled: props.tracks.filter((t) => t.kind === track.kind)[0]?.id === track.id,
        onSelect: () => timelineStore.moveTrackUp(track.id),
      },
      {
        label: t('fastcat.track.moveDown', 'Move track down'),
        icon: 'i-heroicons-arrow-down',
        disabled: props.tracks.filter((t) => t.kind === track.kind).slice(-1)[0]?.id === track.id,
        onSelect: () => timelineStore.moveTrackDown(track.id),
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

const propertiesContextMenuItems = [
  [
    {
      label: t('fastcat.timeline.zoomToFit'),
      icon: 'i-heroicons-arrows-pointing-out',
      onSelect: () => props.onZoomToFit?.(),
    },
    {
      label: t('fastcat.timeline.properties.title'),
      icon: 'i-heroicons-cog-6-tooth',
      onSelect: () => {
        timelineStore.selectTimelineProperties();
        selectionStore.selectTimelineProperties();
      },
    },
  ],
];
</script>

<template>
  <div class="h-full w-full shrink-0 flex flex-col bg-ui-bg">
    <UContextMenu :items="propertiesContextMenuItems">
      <div
        ref="labelsScrollContainer"
        class="flex-1 overflow-y-scroll overflow-x-hidden labels-scroll-container"
        @scroll="emit('scroll', $event)"
        @click="
          timelineStore.selectTimelineProperties();
          selectionStore.selectTimelineProperties();
        "
      >
        <div class="flex flex-col min-h-full">
          <UContextMenu
            v-for="(track, index) in tracks"
            :key="track.id"
            :items="getTrackContextMenuItems(track)"
          >
            <TimelineTrackLabelItem
              :track="track"
              :track-number="
                track.kind === 'video'
                  ? tracks.filter((t) => t.kind === 'video').length -
                    tracks.filter((t, i) => t.kind === 'video' && i < index).length
                  : tracks.filter((t, i) => t.kind === 'audio' && i < index).length + 1
              "
              :height="trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT"
              :is-selected="isTrackVisuallySelected(track.id)"
              :is-hovered="timelineStore.hoveredTrackId === track.id"
              :is-renaming="timelineStore.renamingTrackId === track.id"
              :has-audio="trackHasAudio(track, mediaStore.mediaMetadata)"
              :level-db="timelineStore.audioLevels?.[track.id]?.peakDb"
              @select="onSelectTrack(track.id)"
              @rename="
                (name: string) => {
                  timelineStore.renameTrack(track.id, name);
                  timelineStore.renamingTrackId = null;
                }
              "
              @cancel-rename="timelineStore.renamingTrackId = null"
              @resize-start="(e: MouseEvent) => onResizeStart(track.id, e)"
              @mouseenter="timelineStore.hoveredTrackId = track.id"
              @mouseleave="timelineStore.hoveredTrackId = null"
            />
          </UContextMenu>
          <div class="w-full flex-1 min-h-7 shrink-0" />
          <div
            class="shrink-0"
            :style="{ height: `calc(4rem + ${scrollbarCompensation || 0}px)` }"
          />
        </div>
      </div>
    </UContextMenu>

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
