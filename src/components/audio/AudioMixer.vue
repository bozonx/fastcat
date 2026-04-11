<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import type { TimelineTrack } from '~/timeline/types';
import { trackHasAudio } from '~/utils/audio';
import AudioMixerTrack from './AudioMixerTrack.vue';
import AudioMixerMain from './AudioMixerMain.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();

const audioTracks = computed(() => {
  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return docTracks.filter((track) => trackHasAudio(track, mediaStore.mediaMetadata));
});

const selectedTrackId = computed(() => timelineStore.selectedTrackId);
const selectedItemIds = computed(() => timelineStore.selectedItemIds);

const isMainBusSelected = computed(
  () =>
    focusStore.isPanelFocused('audioMixer') &&
    !selectedTrackId.value &&
    selectedItemIds.value.length === 0,
);

function isTrackSelected(track: TimelineTrack): boolean {
  if (selectedTrackId.value === track.id) return true;
  // Check if any clip in this track is selected
  return track.items.some((item) => selectedItemIds.value.includes(item.id));
}

function focusAudioMixer() {
  focusStore.setPanelFocus('audioMixer');
}

function focusTrack(trackId: string) {
  focusAudioMixer();
  timelineStore.selectTrack(trackId);
}

function focusMainBus() {
  focusAudioMixer();
  timelineStore.clearSelection();
  timelineStore.selectTrack(null);
}
</script>

<template>
  <div
    class="panel-focus-frame h-full bg-ui-bg flex flex-col border-r border-ui-border min-h-0"
    :class="{
      'panel-focus-frame--active': focusStore.isPanelFocused('audioMixer'),
    }"
    @pointerdown="focusAudioMixer"
  >
    <div class="px-4 py-2 border-b border-ui-border bg-ui-bg-elevated shrink-0">
      <h3 class="font-medium text-sm text-ui-text">
        {{ t('fastcat.audioMixer.title') }}
      </h3>
    </div>

    <div class="flex-1 overflow-x-auto overflow-y-hidden p-4 flex gap-4 min-h-0">
      <!-- Main Bus -->
      <AudioMixerMain :is-selected="isMainBusSelected" @click.self="focusMainBus" />

      <!-- Divider -->
      <div v-if="audioTracks.length > 0" class="w-px bg-ui-border shrink-0 my-2" />

      <!-- Tracks -->
      <div class="flex gap-2">
        <AudioMixerTrack
          v-for="track in audioTracks"
          :key="track.id"
          :track="track"
          :is-selected="isTrackSelected(track)"
          @click.self="focusTrack(track.id)"
        />
      </div>
    </div>
  </div>
</template>
