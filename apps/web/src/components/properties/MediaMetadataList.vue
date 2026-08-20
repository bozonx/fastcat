<script setup lang="ts">
import type { MediaMetadata } from '~/stores/media.store';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import { formatAudioChannels } from '~/utils/audio';

const props = defineProps<{
  mediaMeta: MediaMetadata | null | undefined;
}>();

const { t } = useI18n();
</script>

<template>
  <template v-if="props.mediaMeta?.video">
    <PropertyRow
      :label="t('videoEditor.fileManager.video.resolution')"
      :value="
        props.mediaMeta.video.displayWidth && props.mediaMeta.video.displayHeight
          ? `${props.mediaMeta.video.displayWidth}x${props.mediaMeta.video.displayHeight}`
          : '-'
      "
    />
    <PropertyRow
      :label="t('videoEditor.fileManager.video.fps')"
      :value="props.mediaMeta.video.fps ?? '-'"
    />
  </template>
  <template v-if="props.mediaMeta?.audio">
    <PropertyRow :label="t('videoEditor.fileManager.audio.sound')">
      {{ formatAudioChannels(props.mediaMeta.audio.channels) }},
      {{ props.mediaMeta.audio.sampleRate ? `${props.mediaMeta.audio.sampleRate} Hz` : '-' }}
    </PropertyRow>
  </template>
</template>
