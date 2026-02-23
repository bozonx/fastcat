<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';

const props = defineProps<{
  tracks: TimelineTrack[];
}>();

const timelineStore = useTimelineStore();

const selectedTrackId = computed(() => timelineStore.selectedTrackId);

function onSelectTrack(trackId: string) {
  timelineStore.selectTrack(trackId);
}

function onDragStart(e: DragEvent, track: TimelineTrack) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(
    'application/json',
    JSON.stringify({ kind: 'timeline-track', trackId: track.id }),
  );
  e.dataTransfer.effectAllowed = 'move';
}

function onDrop(e: DragEvent, targetTrack: TimelineTrack) {
  const raw = e.dataTransfer?.getData('application/json');
  if (!raw) return;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (parsed?.kind !== 'timeline-track') return;
  const sourceId = String(parsed?.trackId ?? '');
  if (!sourceId) return;
  if (sourceId === targetTrack.id) return;

  const sourceTrack = props.tracks.find((t) => t.id === sourceId);
  if (!sourceTrack) return;
  if (sourceTrack.kind !== targetTrack.kind) return;

  const sameKindTracks = props.tracks.filter((t) => t.kind === targetTrack.kind);
  const sourceIdx = sameKindTracks.findIndex((t) => t.id === sourceTrack.id);
  const targetIdx = sameKindTracks.findIndex((t) => t.id === targetTrack.id);
  if (sourceIdx === -1 || targetIdx === -1) return;

  const nextSameKind = [...sameKindTracks];
  nextSameKind.splice(sourceIdx, 1);
  nextSameKind.splice(targetIdx, 0, sourceTrack);

  const otherKind = props.tracks.filter((t) => t.kind !== targetTrack.kind);
  const nextTracks =
    targetTrack.kind === 'video'
      ? [...nextSameKind, ...otherKind]
      : [...otherKind, ...nextSameKind];

  timelineStore.reorderTracks(nextTracks.map((t) => t.id));
}
</script>

<template>
  <div class="w-28 shrink-0 border-r border-gray-700 flex flex-col">
    <div class="h-6 border-b border-gray-700 bg-gray-850" />
    <div class="flex flex-col divide-y divide-gray-700 flex-1">
      <div
        v-for="track in tracks"
        :key="track.id"
        class="flex items-center px-2 h-10 text-xs font-medium cursor-pointer select-none"
        :class="
          selectedTrackId === track.id
            ? 'text-white bg-gray-800'
            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-850'
        "
        draggable="true"
        @dragstart="onDragStart($event, track)"
        @dragover.prevent
        @drop.prevent="onDrop($event, track)"
        @click="onSelectTrack(track.id)"
      >
        {{ track.name }}
      </div>
    </div>
  </div>
</template>
