<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import type { TimelineTrack, TimelineTrackItem, TimelineClipItem } from '~/timeline/types';
import AudioMixerTrack from './AudioMixerTrack.vue';
import AudioMixerMain from './AudioMixerMain.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();

function clipHasAudio(item: TimelineTrackItem, track: TimelineTrack): boolean {
  if (item.kind !== 'clip') return false;
  const clip = item as TimelineClipItem;
  if (track.kind === 'video' && clip.audioFromVideoDisabled) return false;
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return track.kind === 'audio';
  if (!clip.source?.path) return track.kind === 'audio';
  const meta = mediaStore.mediaMetadata[clip.source.path];
  return Boolean(meta?.audio) || track.kind === 'audio';
}

function trackHasAudio(track: TimelineTrack): boolean {
  return track.items.some((item) => clipHasAudio(item, track));
}

const audioTracks = computed(() => {
  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return docTracks.filter(trackHasAudio);
});

const selectedTrackId = computed(() => timelineStore.selectedTrackId);
const selectedItemIds = computed(() => timelineStore.selectedItemIds);

const isMainBusSelected = computed(
  () => focusStore.isPanelFocused('audioMixer') && !selectedTrackId.value && selectedItemIds.value.length === 0,
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
    class="h-full bg-ui-bg flex flex-col border-r border-ui-border min-h-0"
    :class="{
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
        focusStore.isPanelFocused('audioMixer'),
    }"
    @pointerdown.capture="focusAudioMixer"
  >
    <div class="px-4 py-2 border-b border-ui-border bg-ui-bg-elevated shrink-0">
      <h3 class="font-medium text-sm text-ui-text">
        {{ t('fastcat.audioMixer.title', 'Микшер') }}
      </h3>
    </div>

    <div class="flex-1 overflow-x-auto overflow-y-hidden p-4 flex gap-4 min-h-0">
      <!-- Main Bus -->
      <AudioMixerMain :is-selected="isMainBusSelected" @pointerdown.capture="focusMainBus" />

      <!-- Divider -->
      <div v-if="audioTracks.length > 0" class="w-px bg-ui-border shrink-0 my-2" />

      <!-- Tracks -->
      <div class="flex gap-2">
        <AudioMixerTrack
          v-for="track in audioTracks"
          :key="track.id"
          :track="track"
          :is-selected="isTrackSelected(track)"
          @pointerdown.capture="focusTrack(track.id)"
        />
      </div>
    </div>
  </div>
</template>
