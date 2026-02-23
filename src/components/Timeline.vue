<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import { useI18n } from 'vue-i18n';
import { useToast } from '#imports';
import { useTimelineInteraction, timeUsToPx, pxToTimeUs } from '~/composables/timeline/useTimelineInteraction';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';

const { t } = useI18n();
const toast = useToast();
const timelineStore = useTimelineStore();

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const scrollEl = ref<HTMLElement | null>(null);

const {
  isDraggingPlayhead,
  onTimeRulerMouseDown,
  startPlayheadDrag,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

async function onClipAction(payload: {
  action: 'extractAudio' | 'returnAudio';
  trackId: string;
  itemId: string;
  videoItemId?: string;
}) {
  try {
    if (payload.action === 'extractAudio') {
      await timelineStore.extractAudioToTrack({ videoTrackId: payload.trackId, videoItemId: payload.itemId });
    } else {
      timelineStore.returnAudioToVideo({ videoItemId: payload.videoItemId ?? payload.itemId });
    }
    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: any) {
    toast.add({
      title: t('common.error', 'Error'),
      description: String(err?.message ?? err ?? ''),
      icon: 'i-heroicons-exclamation-triangle',
      color: 'error',
    });
  }
}

async function onDrop(e: DragEvent, trackId: string) {
  const data =
    e.dataTransfer?.getData('application/json') || e.dataTransfer?.getData('text/plain');
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed?.kind === 'timeline-clip' && parsed.itemId && parsed.fromTrackId) {
        const scrollerRect = scrollEl.value?.getBoundingClientRect();
        const scrollX = scrollEl.value?.scrollLeft ?? 0;
        if (!scrollerRect) return;
        const x = e.clientX - scrollerRect.left + scrollX;
        const startUs = pxToTimeUs(x);
        try {
          await timelineStore.moveItemToTrack({
            fromTrackId: String(parsed.fromTrackId),
            toTrackId: trackId,
            itemId: String(parsed.itemId),
            startUs,
          });
          await timelineStore.requestTimelineSave({ immediate: true });
          return;
        } catch (err: any) {
          toast.add({
            title: t('granVideoEditor.timeline.clipMoveFailed', 'Failed to move clip'),
            description: String(err?.message ?? err ?? ''),
            icon: 'i-heroicons-exclamation-triangle',
            color: 'error',
          });
          return;
        }
      }
      if (parsed.name && parsed.path) {
        await timelineStore.addClipToTimelineFromPath({
          trackId,
          name: parsed.name,
          path: parsed.path,
        });

        toast.add({
          title: t('granVideoEditor.timeline.clipAdded', 'Clip Added'),
          description: `${parsed.name} added to track`,
          icon: 'i-heroicons-check-circle',
          color: 'success',
        });
      }
    } catch (err) {
      console.error('Failed to parse dropped data', err);
    }
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated border-t border-ui-border">
    <!-- Toolbar -->
    <TimelineToolbar />

    <!-- Timeline area -->
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- Track labels -->
      <TimelineTrackLabels :tracks="tracks" />

      <!-- Scrollable track area -->
      <div ref="scrollEl" class="flex-1 overflow-x-auto overflow-y-hidden relative">
        <div
          class="h-6 border-b border-ui-border bg-ui-bg-accent sticky top-0 flex items-end px-2 gap-16 text-xxs text-ui-text-muted font-mono select-none cursor-pointer"
          @mousedown="onTimeRulerMouseDown"
        >
          <span v-for="n in 10" :key="n">{{ formatTime((n - 1) * 10) }}</span>
        </div>

        <!-- Tracks -->
        <TimelineTracks
          :tracks="tracks"
          @drop="onDrop"
          @start-move-item="startMoveItem"
          @select-item="selectItem"
          @start-trim-item="startTrimItem"
          @clip-action="onClipAction"
        />

        <!-- Playhead -->
        <div
          class="absolute top-0 bottom-0 w-px bg-primary-500 cursor-ew-resize pointer-events-none"
          :style="{ left: `${timeUsToPx(timelineStore.currentTime)}px` }"
        >
          <div
            class="w-2.5 h-2.5 bg-primary-500 rounded-full -translate-x-1/2 mt-0.5 pointer-events-auto"
            @mousedown="startPlayheadDrag"
          />
        </div>
      </div>
    </div>
  </div>
</template>
