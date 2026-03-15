<script setup lang="ts">
import { formatAudioChannels } from '~/utils/audio';

const props = defineProps<{
  mediaMeta: any;
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
      <div class="flex flex-col">
        <PropertyRow
          :label="t('common.duration', 'Duration')"
          :value="props.formatDurationSeconds(props.mediaMeta?.duration)"
        />
      </div>
      <PropertyRow
        :label="t('videoEditor.fileManager.video.resolution', 'Resolution')"
        :value="
          props.mediaMeta?.video?.displayWidth && props.mediaMeta?.video?.displayHeight
            ? `${props.mediaMeta.video.displayWidth}x${props.mediaMeta.video.displayHeight}`
            : '-'
        "
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.video.fps', 'FPS')"
        :value="props.mediaMeta?.video?.fps ?? '-'"
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.video.container', 'Container')"
        :value="props.mediaMeta?.container ?? '-'"
      />
      <PropertyRow :label="t('videoEditor.fileManager.video.videoCodec', 'Video codec')">
        {{ props.mediaMeta?.video?.parsedCodec ?? props.mediaMeta?.video?.codec ?? '-' }}
        <span v-if="props.mediaMeta?.video?.bitrate">
          , {{ props.formatBitrate(props.mediaMeta.video.bitrate) }}
        </span>
      </PropertyRow>
      <PropertyRow :label="t('videoEditor.fileManager.video.audioCodec', 'Audio codec')">
        {{ props.mediaMeta?.audio?.parsedCodec ?? props.mediaMeta?.audio?.codec ?? '-' }}
        <span v-if="props.mediaMeta?.audio?.bitrate">
          , {{ props.formatBitrate(props.mediaMeta.audio.bitrate) }}
        </span>
      </PropertyRow>
      <PropertyRow :label="t('videoEditor.fileManager.audio.channels', 'Channels')">
        {{ formatAudioChannels(props.mediaMeta?.audio?.channels) }},
        {{ props.mediaMeta?.audio?.sampleRate ? `${props.mediaMeta.audio.sampleRate} Hz` : '-' }}
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
