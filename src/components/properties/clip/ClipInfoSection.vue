<script setup lang="ts">
import type { TimelineClipItem } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import MediaMetadataList from '~/components/properties/MediaMetadataList.vue';

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
  updateDuration: [val: number];
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection
    v-if="props.showSource && props.clip.clipType === 'media'"
    :title="t('common.source')"
  >
    <PropertyRow :label="t('common.path')" :value="props.clip.source.path" />
    <MediaMetadataList :media-meta="props.mediaMeta as any" />
  </PropertySection>

  <PropertySection v-if="props.showInfo" class="hidden md:block">
    <PropertyTimecode
      :label="t('common.duration')"
      :model-value="props.clip.timelineRange.durationUs"
      @update:model-value="emit('updateDuration', $event)"
    />

    <PropertyTimecode
      :label="t('common.start')"
      :model-value="props.clip.timelineRange.startUs"
      @update:model-value="emit('updateStartTime', $event)"
    />

    <PropertyTimecode
      :label="t('common.end')"
      :model-value="props.clip.timelineRange.startUs + props.clip.timelineRange.durationUs"
      @update:model-value="emit('updateEndTime', $event)"
    />
  </PropertySection>
</template>
