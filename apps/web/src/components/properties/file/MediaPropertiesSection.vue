<script setup lang="ts">
import type { MediaMetadata } from '~/stores/media.store';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import MediaTranscriptionSection from './MediaTranscriptionSection.vue';
import MediaMetadataList from '~/components/properties/MediaMetadataList.vue';

const props = defineProps<{
  mediaMeta: MediaMetadata | null | undefined;
  formatDurationSeconds: (seconds: number | null | undefined) => string;
  formatBitrate: (bitrate: number) => string;
  latestTranscriptionCacheKey: string;
  latestTranscriptionWasCached: boolean;
  latestTranscriptionText: string;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection>
    <PropertyRow
      :label="t('common.duration')"
      :value="props.formatDurationSeconds(props.mediaMeta?.duration)"
    />
    <MediaMetadataList :media-meta="props.mediaMeta" />
    <PropertyRow
      :label="t('videoEditor.fileManager.video.container')"
      :value="props.mediaMeta?.container ?? '-'"
    />
    <PropertyRow
      v-if="props.mediaMeta?.video"
      :label="t('videoEditor.fileManager.video.videoCodec')"
    >
      {{ props.mediaMeta?.video?.parsedCodec ?? props.mediaMeta?.video?.codec ?? '-' }}
      <span v-if="props.mediaMeta?.video?.bitrate">
        , {{ props.formatBitrate(props.mediaMeta.video.bitrate) }}
      </span>
      <span v-if="props.mediaMeta?.video?.canDecode === false" class="text-red-400 ml-1">
        — {{ t('videoEditor.fileManager.compatibility.videoCodecUnsupported') }}
      </span>
    </PropertyRow>
    <PropertyRow
      v-if="props.mediaMeta?.audio"
      :label="t('videoEditor.fileManager.video.audioCodec')"
    >
      {{ props.mediaMeta?.audio?.parsedCodec ?? props.mediaMeta?.audio?.codec ?? '-' }}
      <span v-if="props.mediaMeta?.audio?.bitrate">
        , {{ props.formatBitrate(props.mediaMeta.audio.bitrate) }}
      </span>
      <span v-if="props.mediaMeta?.audio?.canDecode === false" class="text-red-400 ml-1">
        — {{ t('videoEditor.fileManager.compatibility.audioCodecUnsupported') }}
      </span>
    </PropertyRow>

    <MediaTranscriptionSection
      :latest-transcription-cache-key="props.latestTranscriptionCacheKey"
      :latest-transcription-was-cached="props.latestTranscriptionWasCached"
      :latest-transcription-text="props.latestTranscriptionText"
    />
  </PropertySection>
</template>
