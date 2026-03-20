<script setup lang="ts">
import { computed, toRef } from 'vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';

const props = defineProps<{
  items: { trackId: string; itemId: string }[];
}>();

const { t } = useI18n();

const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();

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
  handleBatchUpdateProperties,
} = useClipBatchActions(itemsRef, {
  timelineDoc: computed(() => timelineStore.timelineDoc),
  mediaMetadata: computed(() => mediaStore.mediaMetadata),
  batchApplyTimeline: (cmds) => timelineStore.batchApplyTimeline(cmds),
  clearSelection: () => timelineStore.clearSelection(),
});

const selectedCountLabel = computed(() => {
  return (t as any)('fastcat.timeline.selectedClipsCount', '{count} clips selected', {
    count: props.items.length,
  }) as string;
});

const blendModeOptions = computed(() => [
  { value: 'normal', label: t('fastcat.clip.blendMode.normal') },
  { value: 'add', label: t('fastcat.clip.blendMode.add') },
  { value: 'multiply', label: t('fastcat.clip.blendMode.multiply') },
  { value: 'screen', label: t('fastcat.clip.blendMode.screen') },
  { value: 'darken', label: t('fastcat.clip.blendMode.darken') },
  { value: 'lighten', label: t('fastcat.clip.blendMode.lighten') },
]);

const firstClip = computed(() => selectedClips.value[0]);

const batchOpacity = computed({
  get: () => Math.round((firstClip.value?.opacity ?? 1) * 100),
  set: (val: number) => handleBatchUpdateProperties({ opacity: val / 100 }),
});

const batchBlendMode = computed({
  get: () => firstClip.value?.blendMode ?? 'normal',
  set: (val: any) => handleBatchUpdateProperties({ blendMode: val }),
});

const batchAudioGain = computed({
  get: () => Number(firstClip.value?.audioGain ?? 0),
  set: (val: number) => handleBatchUpdateProperties({ audioGain: val }),
});

const batchScale = computed({
  get: () => Math.round((firstClip.value?.transform?.scale?.x ?? 1) * 100),
  set: (val: number) => {
    const s = val / 100;
    handleBatchUpdateProperties({
      transform: {
        ...(firstClip.value?.transform ?? {}),
        scale: { x: s, y: s, linked: true },
      },
    } as any);
  },
});

const batchRotation = computed({
  get: () => firstClip.value?.transform?.rotationDeg ?? 0,
  set: (val: number) => {
    handleBatchUpdateProperties({
      transform: {
        ...(firstClip.value?.transform ?? {}),
        rotationDeg: val,
      },
    } as any);
  },
});

const batchPosX = computed({
  get: () => firstClip.value?.transform?.position?.x ?? 0,
  set: (val: number) => {
    handleBatchUpdateProperties({
      transform: {
        ...(firstClip.value?.transform ?? {}),
        position: {
          x: val,
          y: firstClip.value?.transform?.position?.y ?? 0,
        },
      },
    } as any);
  },
});

const batchPosY = computed({
  get: () => firstClip.value?.transform?.position?.y ?? 0,
  set: (val: number) => {
    handleBatchUpdateProperties({
      transform: {
        ...(firstClip.value?.transform ?? {}),
        position: {
          x: firstClip.value?.transform?.position?.x ?? 0,
          y: val,
        },
      },
    } as any);
  },
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
      <div class="px-3 pb-3 flex flex-col gap-4">
        <span class="text-sm text-ui-text-muted">
          {{ selectedCountLabel }}
        </span>

        <PropertyTimecode
          :label="t('common.duration', 'Duration')"
          :model-value="firstClip?.timelineRange.durationUs ?? 0"
          @update:model-value="handleSetUniformDuration"
        />

        <div v-if="hasVideo" class="space-y-4 pt-2 border-t border-ui-border">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.opacity', 'Opacity (%)')
            }}</span>
            <UiWheelNumberInput v-model="batchOpacity" size="sm" :step="1" :min="0" :max="100" />
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.blendMode.title', 'Blend Mode')
            }}</span>
            <USelectMenu
              v-model="batchBlendMode"
              :items="blendModeOptions"
              value-key="value"
              label-key="label"
              size="sm"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.scale', 'Scale (%)')
              }}</span>
              <UiWheelNumberInput v-model="batchScale" size="sm" :step="1" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.rotation', 'Rotation (deg)')
              }}</span>
              <UiWheelNumberInput v-model="batchRotation" size="sm" :step="1" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.positionX', 'Position X')
              }}</span>
              <UiWheelNumberInput v-model="batchPosX" size="sm" :step="1" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.positionY', 'Position Y')
              }}</span>
              <UiWheelNumberInput v-model="batchPosY" size="sm" :step="1" />
            </div>
          </div>
        </div>

        <div v-if="hasAudioOrVideoWithAudio" class="pt-2 border-t border-ui-border">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.audioGain', 'Audio Gain (dB)')
            }}</span>
            <UiWheelNumberInput v-model="batchAudioGain" size="sm" :step="0.1" :min="-60" :max="20" />
          </div>
        </div>
      </div>
    </PropertySection>

    <PropertySection :title="t('common.actions.title', 'Actions')">
      <div class="px-3 pb-3">
        <PropertyActionList :actions="actions" />
      </div>
    </PropertySection>
  </div>
</template>
