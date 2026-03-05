<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import type { TimelineClipItem } from '~/timeline/types';

const props = defineProps<{
  items: { trackId: string; itemId: string }[];
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const selectedClips = computed(() => {
  const clips: TimelineClipItem[] = [];
  const doc = timelineStore.timelineDoc;
  if (!doc) return clips;
  
  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    const clip = track.items.find((it) => it.id === itemId);
    if (clip && clip.kind === 'clip') {
      clips.push(clip as TimelineClipItem);
    }
  }
  return clips;
});

const allDisabled = computed(() => selectedClips.value.every((c) => c.disabled));
const allMuted = computed(() => selectedClips.value.every((c) => c.audioMuted));
const allShowWaveform = computed(() => selectedClips.value.every((c) => c.showWaveform !== false));
const allWaveformHalf = computed(() => selectedClips.value.every((c) => c.audioWaveformMode !== 'full'));

const hasAudioOrVideoWithAudio = computed(() => {
  const doc = timelineStore.timelineDoc;
  if (!doc) return false;
  return props.items.some(({ trackId, itemId }) => {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) return false;
    const clip = track.items.find((it) => it.id === itemId);
    if (!clip || clip.kind !== 'clip') return false;
    
    if (track.kind === 'audio') return true;
    if (track.kind === 'video' && clip.clipType === 'media' && clip.linkedVideoClipId) return true;
    if (track.kind === 'video' && clip.clipType === 'media' && clip.source?.hasAudio) return true;
    return false;
  });
});

const hasVideo = computed(() => {
  const doc = timelineStore.timelineDoc;
  if (!doc) return false;
  return props.items.some(({ trackId }) => {
    const track = doc.tracks.find((t) => t.id === trackId);
    return track?.kind === 'video';
  });
});

function handleDelete() {
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'delete_items' as const,
    trackId,
    itemIds: [itemId],
  }));
  timelineStore.batchApplyTimeline(cmds);
  timelineStore.clearSelection();
}

function toggleDisabled() {
  const nextVal = !allDisabled.value;
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { disabled: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}

function toggleMuted() {
  const nextVal = !allMuted.value;
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { audioMuted: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}

function toggleShowWaveform() {
  const nextVal = !allShowWaveform.value;
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { showWaveform: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}

function toggleWaveformMode() {
  const nextVal = allWaveformHalf.value ? 'full' : 'half';
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { audioWaveformMode: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}
</script>

<template>
  <div class="flex flex-col gap-4 w-full">
    <PropertySection :title="t('granVideoEditor.timeline.multipleSelection', 'Multiple Selection')">
      <div class="px-3 pb-3 flex flex-col gap-2">
        <span class="text-sm text-ui-text-muted">
          {{ t('granVideoEditor.timeline.selectedClipsCount', '{count} clips selected', { count: items.length }) }}
        </span>
      </div>
    </PropertySection>

    <PropertySection :title="t('common.actions', 'Actions')">
      <div class="px-3 pb-3 flex flex-col gap-2">
        <UButton
          size="sm"
          color="danger"
          variant="soft"
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          @click="handleDelete"
        />

        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          :icon="allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
          :label="allDisabled ? t('granVideoEditor.timeline.enableClips', 'Enable clips') : t('granVideoEditor.timeline.disableClips', 'Disable clips')"
          @click="toggleDisabled"
        />

        <template v-if="hasAudioOrVideoWithAudio">
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            :icon="allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
            :label="allMuted ? t('granVideoEditor.timeline.unmuteClips', 'Unmute clips') : t('granVideoEditor.timeline.muteClips', 'Mute clips')"
            @click="toggleMuted"
          />
          
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-heroicons-chart-bar"
            :label="allWaveformHalf ? t('granVideoEditor.timeline.waveformFull', 'Waveform: Full') : t('granVideoEditor.timeline.waveformHalf', 'Waveform: Half')"
            @click="toggleWaveformMode"
          />
        </template>
        
        <template v-if="hasVideo">
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            :icon="allShowWaveform ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
            :label="allShowWaveform ? t('granVideoEditor.timeline.hideWaveform', 'Hide Waveform') : t('granVideoEditor.timeline.showWaveform', 'Show Waveform')"
            @click="toggleShowWaveform"
          />
        </template>
      </div>
    </PropertySection>
  </div>
</template>
