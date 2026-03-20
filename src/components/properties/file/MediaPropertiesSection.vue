<script setup lang="ts">
import type { MediaMetadata } from '~/stores/media.store';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import MediaTranscriptionSection from './MediaTranscriptionSection.vue';
import MediaMetadataList from '~/components/properties/MediaMetadataList.vue';

const props = defineProps<{
  mediaMeta: MediaMetadata | null | undefined;
  formatDurationSeconds: (seconds: number | null | undefined) => string;
  formatBitrate: (bitrate: number) => string;
  canTranscribeMedia: boolean;
  latestTranscriptionCacheKey: string;
  latestTranscriptionWasCached: boolean;
  latestTranscriptionText: string;
  openTranscriptionModal: () => void;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <div class="flex flex-col gap-2">
      <PropertyRow
        :label="t('common.duration', 'Duration')"
        :value="props.formatDurationSeconds(props.mediaMeta?.duration)"
      />
      <MediaMetadataList :media-meta="props.mediaMeta" />
      <PropertyRow
        :label="t('videoEditor.fileManager.video.container', 'Container')"
        :value="props.mediaMeta?.container ?? '-'"
      />
      <PropertyRow
        v-if="props.mediaMeta?.video"
        :label="t('videoEditor.fileManager.video.videoCodec', 'Video codec')"
      >
        {{ props.mediaMeta?.video?.parsedCodec ?? props.mediaMeta?.video?.codec ?? '-' }}
        <span v-if="props.mediaMeta?.video?.bitrate">
          , {{ props.formatBitrate(props.mediaMeta.video.bitrate) }}
        </span>
      </PropertyRow>
      <PropertyRow
        v-if="props.mediaMeta?.audio"
        :label="t('videoEditor.fileManager.video.audioCodec', 'Audio codec')"
      >
        {{ props.mediaMeta?.audio?.parsedCodec ?? props.mediaMeta?.audio?.codec ?? '-' }}
        <span v-if="props.mediaMeta?.audio?.bitrate">
          , {{ props.formatBitrate(props.mediaMeta.audio.bitrate) }}
        </span>
      </PropertyRow>

      <MediaTranscriptionSection
        :can-transcribe-media="props.canTranscribeMedia"
        :latest-transcription-cache-key="props.latestTranscriptionCacheKey"
        :latest-transcription-was-cached="props.latestTranscriptionWasCached"
        :latest-transcription-text="props.latestTranscriptionText"
        :open-transcription-modal="props.openTranscriptionModal"
      />
    </div>
  </div>
</template>
