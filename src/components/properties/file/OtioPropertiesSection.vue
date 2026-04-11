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
  <PropertySection>
    <template v-if="props.summary">
      <PropertyRow
        :label="t('common.duration')"
        :value="props.formatDurationSeconds(props.summary.durationUs / 1000000)"
      />
      <PropertyRow
        :label="t('fastcat.timeline.videoTracks')"
        :value="props.summary.videoTracks"
      />
      <PropertyRow
        :label="t('fastcat.timeline.audioTracks')"
        :value="props.summary.audioTracks"
      />
      <PropertyRow
        :label="t('fastcat.timeline.clipsCount')"
        :value="props.summary.clips"
      />
      <PropertyRow
        v-if="props.summary.version"
        :label="t('fastcat.timeline.version')"
        :value="props.summary.version"
      />
    </template>
    <PropertyRow v-else :label="t('common.type')" value="OTIO" />
  </PropertySection>
</template>
