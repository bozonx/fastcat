<script setup lang="ts">
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  summary: {
    durationUs: number;
    videoTracks: number;
    audioTracks: number;
    clips: number;
    version: number | null;
  } | null;
  formatDurationSeconds: (seconds: number) => string;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection v-if="props.summary" :title="t('fastcat.timeline.summary', 'Timeline Summary')">
    <PropertyRow
      :label="t('common.duration', 'Duration')"
      :value="props.formatDurationSeconds(props.summary.durationUs / 1000000)"
    />
    <PropertyRow
      :label="t('fastcat.timeline.videoTracks', 'Video Tracks')"
      :value="props.summary.videoTracks"
    />
    <PropertyRow
      :label="t('fastcat.timeline.audioTracks', 'Audio Tracks')"
      :value="props.summary.audioTracks"
    />
    <PropertyRow
      :label="t('fastcat.timeline.clipsCount', 'Clips Count')"
      :value="props.summary.clips"
    />
    <PropertyRow
      v-if="props.summary.version"
      :label="t('fastcat.timeline.version', 'Fastcat Version')"
      :value="props.summary.version"
    />
  </PropertySection>
</template>
