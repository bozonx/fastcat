<script setup lang="ts">
import { useTimelineStore } from '~/stores/timeline.store';

const { t } = useI18n();
const timelineStore = useTimelineStore();

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function togglePlay() {
  timelineStore.isPlaying = !timelineStore.isPlaying;
}

function stop() {
  timelineStore.isPlaying = false;
  timelineStore.currentTime = 0;
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

    <div class="ml-auto flex items-center gap-1 text-xs text-gray-500">
      <UIcon name="i-heroicons-magnifying-glass-minus" class="w-3.5 h-3.5" />
      <input
        type="range"
        min="10"
        max="200"
        value="100"
        class="w-20 accent-primary-500"
        :aria-label="t('granVideoEditor.timeline.zoom', 'Zoom')"
      />
      <UIcon name="i-heroicons-magnifying-glass-plus" class="w-3.5 h-3.5" />
    </div>
  </div>
</template>
