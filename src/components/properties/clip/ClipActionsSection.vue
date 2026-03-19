<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineClipItem, TrackKind } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

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

const commonActions = computed(() => [
  {
    id: 'rename',
    label: t('common.rename', 'Rename'),
    icon: 'i-heroicons-pencil',
    onClick: () => emit('rename'),
  },
  {
    id: 'delete',
    label: t('common.delete', 'Delete'),
    icon: 'i-heroicons-trash',
    color: 'danger' as const,
    onClick: () => emit('delete'),
  },
]);

const otherActions = computed(() => {
  const list: any[] = [];

  if (props.isFreePosition) {
    list.push({
      id: 'quantize',
      label: t('fastcat.timeline.quantize', 'Quantize to frames'),
      icon: 'i-heroicons-squares-2x2',
      onClick: () => emit('quantize'),
    });
  }

  if (props.hasLockedLinkedAudio || props.isLockedLinkedAudioClip) {
    list.push({
      id: 'unlinkAudio',
      label: t('fastcat.timeline.unlinkAudio', 'Unlink audio'),
      icon: 'i-heroicons-link-slash',
      onClick: () => emit('unlinkAudio'),
    });
  }

  if (props.isInLinkedGroup) {
    list.push({
      id: 'removeFromGroup',
      label: t('fastcat.timeline.removeFromGroup', 'Remove from group'),
      icon: 'i-heroicons-link-slash',
      onClick: () => emit('removeFromGroup'),
    });
  }

  if (props.clip.clipType === 'media') {
    list.push({
      id: 'showInFileManager',
      label: t('fastcat.clip.showInFileManager', 'Show in File Manager'),
      icon: 'i-heroicons-folder-open',
      onClick: () => emit('showInFileManager'),
    });
  }

  if (props.clip.clipType === 'timeline') {
    list.push({
      id: 'goToTimeline',
      label: t('fastcat.clip.goToTimeline', 'Go to timeline'),
      icon: 'i-heroicons-arrow-right-circle',
      onClick: () => emit('goToTimeline'),
    });
  }

  if (props.canShowWaveformToggle && props.trackKind === 'video') {
    list.push({
      id: 'toggleShowWaveform',
      label:
        props.clip.showWaveform === false
          ? t('fastcat.clip.showWaveform', 'Show Waveform')
          : t('fastcat.clip.hideWaveform', 'Hide Waveform'),
      icon: 'i-heroicons-eye',
      onClick: () => emit('toggleShowWaveform'),
    });

    list.push({
      id: 'toggleShowThumbnails',
      label:
        props.clip.showThumbnails === false
          ? t('fastcat.clip.showThumbnails', 'Show Thumbnails')
          : t('fastcat.clip.hideThumbnails', 'Hide Thumbnails'),
      icon: 'i-heroicons-photo',
      onClick: () => emit('toggleShowThumbnails'),
    });
  }

  if (
    props.canShowWaveformToggle &&
    (props.trackKind === 'audio' || props.clip.showWaveform !== false)
  ) {
    list.push({
      id: 'toggleAudioWaveformMode',
      label:
        (props.clip.audioWaveformMode || 'half') === 'full'
          ? t('fastcat.clip.halfWaveform', 'Half Waveform')
          : t('fastcat.clip.fullWaveform', 'Full Waveform'),
      icon: 'i-heroicons-chart-bar',
      onClick: () => emit('toggleAudioWaveformMode'),
    });
  }

  return list;
});
</script>

<template>
  <PropertySection :title="t('fastcat.clip.actions', 'Actions')">
    <div class="flex flex-col w-full">
      <PropertyActionList
        :actions="commonActions"
        :vertical="false"
        justify="center"
        size="xs"
        class="mb-2"
      >
        <template #action-rename>
          <span class="flex-1 text-center">{{ t('common.rename', 'Rename') }}</span>
        </template>
        <template #action-delete>
          <span class="flex-1 text-center">{{ t('common.delete', 'Delete') }}</span>
        </template>
      </PropertyActionList>

      <PropertyActionList :actions="otherActions" justify="center" size="xs" />
    </div>
  </PropertySection>
</template>
