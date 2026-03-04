<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import type { TimelineTrack } from '~/timeline/types';
import { useDraggedFile } from '~/composables/useDraggedFile';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();

function onDragStart(e: DragEvent, kind: 'adjustment' | 'background' | 'text') {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        kind,
        name: t(`granVideoEditor.timeline.${kind}ClipDefaultName`, kind),
        path: '',
      }),
    );
  }

  const labels: Record<string, string> = {
    adjustment: t('granVideoEditor.timeline.adjustmentClipDefaultName', 'Adjustment'),
    background: t('granVideoEditor.timeline.backgroundClipDefaultName', 'Background'),
    text: t('granVideoEditor.timeline.textClipDefaultName', 'Text'),
  };

  setDraggedFile({
    kind,
    name: labels[kind] ?? kind,
    path: '',
  });
}

function onDragEnd() {
  clearDraggedFile();
}

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

function addVideoTrack() {
  const idx = tracks.value.filter((tr) => tr.kind === 'video').length + 1;
  timelineStore.addTrack('video', `Video ${idx}`);
}

function addAudioTrack() {
  const idx = tracks.value.filter((tr) => tr.kind === 'audio').length + 1;
  timelineStore.addTrack('audio', `Audio ${idx}`);
}

function addAdjustmentClip() {
  timelineStore.addAdjustmentClipAtPlayhead();
}

function addBackgroundClip() {
  timelineStore.addBackgroundClipAtPlayhead();
}

function addTextClip() {
  const defaultName = t('granVideoEditor.timeline.textClipDefaultName', 'Text');
  const defaultText = t('granVideoEditor.timeline.textClipDefaultText', 'Text');
  timelineStore.addTextClipAtPlayhead({ name: defaultName, text: defaultText });
}

async function splitClips() {
  await timelineStore.splitClipsAtPlayhead();
}

async function rippleTrimLeft() {
  await timelineStore.rippleTrimLeft();
}

async function rippleTrimRight() {
  await timelineStore.rippleTrimRight();
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function togglePlay() {
  timelineStore.togglePlayback();
}

function stop() {
  timelineStore.stopPlayback();
}

function onZoomInput(e: Event) {
  const target = e.target as HTMLInputElement | null;
  timelineStore.setTimelineZoom(Number(target?.value ?? 50));
}
</script>

<template>
  <div
    class="flex items-center gap-2 px-2 py-1.5 border-t-2 border-ui-border shrink-0 bg-ui-bg-elevated min-h-10 h-auto flex-wrap mt-auto w-full"
    @pointerdown="focusStore.setMainFocus('timeline')"
  >
    <div class="ml-2 flex items-center gap-1.5">
      <div
        draggable="true"
        class="cursor-grab active:cursor-grabbing"
        @dragstart="onDragStart($event, 'adjustment')"
        @dragend="onDragEnd"
      >
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-adjustments-horizontal"
          :aria-label="t('granVideoEditor.timeline.addAdjustmentClip', 'Add adjustment clip')"
          @click="addAdjustmentClip"
        />
      </div>
      <div
        draggable="true"
        class="cursor-grab active:cursor-grabbing"
        @dragstart="onDragStart($event, 'background')"
        @dragend="onDragEnd"
      >
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-swatch"
          :aria-label="t('granVideoEditor.timeline.addBackgroundClip', 'Add background clip')"
          @click="addBackgroundClip"
        />
      </div>
      <div
        draggable="true"
        class="cursor-grab active:cursor-grabbing"
        @dragstart="onDragStart($event, 'text')"
        @dragend="onDragEnd"
      >
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-chat-bubble-bottom-center-text"
          :aria-label="t('granVideoEditor.timeline.addTextClip', 'Add text clip')"
          @click="addTextClip"
        />
      </div>

      <div class="w-px h-5 bg-ui-border mx-1.5" />

      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-scissors"
        :aria-label="t('granVideoEditor.timeline.splitClips', 'Split clips at playhead')"
        @click="splitClips"
      />

      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-left"
        :aria-label="t('granVideoEditor.timeline.rippleTrimLeft', 'Ripple trim left')"
        @click="rippleTrimLeft"
      />
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-right"
        :aria-label="t('granVideoEditor.timeline.rippleTrimRight', 'Ripple trim right')"
        @click="rippleTrimRight"
      />
    </div>

    <div class="ml-auto flex items-center gap-4 mr-4">
      <div class="flex items-center gap-2 text-ui-text-muted">
        <UIcon name="i-heroicons-magnifying-glass-minus" class="w-4 h-4" />
        <input
          type="range"
          min="0"
          max="110"
          step="1"
          :value="timelineStore.timelineZoom"
          class="w-32 h-1.5 bg-ui-border rounded-lg appearance-none cursor-pointer accent-primary-500"
          @input="onZoomInput"
        />
        <UIcon name="i-heroicons-magnifying-glass-plus" class="w-4 h-4" />
      </div>
    </div>
  </div>
</template>
