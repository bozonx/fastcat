<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';

const { t } = useI18n();
const timelineStore = useTimelineStore();

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
  timelineStore.setTimelineZoom(Number(target?.value ?? 100));
}
</script>

<template>
  <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
    <UButton
      size="xs"
      variant="ghost"
      color="neutral"
      icon="i-heroicons-backward"
      :aria-label="t('granVideoEditor.timeline.rewind', 'Rewind to start')"
      @click="stop"
    />
    <UButton
      size="xs"
      variant="ghost"
      color="neutral"
      :icon="timelineStore.isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
      :aria-label="
        timelineStore.isPlaying
          ? t('granVideoEditor.timeline.pause', 'Pause')
          : t('granVideoEditor.timeline.play', 'Play')
      "
      @click="togglePlay"
    />
    <UButton
      size="xs"
      variant="ghost"
      color="neutral"
      icon="i-heroicons-stop"
      :aria-label="t('granVideoEditor.timeline.stop', 'Stop')"
      @click="stop"
    />

    <span class="text-xs font-mono text-gray-400 ml-2">
      {{ formatTime(timelineStore.currentTime / 1e6) }} /
      {{ formatTime(timelineStore.duration / 1e6) }}
    </span>

    <div class="ml-4 flex items-center gap-1">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-video-camera"
        :aria-label="t('granVideoEditor.timeline.addVideoTrack', 'Add video track')"
        @click="addVideoTrack"
      />
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-musical-note"
        :aria-label="t('granVideoEditor.timeline.addAudioTrack', 'Add audio track')"
        @click="addAudioTrack"
      />
    </div>

    <div class="ml-auto flex items-center gap-1 text-xs text-gray-500">
      <UIcon name="i-heroicons-magnifying-glass-minus" class="w-3.5 h-3.5" />
      <input
        type="range"
        min="10"
        max="200"
        :value="timelineStore.timelineZoom"
        class="w-20 accent-primary-500"
        :aria-label="t('granVideoEditor.timeline.zoom', 'Zoom')"
        @input="onZoomInput"
      />
      <UIcon name="i-heroicons-magnifying-glass-plus" class="w-3.5 h-3.5" />
    </div>

  </div>
</template>
