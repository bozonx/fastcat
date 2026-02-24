<script setup lang="ts">
import ClipTransitionPanel from './ClipTransitionPanel.vue';
import { ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import { timeUsToPx } from '~/composables/timeline/useTimelineInteraction';

const { t } = useI18n();
const timelineStore = useTimelineStore();

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  dragPreview?: {
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null;
}>();

const DEFAULT_TRACK_HEIGHT = 40;

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: MouseEvent, trackId: string, itemId: string, startUs: number): void;
  (e: 'selectItem', event: MouseEvent, itemId: string): void;
  (
    e: 'clipAction',
    payload: {
      action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
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

// Reactive state for the currently open transition panel
const openTransitionPanel = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  anchorEl: HTMLElement | null;
} | null>(null);

function handleTransitionUpdate(payload: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  transition: import('~/timeline/types').ClipTransition | null;
}) {
  if (payload.edge === 'in') {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionIn: payload.transition,
    });
  } else {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionOut: payload.transition,
    });
  }
  openTransitionPanel.value = null;
}

function getClipContextMenuItems(track: TimelineTrack, item: any) {
  if (!item) return [];

  const mainGroup: any[] = [];

  if (item.kind === 'clip') {
    const canExtract = track.kind === 'video' && !item.audioFromVideoDisabled;
    if (canExtract) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.extractAudio', 'Extract audio to audio track'),
        icon: 'i-heroicons-musical-note',
        onSelect: () =>
          emit('clipAction', { action: 'extractAudio', trackId: track.id, itemId: item.id }),
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
                it.kind === 'clip' &&
                it.linkedVideoClipId === item.id &&
                Boolean(it.lockToLinkedVideo),
            ),
      );

    const hasReturnFromLockedAudioClip =
      track.kind === 'audio' && Boolean(item.linkedVideoClipId) && Boolean(item.lockToLinkedVideo);

    if (hasReturnFromVideoClip) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: () =>
          emit('clipAction', { action: 'returnAudio', trackId: track.id, itemId: item.id }),
      });
    } else if (hasReturnFromLockedAudioClip) {
      mainGroup.push({
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

    const isMediaVideoClip = track.kind === 'video' && item.clipType === 'media';
    const hasFreezeFrame = typeof item.freezeFrameSourceUs === 'number';
    if (isMediaVideoClip && !hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.freezeFrame', 'Freeze frame'),
        icon: 'i-heroicons-pause-circle',
        onSelect: () =>
          emit('clipAction', { action: 'freezeFrame', trackId: track.id, itemId: item.id }),
      });
    }

    if (isMediaVideoClip && hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.resetFreezeFrame', 'Reset freeze frame'),
        icon: 'i-heroicons-play-circle',
        onSelect: () =>
          emit('clipAction', { action: 'resetFreezeFrame', trackId: track.id, itemId: item.id }),
      });
    }
  }

  const actionGroup: any[] = [
    {
      label: t('granVideoEditor.timeline.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      onSelect: () => {
        timelineStore.applyTimeline({
          type: 'delete_items',
          trackId: track.id,
          itemIds: [item.id],
        });
      },
    },
  ];

  const result = [];
  if (mainGroup.length > 0) result.push(mainGroup);

  // Transitions submenu items
  if (item.kind === 'clip' && track.kind === 'video') {
    const transitionGroup: any[] = [];
    const hasIn = Boolean((item as any).transitionIn);
    const hasOut = Boolean((item as any).transitionOut);

    transitionGroup.push({
      label: hasIn
        ? t('granVideoEditor.timeline.removeTransitionIn')
        : t('granVideoEditor.timeline.addTransitionIn'),
      icon: hasIn ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-left-end-on-rectangle',
      onSelect: () => {
        if (hasIn) {
          timelineStore.updateClipTransition(track.id, item.id, { transitionIn: null });
        } else {
          openTransitionPanel.value = { trackId: track.id, itemId: item.id, edge: 'in', anchorEl: null };
        }
      },
    });

    transitionGroup.push({
      label: hasOut
        ? t('granVideoEditor.timeline.removeTransitionOut')
        : t('granVideoEditor.timeline.addTransitionOut'),
      icon: hasOut ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-right-end-on-rectangle',
      onSelect: () => {
        if (hasOut) {
          timelineStore.updateClipTransition(track.id, item.id, { transitionOut: null });
        } else {
          openTransitionPanel.value = { trackId: track.id, itemId: item.id, edge: 'out', anchorEl: null };
        }
      },
    });

    if (transitionGroup.length > 0) result.push(transitionGroup);
  }

  result.push(actionGroup);

  return result;
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
      :data-track-id="track.id"
      class="flex items-center px-2 relative"
      :class="timelineStore.selectedTrackId === track.id ? 'bg-gray-850/60' : ''"
      :style="{ height: `${trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT}px` }"
      @dragover.prevent="emit('dragover', $event, track.id)"
      @dragleave.prevent="emit('dragleave', $event, track.id)"
      @drop.prevent="emit('drop', $event, track.id)"
    >
      <div
        v-if="dragPreview && dragPreview.trackId === track.id"
        class="absolute inset-y-1 rounded px-2 flex items-center text-xs text-white z-30 pointer-events-none opacity-80"
        :class="
          dragPreview.kind === 'file'
            ? 'bg-primary-600 border border-primary-400'
            : 'bg-gray-600 border border-gray-400'
        "
        :style="{
          left: `${2 + timeUsToPx(dragPreview.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(30, timeUsToPx(dragPreview.durationUs, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate" :title="dragPreview.label">{{ dragPreview.label }}</span>
      </div>

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
          :class="[
            item.kind === 'gap'
              ? 'bg-gray-800/20 border border-dashed border-gray-700 text-gray-500 opacity-70 cursor-default'
              : track.kind === 'audio'
                ? 'bg-teal-600 border border-teal-400 hover:bg-teal-500'
                : 'bg-indigo-600 border border-indigo-400 hover:bg-indigo-500',
            timelineStore.selectedItemIds.includes(item.id)
              ? 'ring-2 ring-white z-20 shadow-lg'
              : '',
            item.kind === 'clip' && typeof (item as any).freezeFrameSourceUs === 'number'
              ? 'outline outline-2 outline-yellow-400/80'
              : '',
          ]"
          :style="{
            left: `${2 + timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
            width: `${Math.max(30, timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom))}px`,
          }"
          @mousedown="
            item.kind === 'clip' &&
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
          <span class="truncate" :title="item.kind === 'clip' ? item.name : ''">{{
            item.kind === 'clip' ? item.name : ''
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
          <!-- TransitionIn marker -->
          <div
            v-if="item.kind === 'clip' && (item as any).transitionIn"
            class="absolute left-0 top-0 bottom-0 w-2 flex items-center justify-start z-10 pointer-events-none opacity-70"
            :title="`Transition In: ${(item as any).transitionIn?.type}`"
          >
            <span class="w-0 h-0 border-y-[5px] border-y-transparent border-r-[6px] border-r-white/70" />
          </div>
          <!-- TransitionOut marker -->
          <div
            v-if="item.kind === 'clip' && (item as any).transitionOut"
            class="absolute right-0 top-0 bottom-0 w-2 flex items-center justify-end z-10 pointer-events-none opacity-70"
            :title="`Transition Out: ${(item as any).transitionOut?.type}`"
          >
            <span class="w-0 h-0 border-y-[5px] border-y-transparent border-l-[6px] border-l-white/70" />
          </div>
        </div>
      </UContextMenu>
    </div>
  </div>

  <!-- Transition panel popup -->
  <div
    v-if="openTransitionPanel"
    class="fixed inset-0 z-50"
    @mousedown.self="openTransitionPanel = null"
  >
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-xl">
      <ClipTransitionPanel
        :edge="openTransitionPanel.edge"
        :track-id="openTransitionPanel.trackId"
        :item-id="openTransitionPanel.itemId"
        :transition="
          (() => {
            const track = tracks.find((t) => t.id === openTransitionPanel!.trackId);
            const item = track?.items.find((i) => i.id === openTransitionPanel!.itemId);
            return item?.kind === 'clip'
              ? openTransitionPanel!.edge === 'in'
                ? (item as any).transitionIn
                : (item as any).transitionOut
              : undefined;
          })()
        "
        @update="handleTransitionUpdate"
      />
    </div>
  </div>
</template>
