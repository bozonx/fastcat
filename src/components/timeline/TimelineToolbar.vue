<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import AppModal from '~/components/ui/AppModal.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();

const isConfirmDeleteOpen = ref(false);
const isRenameOpen = ref(false);
const renameValue = ref('');

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const selectedTrack = computed(() =>
  tracks.value.find((tr) => tr.id === timelineStore.selectedTrackId) ?? null,
);

const canDeleteSelectedTrackWithoutConfirm = computed(() =>
  Boolean(selectedTrack.value && selectedTrack.value.items.length === 0),
);

function addVideoTrack() {
  const idx = tracks.value.filter((tr) => tr.kind === 'video').length + 1;
  timelineStore.addTrack('video', `Video ${idx}`);
}

function addAudioTrack() {
  const idx = tracks.value.filter((tr) => tr.kind === 'audio').length + 1;
  timelineStore.addTrack('audio', `Audio ${idx}`);
}

function openRename() {
  if (!selectedTrack.value) return;
  renameValue.value = selectedTrack.value.name;
  isRenameOpen.value = true;
}

function confirmRename() {
  if (!selectedTrack.value) return;
  const next = renameValue.value.trim();
  if (!next) return;
  timelineStore.renameTrack(selectedTrack.value.id, next);
  isRenameOpen.value = false;
}

function requestDeleteSelectedTrack() {
  if (!selectedTrack.value) return;
  if (canDeleteSelectedTrackWithoutConfirm.value) {
    timelineStore.deleteTrack(selectedTrack.value.id);
    return;
  }
  isConfirmDeleteOpen.value = true;
}

function confirmDeleteSelectedTrack() {
  if (!selectedTrack.value) return;
  timelineStore.deleteTrack(selectedTrack.value.id, { allowNonEmpty: true });
  isConfirmDeleteOpen.value = false;
}

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

      <UButton
        v-if="selectedTrack"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-pencil"
        :aria-label="t('granVideoEditor.timeline.renameTrack', 'Rename track')"
        @click="openRename"
      />
      <UButton
        v-if="selectedTrack"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-trash"
        :aria-label="t('granVideoEditor.timeline.deleteTrack', 'Delete track')"
        @click="requestDeleteSelectedTrack"
      />
    </div>

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

    <UiConfirmModal
      v-if="selectedTrack"
      v-model:open="isConfirmDeleteOpen"
      :title="t('granVideoEditor.timeline.deleteTrackTitle', 'Delete track?')"
      :description="
        t(
          'granVideoEditor.timeline.deleteTrackDescription',
          'Track is not empty. This action cannot be undone.',
        )
      "
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDeleteSelectedTrack"
    />

    <AppModal
      v-if="selectedTrack"
      v-model:open="isRenameOpen"
      :title="t('granVideoEditor.timeline.renameTrackTitle', 'Rename track')"
    >
      <div class="flex flex-col gap-3">
        <UInput
          v-model="renameValue"
          size="sm"
          :placeholder="t('granVideoEditor.timeline.trackName', 'Track name')"
          @keydown.enter.prevent="confirmRename"
        />
      </div>

      <template #footer>
        <UButton color="neutral" variant="ghost" @click="isRenameOpen = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton color="primary" @click="confirmRename">
          {{ t('common.save', 'Save') }}
        </UButton>
      </template>
    </AppModal>
  </div>
</template>
