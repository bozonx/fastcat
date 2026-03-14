<script setup lang="ts">
import type { TimelineClipItem } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import TimecodeInput from '~/components/common/TimecodeInput.vue';
import { formatAudioChannels } from '~/utils/audio';

const props = defineProps<{
  clip: TimelineClipItem;
  mediaMeta: { video?: { displayWidth?: number; displayHeight?: number; fps?: number } | null; audio?: { channels?: number; sampleRate?: number } | null } | null;
}>();

const emit = defineEmits<{
  updateStartTime: [val: number];
  updateEndTime: [val: number];
  updateDuration: [val: number];
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection v-if="props.clip.clipType === 'media'" :title="t('common.source', 'Source File')">
    <PropertyRow :label="t('common.path', 'Path')" :value="props.clip.source.path" />
    <template v-if="props.mediaMeta?.video">
      <PropertyRow
        :label="t('videoEditor.fileManager.video.resolution', 'Resolution')"
        :value="
          props.mediaMeta.video.displayWidth && props.mediaMeta.video.displayHeight
            ? `${props.mediaMeta.video.displayWidth}x${props.mediaMeta.video.displayHeight}`
            : '-'
        "
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.video.fps', 'FPS')"
        :value="props.mediaMeta.video.fps ?? '-'"
      />
    </template>
    <template v-if="props.mediaMeta?.audio">
      <PropertyRow :label="t('videoEditor.fileManager.audio.channels', 'Channels')">
        {{ formatAudioChannels(props.mediaMeta.audio.channels) }},
        {{ props.mediaMeta.audio.sampleRate ? `${props.mediaMeta.audio.sampleRate} Hz` : '-' }}
      </PropertyRow>
    </template>
  </PropertySection>

  <PropertySection :title="t('fastcat.clip.info', 'Clip Info')">
    <div class="flex flex-col gap-0.5 mt-2">
      <span class="text-xs text-ui-text-muted">{{ t('common.duration', 'Duration') }}</span>
      <TimecodeInput
        :model-value="props.clip.timelineRange.durationUs"
        @update:model-value="emit('updateDuration', $event)"
      />
    </div>

    <div class="flex flex-col gap-0.5 mt-2">
      <span class="text-xs text-ui-text-muted">{{ t('common.start', 'Start Time') }}</span>
      <TimecodeInput
        :model-value="props.clip.timelineRange.startUs"
        @update:model-value="emit('updateStartTime', $event)"
      />
    </div>

    <div class="flex flex-col gap-0.5 mt-2">
      <span class="text-xs text-ui-text-muted">{{ t('common.end', 'End Time') }}</span>
      <TimecodeInput
        :model-value="props.clip.timelineRange.startUs + props.clip.timelineRange.durationUs"
        @update:model-value="emit('updateEndTime', $event)"
      />
    </div>
  </PropertySection>
</template>
