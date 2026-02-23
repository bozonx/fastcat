<script setup lang="ts">
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import { timeUsToPx } from '~/composables/timeline/useTimelineInteraction';

const { t } = useI18n();
const timelineStore = useTimelineStore();

defineProps<{
  tracks: TimelineTrack[];
}>();

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: MouseEvent, trackId: string, itemId: string, startUs: number): void;
  (e: 'selectItem', event: MouseEvent, itemId: string): void;
  (
    e: 'clipAction',
    payload: {
      action: 'extractAudio' | 'returnAudio';
      trackId: string;
      itemId: string;
      videoItemId?: string;
    },
  ): void;
  (
    e: 'startTrimItem',
    event: MouseEvent,
    payload: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ): void;
}>();

function getClipContextMenuItems(track: TimelineTrack, item: any) {
  if (!item || item.kind !== 'clip') return [];

  const menuItems: any[] = [];

  const canExtract = track.kind === 'video' && !item.audioFromVideoDisabled;
  if (canExtract) {
    menuItems.push({
      label: t('granVideoEditor.timeline.extractAudio', 'Extract audio to audio track'),
      icon: 'i-heroicons-musical-note',
      onSelect: () => emit('clipAction', { action: 'extractAudio', trackId: track.id, itemId: item.id }),
    });
  }

  const hasReturnFromVideoClip =
    track.kind === 'video' &&
    Boolean(item.audioFromVideoDisabled) &&
    (timelineStore.timelineDoc?.tracks ?? []).some((t: any) =>
      t.kind !== 'audio'
        ? false
        : (t.items ?? []).some(
            (it: any) =>
              it.kind === 'clip' && it.linkedVideoClipId === item.id && Boolean(it.lockToLinkedVideo),
          ),
    );

  const hasReturnFromLockedAudioClip =
    track.kind === 'audio' && Boolean(item.linkedVideoClipId) && Boolean(item.lockToLinkedVideo);

  if (hasReturnFromVideoClip) {
    menuItems.push({
      label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
      icon: 'i-heroicons-arrow-uturn-left',
      onSelect: () => emit('clipAction', { action: 'returnAudio', trackId: track.id, itemId: item.id }),
    });
  } else if (hasReturnFromLockedAudioClip) {
    menuItems.push({
      label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
      icon: 'i-heroicons-arrow-uturn-left',
      onSelect: () =>
        emit('clipAction', {
          action: 'returnAudio',
          trackId: track.id,
          itemId: item.id,
          videoItemId: String(item.linkedVideoClipId),
        }),
    });
  }

  return menuItems.length > 0 ? [menuItems] : [];
}
</script>

<template>
  <div
    class="flex flex-col divide-y divide-gray-700"
    @mousedown="
      timelineStore.clearSelection();
      timelineStore.selectTrack(null);
    "
  >
    <div
      v-for="track in tracks"
      :key="track.id"
      class="h-10 flex items-center px-2 relative"
      :class="timelineStore.selectedTrackId === track.id ? 'bg-gray-850/60' : ''"
      @dragover.prevent
      @drop.prevent="emit('drop', $event, track.id)"
    >
      <div
        class="absolute inset-y-1 left-2 right-2 rounded bg-gray-800 border border-dashed border-gray-700 flex items-center justify-center"
      >
        <span v-if="track.items.length === 0" class="text-xs text-gray-700">
          {{ t('granVideoEditor.timeline.dropClip', 'Drop clip here') }}
        </span>
      </div>

      <UContextMenu
        v-for="item in track.items"
        :key="item.id"
        :items="getClipContextMenuItems(track, item)"
      >
        <div
          class="absolute inset-y-1 rounded px-2 flex items-center text-xs text-white z-10 cursor-pointer select-none transition-shadow"
          :draggable="item.kind === 'clip'"
          @dragstart="
            (e) => {
              if (!e.dataTransfer) return;
              if (item.kind !== 'clip') return;
              const payload = JSON.stringify({
                kind: 'timeline-clip',
                itemId: item.id,
                fromTrackId: track.id,
              });
              e.dataTransfer.setData('application/json', payload);
              e.dataTransfer.setData('text/plain', payload);
              e.dataTransfer.effectAllowed = 'move';
            }
          "
          :class="[
            item.kind === 'gap'
              ? 'bg-gray-800/40 border border-dashed border-gray-600 text-gray-400 opacity-60'
              : track.kind === 'audio'
                ? 'bg-teal-600 border border-teal-400 hover:bg-teal-500'
                : 'bg-indigo-600 border border-indigo-400 hover:bg-indigo-500',
            timelineStore.selectedItemIds.includes(item.id) ? 'ring-2 ring-white z-20 shadow-lg' : '',
          ]"
          :style="{
            left: `${2 + timeUsToPx(item.timelineRange.startUs)}px`,
            width: `${Math.max(30, timeUsToPx(item.timelineRange.durationUs))}px`,
          }"
          @mousedown="
            emit('startMoveItem', $event, item.trackId, item.id, item.timelineRange.startUs)
          "
          @click.stop="emit('selectItem', $event, item.id)"
        >
        <div
          v-if="item.kind === 'clip'"
          class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white/50"
          @mousedown="
            emit('startTrimItem', $event, {
              trackId: item.trackId,
              itemId: item.id,
              edge: 'start',
              startUs: item.timelineRange.startUs,
            })
          "
        />
        <span class="truncate" :title="item.kind === 'clip' ? item.name : 'gap'">{{
          item.kind === 'clip' ? item.name : 'gap'
        }}</span>
        <div
          v-if="item.kind === 'clip'"
          class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white/50"
          @mousedown="
            emit('startTrimItem', $event, {
              trackId: item.trackId,
              itemId: item.id,
              edge: 'end',
              startUs: item.timelineRange.startUs,
            })
          "
        />
        </div>
      </UContextMenu>
    </div>
  </div>
</template>
