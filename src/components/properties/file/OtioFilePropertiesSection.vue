<script setup lang="ts">
import PropertyRow from '~/components/properties/PropertyRow.vue';
interface TimelineDocSummary {
  version?: string | number | null;
  durationUs?: number | null;
  videoTracks?: number | null;
  audioTracks?: number | null;
  clips?: number | null;
}

const props = defineProps<{
  summary: TimelineDocSummary;
  formatDurationSeconds: (seconds: number) => string;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <div class="flex flex-col">
      <PropertyRow
        :label="t('fastcat.timeline.version', 'Version')"
        :value="props.summary.version ?? '-'"
      />
      <PropertyRow
        :label="t('common.duration', 'Duration')"
        :value="props.formatDurationSeconds((props.summary.durationUs ?? 0) / 1_000_000)"
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.otio.videoTracks', 'Video tracks')"
        :value="props.summary.videoTracks ?? '-'"
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.otio.audioTracks', 'Audio tracks')"
        :value="props.summary.audioTracks ?? '-'"
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.otio.clips', 'Clips')"
        :value="props.summary.clips ?? '-'"
      />
    </div>
  </div>
</template>
