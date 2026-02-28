<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import type { TimelineTrack } from '~/timeline/types';
import TimelineZoomLogSlider from '~/components/ui/TimelineZoomLogSlider.vue';
import { useDraggedFile } from '~/composables/useDraggedFile';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();
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

const emit = defineEmits<{
  (e: 'update:zoom', value: number): void;
}>();

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

function addMarker() {
  timelineStore.addMarkerAtPlayhead();
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

function toggleOverlapMode() {
  settingsStore.setOverlapMode(settingsStore.overlapMode === 'none' ? 'pseudo' : 'none');
}

function toggleFrameSnapMode() {
  settingsStore.setFrameSnapMode(settingsStore.frameSnapMode === 'frames' ? 'free' : 'frames');
}

function toggleClipSnapMode() {
  settingsStore.setClipSnapMode(settingsStore.clipSnapMode === 'clips' ? 'none' : 'clips');
}
</script>

<template>
  <div
    class="flex items-center gap-2 px-2 py-1.5 border-b border-ui-border shrink-0 bg-ui-bg-elevated h-10"
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

      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-bookmark"
        :aria-label="t('granVideoEditor.timeline.addMarker', 'Add marker')"
        @click="addMarker"
      />

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

    <div class="mx-2 flex items-center gap-1.5">
      <div class="w-px h-5 bg-ui-border" />

      <!-- Overlap mode toggle -->
      <UButton
        size="sm"
        :variant="settingsStore.overlapMode === 'pseudo' ? 'solid' : 'ghost'"
        :color="settingsStore.overlapMode === 'pseudo' ? 'primary' : 'neutral'"
        icon="i-heroicons-squares-2x2"
        :aria-label="
          settingsStore.overlapMode === 'pseudo'
            ? t('granVideoEditor.timeline.overlayModePseudo', 'Pseudo-overlay mode (active)')
            : t('granVideoEditor.timeline.overlayModeNone', 'Normal mode (no overlap)')
        "
        :title="
          settingsStore.overlapMode === 'pseudo'
            ? t('granVideoEditor.timeline.overlayModePseudo', 'Pseudo-overlay mode')
            : t('granVideoEditor.timeline.overlayModeNone', 'Normal mode')
        "
        @click="toggleOverlapMode"
      />

      <div class="w-px h-5 bg-ui-border" />

      <!-- Frame snap toggle -->
      <UButton
        size="sm"
        :variant="settingsStore.frameSnapMode === 'frames' ? 'solid' : 'ghost'"
        :color="settingsStore.frameSnapMode === 'frames' ? 'primary' : 'neutral'"
        icon="i-heroicons-film"
        :aria-label="
          settingsStore.frameSnapMode === 'frames'
            ? t('granVideoEditor.timeline.frameSnapOn', 'Snap to frames (active)')
            : t('granVideoEditor.timeline.frameSnapOff', 'Free placement (no frame snap)')
        "
        :title="
          settingsStore.frameSnapMode === 'frames'
            ? t('granVideoEditor.timeline.frameSnapOn', 'Snap to frames')
            : t('granVideoEditor.timeline.frameSnapOff', 'Free placement')
        "
        @click="toggleFrameSnapMode"
      />

      <!-- Clip snap toggle -->
      <UButton
        size="sm"
        :variant="settingsStore.clipSnapMode === 'clips' ? 'solid' : 'ghost'"
        :color="settingsStore.clipSnapMode === 'clips' ? 'primary' : 'neutral'"
        icon="i-heroicons-link"
        :aria-label="
          settingsStore.clipSnapMode === 'clips'
            ? t('granVideoEditor.timeline.clipSnapOn', 'Snap to clips (active)')
            : t('granVideoEditor.timeline.clipSnapOff', 'No clip snapping')
        "
        :title="
          settingsStore.clipSnapMode === 'clips'
            ? t('granVideoEditor.timeline.clipSnapOn', 'Snap to clips')
            : t('granVideoEditor.timeline.clipSnapOff', 'No clip snapping')
        "
        @click="toggleClipSnapMode"
      />
    </div>

    <div class="ml-auto flex items-center gap-2 text-sm text-ui-text-muted">
      <UIcon name="i-heroicons-magnifying-glass-minus" class="w-4 h-4" />
      <TimelineZoomLogSlider
        :model-value="timelineStore.timelineZoom"
        :min="0"
        :max="100"
        :step="1"
        slider-class="w-28"
        :aria-label="t('granVideoEditor.timeline.zoom', 'Zoom')"
        @update:model-value="(v) => emit('update:zoom', v ?? 50)"
      />
      <UIcon name="i-heroicons-magnifying-glass-plus" class="w-4 h-4" />
    </div>
  </div>
</template>
