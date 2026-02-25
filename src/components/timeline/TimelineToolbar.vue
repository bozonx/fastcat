<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import type { TimelineTrack } from '~/timeline/types';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();

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

async function splitClips() {
  await timelineStore.splitClipsAtPlayhead();
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

      <div class="w-px h-4 bg-gray-700 mx-1" />

      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-adjustments-horizontal"
        :aria-label="t('granVideoEditor.timeline.addAdjustmentClip', 'Add adjustment clip')"
        @click="addAdjustmentClip"
      />
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-swatch"
        :aria-label="t('granVideoEditor.timeline.addBackgroundClip', 'Add background clip')"
        @click="addBackgroundClip"
      />

      <div class="w-px h-4 bg-gray-700 mx-1" />

      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-scissors"
        :aria-label="t('granVideoEditor.timeline.splitClips', 'Split clips at playhead')"
        @click="splitClips"
      />
    </div>

    <div class="mx-2 flex items-center gap-1">
      <div class="w-px h-4 bg-gray-700" />

      <!-- Overlap mode toggle -->
      <UButton
        size="xs"
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

      <div class="w-px h-4 bg-gray-700" />

      <!-- Frame snap toggle -->
      <UButton
        size="xs"
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
        size="xs"
        :variant="settingsStore.clipSnapMode === 'clips' ? 'solid' : 'ghost'"
        :color="settingsStore.clipSnapMode === 'clips' ? 'primary' : 'neutral'"
        icon="i-heroicons-magnet"
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
