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
  linkedAudioClip?: TimelineClipItem | null;
  linkedVideoClip?: TimelineClipItem | null;
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
  goToLinkedAudio: [];
  goToLinkedVideo: [];
}>();

const { t } = useI18n();

const commonActions = computed(() => [
  {
    id: 'rename',
    title: t('common.rename', 'Rename'),
    icon: 'i-heroicons-pencil',
    onClick: () => emit('rename'),
  },
  {
    id: 'delete',
    title: t('common.delete', 'Delete'),
    icon: 'i-heroicons-trash',
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

  if (props.linkedAudioClip) {
    list.push({
      id: 'goToLinkedAudio',
      label: t('fastcat.clip.goToLinkedAudio', 'Go to linked audio'),
      icon: 'i-heroicons-speaker-wave',
      color: 'primary' as const,
      onClick: () => emit('goToLinkedAudio'),
    });
  }

  if (props.linkedVideoClip) {
    list.push({
      id: 'goToLinkedVideo',
      label: t('fastcat.clip.goToLinkedVideo', 'Go to linked video'),
      icon: 'i-heroicons-film',
      color: 'primary' as const,
      onClick: () => emit('goToLinkedVideo'),
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

  if (props.canShowWaveformToggle && (props.trackKind === 'video' || props.trackKind === 'audio')) {
    list.push({
      id: 'toggleShowWaveform',
      label:
        props.clip.showWaveform === false
          ? t('fastcat.clip.showWaveform', 'Show Waveform')
          : t('fastcat.clip.hideWaveform', 'Hide Waveform'),
      icon: 'i-heroicons-eye',
      onClick: () => emit('toggleShowWaveform'),
    });
  }

  if (props.canShowThumbnailsToggle && props.trackKind === 'video') {
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
        justify="start"
        variant="ghost"
        size="xs"
        class="mb-2"
      />

      <PropertyActionList
        :actions="otherActions"
        justify="start"
        size="xs"
      />
    </div>
  </PropertySection>
</template>
