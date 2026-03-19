<script setup lang="ts">
import type { TimelineClipItem } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import TimecodeInput from '~/components/common/TimecodeInput.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import MediaMetadataList from '~/components/properties/MediaMetadataList.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  mediaMeta: {
    video?: { displayWidth?: number; displayHeight?: number; fps?: number } | null;
    audio?: { channels?: number; sampleRate?: number } | null;
  } | null;
}>();

const emit = defineEmits<{
  updateStartTime: [val: number];
  updateEndTime: [val: number];
  updateDuration: [val: number];
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection
    v-if="props.clip.clipType === 'media'"
    :title="t('common.source', 'Source File')"
  >
    <PropertyRow :label="t('common.path', 'Path')" :value="props.clip.source.path" />
    <MediaMetadataList :media-meta="props.mediaMeta" />
  </PropertySection>

  <PropertySection :title="t('fastcat.clip.info', 'Clip Info')">
    <PropertyTimecode
      :label="t('common.duration', 'Duration')"
      :model-value="props.clip.timelineRange.durationUs"
      @update:model-value="emit('updateDuration', $event)"
    />

    <PropertyTimecode
      :label="t('common.start', 'Start Time')"
      :model-value="props.clip.timelineRange.startUs"
      @update:model-value="emit('updateStartTime', $event)"
    />

    <PropertyTimecode
      :label="t('common.end', 'End Time')"
      :model-value="props.clip.timelineRange.startUs + props.clip.timelineRange.durationUs"
      @update:model-value="emit('updateEndTime', $event)"
    />
  </PropertySection>
</template>
