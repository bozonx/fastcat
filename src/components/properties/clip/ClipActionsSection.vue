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
  isSoloed?: boolean;
}>();

const emit = defineEmits<{
  rename: [];
  copy: [];
  cut: [];
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
  toggleDisabled: [];
  toggleLocked: [];
  toggleMuted: [];
  toggleSolo: [];
  freezeFrame: [];
  resetFreezeFrame: [];
  extractAudio: [];
  returnAudio: [];
  replaceMedia: [];
  autoMontage: [];
}>();

const { t } = useI18n();

const hasAudio = computed(() => {
  return (
    props.trackKind === 'audio' ||
    props.clip.clipType === 'media' ||
    props.clip.clipType === 'timeline'
  );
});

const isMediaVideoClip = computed(() => {
  return props.trackKind === 'video' && props.clip.clipType === 'media';
});

const hasFreezeFrame = computed(() => {
  return typeof props.clip.freezeFrameSourceUs === 'number';
});

const canExtractAudio = computed(() => {
  return (
    props.trackKind === 'video' &&
    props.clip.clipType === 'media' &&
    !(props.clip as any).audioFromVideoDisabled
  );
});

const hasReturnFromVideoClip = computed(() => {
  return props.trackKind === 'video' && Boolean(props.clip.audioFromVideoDisabled);
});

const hasReturnFromLockedAudioClip = computed(() => {
  return (
    props.trackKind === 'audio' &&
    Boolean(props.clip.linkedVideoClipId) &&
    Boolean(props.clip.lockToLinkedVideo)
  );
});

const commonActions = computed(() => {
  const actions = [
    {
      id: 'delete',
      title: t('common.delete'),
      icon: 'i-heroicons-trash',
      onClick: () => emit('delete'),
    },
    {
      id: 'rename',
      title: t('common.rename'),
      icon: 'i-heroicons-pencil',
      onClick: () => emit('rename'),
    },
    {
      id: 'copy',
      title: t('common.copy'),
      icon: 'i-heroicons-document-duplicate',
      onClick: () => emit('copy'),
    },
    {
      id: 'cut',
      title: t('common.cut'),
      icon: 'i-heroicons-scissors',
      onClick: () => emit('cut'),
    },
    {
      id: 'toggle-disabled',
      title: props.clip.disabled
        ? t('fastcat.timeline.enableClip')
        : t('fastcat.timeline.disableClip'),
      icon: props.clip.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      onClick: () => emit('toggleDisabled'),
    },
  ];

  if (hasAudio.value) {
    actions.push({
      id: 'toggle-muted',
      title: props.clip.audioMuted
        ? t('fastcat.timeline.unmuteClip')
        : t('fastcat.timeline.muteClip'),
      icon: props.clip.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      onClick: () => emit('toggleMuted'),
    });

    actions.push({
      id: 'toggle-solo',
      title: props.isSoloed
        ? t('fastcat.timeline.unsolo')
        : t('fastcat.timeline.solo'),
      icon: props.isSoloed ? 'i-heroicons-star-solid' : 'i-heroicons-star',
      onClick: () => emit('toggleSolo'),
    });
  }

  actions.push({
    id: 'toggle-locked',
    title: props.clip.locked
      ? t('fastcat.timeline.unlockClip')
      : t('fastcat.timeline.lockClip'),
    icon: props.clip.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
    onClick: () => emit('toggleLocked'),
  });

  return actions;
});

const otherActions = computed(() => {
  const list: any[] = [];

  if (props.isFreePosition) {
    list.push({
      id: 'quantize',
      label: t('fastcat.timeline.quantize'),
      icon: 'i-heroicons-squares-2x2',
      onClick: () => emit('quantize'),
    });
  }

  if (props.linkedAudioClip) {
    list.push({
      id: 'goToLinkedAudio',
      label: t('fastcat.clip.goToLinkedAudio'),
      icon: 'i-heroicons-speaker-wave',
      color: 'primary' as const,
      onClick: () => emit('goToLinkedAudio'),
    });
  }

  if (props.linkedVideoClip) {
    list.push({
      id: 'goToLinkedVideo',
      label: t('fastcat.clip.goToLinkedVideo'),
      icon: 'i-heroicons-film',
      color: 'primary' as const,
      onClick: () => emit('goToLinkedVideo'),
    });
  }

  if (props.hasLockedLinkedAudio || props.isLockedLinkedAudioClip) {
    list.push({
      id: 'unlinkAudio',
      label: t('fastcat.timeline.unlinkAudio'),
      icon: 'i-heroicons-link-slash',
      onClick: () => emit('unlinkAudio'),
    });
  }

  if (props.isInLinkedGroup) {
    list.push({
      id: 'removeFromGroup',
      label: t('fastcat.timeline.removeFromGroup'),
      icon: 'i-heroicons-link-slash',
      onClick: () => emit('removeFromGroup'),
    });
  }

  if (props.clip.clipType === 'media') {
    list.push({
      id: 'replaceMedia',
      label: t('fastcat.clip.replaceMedia'),
      icon: 'i-heroicons-arrow-path',
      onClick: () => emit('replaceMedia'),
    });
    list.push({
      id: 'autoMontage',
      label: t('fastcat.timeline.autoMontage.title'),
      icon: 'i-heroicons-sparkles',
      color: 'primary' as const,
      onClick: () => emit('autoMontage'),
    });
    list.push({
      id: 'showInFileManager',
      label: t('fastcat.clip.showInFileManager'),
      icon: 'i-heroicons-folder-open',
      onClick: () => emit('showInFileManager'),
    });
  }

  if (props.clip.clipType === 'timeline') {
    list.push({
      id: 'goToTimeline',
      label: t('fastcat.clip.goToTimeline'),
      icon: 'i-heroicons-arrow-right-circle',
      onClick: () => emit('goToTimeline'),
    });
  }

  if (hasAudio.value) {
    list.push({
      id: 'toggleAudioWaveformMode',
      label:
        (props.clip.audioWaveformMode || 'half') === 'full'
          ? t('fastcat.clip.halfWaveform')
          : t('fastcat.clip.fullWaveform'),
      icon: 'i-heroicons-chart-bar',
      onClick: () => emit('toggleAudioWaveformMode'),
    });
  }

  if (props.canShowWaveformToggle && (props.trackKind === 'video' || props.trackKind === 'audio')) {
    list.push({
      id: 'toggleShowWaveform',
      label:
        props.clip.showWaveform === false
          ? t('fastcat.clip.showWaveform')
          : t('fastcat.clip.hideWaveform'),
      icon: 'i-heroicons-eye',
      onClick: () => emit('toggleShowWaveform'),
    });
  }

  if (props.canShowThumbnailsToggle && props.trackKind === 'video') {
    list.push({
      id: 'toggleShowThumbnails',
      label:
        props.clip.showThumbnails === false
          ? t('fastcat.clip.showThumbnails')
          : t('fastcat.clip.hideThumbnails'),
      icon: 'i-heroicons-photo',
      onClick: () => emit('toggleShowThumbnails'),
    });
  }

  if (isMediaVideoClip.value && !hasFreezeFrame.value) {
    list.push({
      id: 'freezeFrame',
      label: t('fastcat.timeline.freezeFrame'),
      icon: 'i-heroicons-pause-circle',
      onClick: () => emit('freezeFrame'),
    });
  }

  if (isMediaVideoClip.value && hasFreezeFrame.value) {
    list.push({
      id: 'resetFreezeFrame',
      label: t('fastcat.timeline.resetFreezeFrame'),
      icon: 'i-heroicons-play-circle',
      onClick: () => emit('resetFreezeFrame'),
    });
  }

  if (canExtractAudio.value) {
    list.push({
      id: 'extractAudio',
      label: t('fastcat.timeline.extractAudio'),
      icon: 'i-heroicons-musical-note',
      onClick: () => emit('extractAudio'),
    });
  }

  if (hasReturnFromVideoClip.value || hasReturnFromLockedAudioClip.value) {
    list.push({
      id: 'returnAudio',
      label: t('fastcat.timeline.returnAudio'),
      icon: 'i-heroicons-arrow-uturn-left',
      onClick: () => emit('returnAudio'),
    });
  }

  return list;
});
</script>

<template>
  <PropertySection :title="t('fastcat.clip.actions')">
    <div class="flex flex-col w-full">
      <PropertyActionList
        :actions="commonActions"
        :vertical="false"
        justify="start"
        variant="ghost"
        size="sm"
        class="mb-2"
      />

      <PropertyActionList :actions="otherActions" justify="start" size="sm" />
    </div>
  </PropertySection>
</template>
