<script setup lang="ts">
import { computed, toRef } from 'vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';

const props = defineProps<{
  items: { trackId: string; itemId: string }[];
}>();

const { t } = useI18n();

const itemsRef = toRef(props, 'items');
const {
  selectedClips,
  hasLockedLinks,
  hasGroupedClip,
  hasFreeClip,
  allDisabled,
  allMuted,
  isWaveformShown,
  isWaveformFull,
  isThumbnailsShown,
  hasAudioOrVideoWithAudio,
  hasVideo,
  handleUnlinkSelected,
  handleGroupSelected,
  handleUngroupSelected,
  handleDelete,
  toggleDisabled,
  toggleMuted,
  toggleShowWaveform,
  toggleWaveformMode,
  toggleShowThumbnails,
  handleSetUniformDuration,
  handleQuantizeSelected,
} = useClipBatchActions(itemsRef);

const selectedCountLabel = computed(() => {
  return (t as any)('fastcat.timeline.selectedClipsCount', '{count} clips selected', {
    count: props.items.length,
  }) as string;
});

const actions = computed(() => {
  const result: any[] = [
    {
      id: 'delete',
      label: t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      color: 'danger',
      onClick: handleDelete,
    },
    {
      id: 'toggle-disabled',
      label: allDisabled.value
        ? t('fastcat.timeline.enableClips', 'Enable clips')
        : t('fastcat.timeline.disableClips', 'Disable clips'),
      icon: allDisabled.value ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      onClick: toggleDisabled,
    },
    {
      id: 'group',
      label: t('fastcat.timeline.groupClips', 'Group clips'),
      icon: 'i-heroicons-link',
      hidden: props.items.length < 2,
      onClick: handleGroupSelected,
    },
    {
      id: 'ungroup',
      label: t('fastcat.timeline.ungroupClips', 'Ungroup clips'),
      icon: 'i-heroicons-link-slash',
      hidden: !hasGroupedClip.value,
      onClick: handleUngroupSelected,
    },
    {
      id: 'quantize',
      label: t('fastcat.timeline.quantize', 'Quantize to frames'),
      icon: 'i-heroicons-squares-2x2',
      hidden: !hasFreeClip.value,
      onClick: handleQuantizeSelected,
    },
    {
      id: 'unlink-audio',
      label: t('fastcat.timeline.unlinkAudio', 'Unlink audio'),
      icon: 'i-heroicons-link-slash',
      hidden: !hasLockedLinks.value,
      onClick: handleUnlinkSelected,
    },
  ];

  if (hasAudioOrVideoWithAudio.value) {
    result.push(
      {
        id: 'toggle-muted',
        label: allMuted.value
          ? t('fastcat.timeline.unmuteClips', 'Unmute clips')
          : t('fastcat.timeline.muteClips', 'Mute clips'),
        icon: allMuted.value ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
        onClick: toggleMuted,
      },
      {
        id: 'toggle-waveform',
        label: isWaveformShown.value
          ? t('fastcat.timeline.hideWaveform', 'Hide Waveform')
          : t('fastcat.timeline.showWaveform', 'Show Waveform'),
        icon: isWaveformShown.value ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
        onClick: toggleShowWaveform,
      },
      {
        id: 'waveform-mode',
        label: isWaveformFull.value
          ? t('fastcat.timeline.waveformHalf', 'Waveform: Half')
          : t('fastcat.timeline.waveformFull', 'Waveform: Full'),
        icon: 'i-heroicons-chart-bar',
        onClick: toggleWaveformMode,
      },
    );
  }

  if (hasVideo.value) {
    result.push({
      id: 'toggle-thumbnails',
      label: isThumbnailsShown.value
        ? t('fastcat.timeline.hideThumbnails', 'Hide Thumbnails')
        : t('fastcat.timeline.showThumbnails', 'Show Thumbnails'),
      icon: isThumbnailsShown.value ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onClick: toggleShowThumbnails,
    });
  }

  return result;
});
</script>

<template>
  <div class="flex flex-col gap-4 w-full">
    <PropertySection :title="t('fastcat.timeline.multipleSelection', 'Multiple Selection')">
      <div class="px-3 pb-3 flex flex-col gap-2">
        <span class="text-sm text-ui-text-muted">
          {{ selectedCountLabel }}
        </span>

        <PropertyTimecode
          :label="t('common.duration', 'Duration')"
          :model-value="selectedClips[0]?.timelineRange.durationUs ?? 0"
          @update:model-value="handleSetUniformDuration"
        />
      </div>
    </PropertySection>

    <PropertySection :title="t('common.actions.title', 'Actions')">
      <div class="px-3 pb-3">
        <PropertyActionList :actions="actions" />
      </div>
    </PropertySection>
  </div>
</template>
