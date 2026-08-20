<script setup lang="ts">
import type { TimelineClipItem } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import PropertyDuration from '~/components/properties/PropertyDuration.vue';
import MediaMetadataList from '~/components/properties/MediaMetadataList.vue';
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { getClipMaxTimelineDurationTicks } from '~/utils/timeline/clip';
import { isClipFreePosition } from '~/utils/timeline/clip-checks';
import { getTimelineFps } from '~/timeline/timebase';

const props = withDefaults(
  defineProps<{
    clip: TimelineClipItem;
    mediaMeta: {
      video?: { displayWidth?: number; displayHeight?: number; fps?: number } | null;
      audio?: { channels?: number; sampleRate?: number } | null;
    } | null;
    showSource?: boolean;
    showInfo?: boolean;
  }>(),
  {
    showSource: true,
    showInfo: true,
  },
);

const emit = defineEmits<{
  updateStartTime: [val: number];
  updateEndTime: [val: number];
  snapToGrid: [];
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const timelineFps = computed(() => timelineStore.timelineFormat?.fps ?? timelineStore.fps);

// The end timecode may never exceed the clip's source material. For images and
// virtual clips getClipMaxTimelineDurationTicks returns Infinity (no upper bound).
const clipMaxDurationTicks = computed(() => getClipMaxTimelineDurationTicks(props.clip));
const endMaxTicks = computed(
  () => props.clip.timelineRange.startTicks + clipMaxDurationTicks.value,
);

// Only audio clips may be freely (sub-frame) positioned, so the "snap to grid"
// affordance is audio-only. It stays visible but disabled once both edges are
// already frame-aligned, mirroring the timeline's dashed free-position badge.
const isAudioClip = computed(() => {
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === props.clip.trackId);
  return track?.kind === 'audio';
});
// Match the fps source the timeline's free-position badge and the snap handler
// use (doc timebase), so the button's disabled state can't disagree with them.
const isClipOffGrid = computed(() =>
  isClipFreePosition(
    props.clip,
    timelineStore.timelineDoc,
    timelineStore.timelineDoc
      ? getTimelineFps(timelineStore.timelineDoc.timebase)
      : timelineFps.value,
  ),
);
</script>

<template>
  <PropertySection
    v-if="props.showSource && props.clip.clipType === 'media'"
    :title="t('common.source')"
  >
    <PropertyRow :label="t('common.path')" :value="props.clip.source.path" />
    <MediaMetadataList :media-meta="props.mediaMeta as any" />
  </PropertySection>

  <PropertySection v-if="props.showInfo">
    <PropertyDuration
      :label="t('common.duration')"
      :model-value="props.clip.timelineRange.durationTicks"
      :fps="timelineFps"
    />

    <PropertyTimecode
      :label="t('common.position')"
      :model-value="props.clip.timelineRange.startTicks"
      :min="0"
      @update:model-value="emit('updateStartTime', $event)"
    />

    <PropertyTimecode
      :label="t('common.end')"
      :model-value="props.clip.timelineRange.startTicks + props.clip.timelineRange.durationTicks"
      :min="0"
      :max="endMaxTicks"
      @update:model-value="emit('updateEndTime', $event)"
    />

    <UButton
      v-if="isAudioClip"
      class="mt-1 justify-center"
      size="xs"
      color="neutral"
      variant="subtle"
      icon="i-heroicons-squares-2x2"
      block
      :disabled="!isClipOffGrid"
      :label="t('fastcat.timeline.snapClipToGrid')"
      @click="emit('snapToGrid')"
    />
  </PropertySection>
</template>
