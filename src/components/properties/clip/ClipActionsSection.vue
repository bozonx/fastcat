<script setup lang="ts">
import type { TimelineClipItem, TrackKind } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  trackKind: TrackKind;
  isFreePosition: boolean;
  hasLockedLinkedAudio: boolean;
  isLockedLinkedAudioClip: boolean;
  isInLinkedGroup: boolean;
  canShowWaveformToggle: boolean;
  canShowThumbnailsToggle: boolean;
}>();

const emit = defineEmits<{
  rename: [];
  delete: [];
  quantize: [];
  unlinkAudio: [];
  removeFromGroup: [];
  showInFileManager: [];
  goToTimeline: [];
  toggleShowWaveform: [];
  toggleShowThumbnails: [];
  toggleAudioWaveformMode: [];
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('fastcat.clip.actions', 'Actions')">
    <div class="flex gap-2 w-full">
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-pencil"
        class="flex-1 justify-center"
        @click="emit('rename')"
      >
        {{ t('common.rename', 'Rename') }}
      </UButton>
      <UButton
        size="xs"
        variant="soft"
        color="red"
        icon="i-heroicons-trash"
        class="flex-1 justify-center"
        @click="emit('delete')"
      >
        {{ t('common.delete', 'Delete') }}
      </UButton>
    </div>

    <UButton
      v-if="props.isFreePosition"
      size="xs"
      variant="soft"
      color="neutral"
      icon="i-heroicons-squares-2x2"
      class="w-full justify-center mt-2"
      @click="emit('quantize')"
    >
      {{ t('fastcat.timeline.quantize', 'Quantize to frames') }}
    </UButton>

    <UButton
      v-if="props.hasLockedLinkedAudio || props.isLockedLinkedAudioClip"
      size="xs"
      variant="soft"
      color="neutral"
      icon="i-heroicons-link-slash"
      class="w-full justify-center mt-2"
      @click="emit('unlinkAudio')"
    >
      {{ t('fastcat.timeline.unlinkAudio', 'Unlink audio') }}
    </UButton>

    <UButton
      v-if="props.isInLinkedGroup"
      size="xs"
      variant="soft"
      color="neutral"
      icon="i-heroicons-link-slash"
      class="w-full justify-center mt-2"
      @click="emit('removeFromGroup')"
    >
      {{ t('fastcat.timeline.removeFromGroup', 'Remove from group') }}
    </UButton>

    <UButton
      v-if="props.clip.clipType === 'media'"
      size="xs"
      variant="soft"
      color="neutral"
      icon="i-heroicons-folder-open"
      class="w-full justify-center mt-2"
      @click="emit('showInFileManager')"
    >
      {{ t('fastcat.clip.showInFileManager', 'Show in File Manager') }}
    </UButton>

    <UButton
      v-if="props.clip.clipType === 'timeline'"
      size="xs"
      variant="soft"
      color="neutral"
      icon="i-heroicons-arrow-right-circle"
      class="w-full justify-center mt-2"
      @click="emit('goToTimeline')"
    >
      {{ t('fastcat.clip.goToTimeline', 'Go to timeline') }}
    </UButton>

    <template v-if="props.canShowWaveformToggle">
      <UButton
        v-if="props.trackKind === 'video'"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-eye"
        class="w-full justify-center mt-2"
        @click="emit('toggleShowWaveform')"
      >
        {{
          props.clip.showWaveform === false
            ? t('fastcat.clip.showWaveform', 'Show Waveform')
            : t('fastcat.clip.hideWaveform', 'Hide Waveform')
        }}
      </UButton>

      <UButton
        v-if="props.trackKind === 'video'"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-photo"
        class="w-full justify-center mt-2"
        @click="emit('toggleShowThumbnails')"
      >
        {{
          props.clip.showThumbnails === false
            ? t('fastcat.clip.showThumbnails', 'Show Thumbnails')
            : t('fastcat.clip.hideThumbnails', 'Hide Thumbnails')
        }}
      </UButton>

      <UButton
        v-if="props.trackKind === 'audio' || props.clip.showWaveform !== false"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-chart-bar"
        class="w-full justify-center mt-2"
        @click="emit('toggleAudioWaveformMode')"
      >
        {{
          (props.clip.audioWaveformMode || 'half') === 'full'
            ? t('fastcat.clip.halfWaveform', 'Half Waveform')
            : t('fastcat.clip.fullWaveform', 'Full Waveform')
        }}
      </UButton>
    </template>
  </PropertySection>
</template>
