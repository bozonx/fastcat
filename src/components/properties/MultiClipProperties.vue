<script setup lang="ts">
import { computed, toRef } from 'vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import PropertyField from '~/components/properties/PropertyField.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';
import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { blendModeOptions as rawBlendModeOptions } from '~/utils/constants';
import type { TimelineBlendMode } from '~/timeline/types';

const props = defineProps<{
  items: { trackId: string; itemId: string }[];
}>();

const { t } = useI18n();

const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const clipboardStore = useAppClipboard();

function handleCopyClips() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'copy',
    items: timelineStore.copySelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

function handleCutClips() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'cut',
    items: timelineStore.cutSelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

const itemsRef = toRef(props, 'items');
const {
  selectedClips,
  hasLockedLinks,
  hasGroupedClip,
  hasFreeClip,
  allDisabled,
  allMuted,
  allLocked,
  isWaveformShown,
  isWaveformFull,
  isThumbnailsShown,
  hasAudioOrVideoWithAudio,
  hasVideo,
  hasVideoOrImage,
  handleUnlinkSelected,
  handleGroupSelected,
  handleUngroupSelected,
  handleDelete,
  toggleDisabled,
  toggleMuted,
  toggleLocked,
  toggleShowWaveform,
  toggleWaveformMode,
  toggleShowThumbnails,
  handleSetUniformDuration,
  handleRelativeStartShift,
  handleRelativeEndShift,
  handleQuantizeSelected,
  handleBatchUpdateProperties,
} = useClipBatchActions(itemsRef, {
  timelineDoc: computed(() => timelineStore.timelineDoc),
  mediaMetadata: computed(() => mediaStore.mediaMetadata),
  batchApplyTimeline: (cmds) => timelineStore.batchApplyTimeline(cmds),
  clearSelection: () => timelineStore.clearSelection(),
});

const selectedCountLabel = computed(() => {
  return t('fastcat.timeline.selectedClipsCount', {
    count: props.items.length,
  });
});

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  rawBlendModeOptions.map((opt) => ({
    value: opt.value as TimelineBlendMode,
    label: t(opt.labelKey),
  })),
);

const firstClip = computed(() => selectedClips.value[0]);

const batchOpacity = computed({
  get: () => firstClip.value?.opacity ?? 1,
  set: (val: number) => handleBatchUpdateProperties({ opacity: val }),
});

const batchBlendMode = computed({
  get: () => firstClip.value?.blendMode ?? 'normal',
  set: (val: TimelineBlendMode) => handleBatchUpdateProperties({ blendMode: val }),
});

const batchAudioGain = computed({
  get: () => Number(firstClip.value?.audioGain ?? 0),
  set: (val: number) => handleBatchUpdateProperties({ audioGain: val }),
});

const batchScale = computed({
  get: () => Math.round((firstClip.value?.transform?.scale?.x ?? 1) * 100),
  set: (val: number) => {
    const s = val / 100;
    handleBatchUpdateProperties((clip) => ({
      transform: {
        ...(clip.transform ?? {}),
        scale: { x: s, y: s, linked: true },
      },
    }));
  },
});

const batchRotation = computed({
  get: () => firstClip.value?.transform?.rotationDeg ?? 0,
  set: (val: number) => {
    handleBatchUpdateProperties((clip) => ({
      transform: {
        ...(clip.transform ?? {}),
        rotationDeg: val,
      },
    }));
  },
});

const batchPosX = computed({
  get: () => firstClip.value?.transform?.position?.x ?? 0,
  set: (val: number) => {
    handleBatchUpdateProperties((clip) => ({
      transform: {
        ...(clip.transform ?? {}),
        position: {
          x: val,
          y: clip.transform?.position?.y ?? 0,
        },
      },
    }));
  },
});

const batchPosY = computed({
  get: () => firstClip.value?.transform?.position?.y ?? 0,
  set: (val: number) => {
    handleBatchUpdateProperties((clip) => ({
      transform: {
        ...(clip.transform ?? {}),
        position: {
          x: clip.transform?.position?.x ?? 0,
          y: val,
        },
      },
    }));
  },
});

const commonActions = computed(() => {
  const actions = [
    {
      id: 'copy',
      title: t('common.copy', 'Copy'),
      icon: 'i-heroicons-document-duplicate',
      onClick: handleCopyClips,
    },
    {
      id: 'cut',
      title: t('common.cut', 'Cut'),
      icon: 'i-heroicons-scissors',
      onClick: handleCutClips,
    },
    {
      id: 'delete',
      title: t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      onClick: handleDelete,
    },
    {
      id: 'toggle-disabled',
      title: allDisabled.value
        ? t('fastcat.timeline.enableClips', 'Enable clips')
        : t('fastcat.timeline.disableClips', 'Disable clips'),
      icon: allDisabled.value ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      onClick: toggleDisabled,
    },
    {
      id: 'toggle-locked',
      title: allLocked.value
        ? t('fastcat.timeline.unlockClips', 'Unlock clips')
        : t('fastcat.timeline.lockClips', 'Lock clips'),
      icon: allLocked.value ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
      onClick: toggleLocked,
    },
  ];

  if (hasAudioOrVideoWithAudio.value) {
    actions.push({
      id: 'toggle-muted',
      title: allMuted.value
        ? t('fastcat.timeline.unmuteClips', 'Unmute clips')
        : t('fastcat.timeline.muteClips', 'Mute clips'),
      icon: allMuted.value ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      onClick: toggleMuted,
    });
  }

  return actions;
});

const otherActions = computed(() => {
  const result: Array<{
    id: string;
    label: string;
    icon: string;
    hidden?: boolean;
    onClick: () => void;
  }> = [];

  result.push({
    id: 'group',
    label: t('fastcat.timeline.groupClips', 'Group clips'),
    icon: 'i-heroicons-link',
    hidden: props.items.length < 2,
    onClick: handleGroupSelected,
  });

  result.push({
    id: 'ungroup',
    label: t('fastcat.timeline.ungroupClips', 'Ungroup clips'),
    icon: 'i-heroicons-link-slash',
    hidden: !hasGroupedClip.value,
    onClick: handleUngroupSelected,
  });

  if (hasFreeClip.value) {
    result.push({
      id: 'quantize',
      label: t('fastcat.timeline.quantize', 'Quantize to frames'),
      icon: 'i-heroicons-squares-2x2',
      onClick: handleQuantizeSelected,
    });
  }

  if (hasLockedLinks.value) {
    result.push({
      id: 'unlink-audio',
      label: t('fastcat.timeline.unlinkAudio', 'Unlink audio'),
      icon: 'i-heroicons-link-slash',
      onClick: handleUnlinkSelected,
    });
  }

  if (hasAudioOrVideoWithAudio.value) {
    result.push({
      id: 'toggle-waveform',
      label: isWaveformShown.value
        ? t('fastcat.timeline.hideWaveform', 'Hide Waveform')
        : t('fastcat.timeline.showWaveform', 'Show Waveform'),
      icon: isWaveformShown.value ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onClick: toggleShowWaveform,
    });

    result.push({
      id: 'waveform-mode',
      label: isWaveformFull.value
        ? t('fastcat.timeline.waveformHalf', 'Waveform: Half')
        : t('fastcat.timeline.waveformFull', 'Waveform: Full'),
      icon: 'i-heroicons-chart-bar',
      onClick: toggleWaveformMode,
    });
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

        <PropertyField :label="t('fastcat.timeline.startShift', 'Start Shift')" class="mt-2">
          <UiTimecode :model-value="0" @update:model-value="handleRelativeStartShift" />
        </PropertyField>

        <PropertyField :label="t('fastcat.timeline.endShift', 'End Shift')" class="mt-2">
          <UiTimecode :model-value="0" @update:model-value="handleRelativeEndShift" />
        </PropertyField>

        <div v-if="hasVideoOrImage" class="space-y-4 pt-2 border-t border-ui-border">
          <UiSliderInput
            :label="t('fastcat.clip.opacity', 'Opacity')"
            unit="%"
            :model-value="batchOpacity"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="1"
            :wheel-step-multiplier="10"
            @update:model-value="batchOpacity = $event"
          />

          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.blendMode.title', 'Blend Mode')
            }}</span>
            <UiSelect
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
            <UiWheelNumberInput
              v-model="batchAudioGain"
              size="sm"
              :step="0.1"
              :min="-60"
              :max="20"
            />
          </div>
        </div>
      </div>
    </PropertySection>

    <PropertySection :title="t('common.actions.title', 'Actions')">
      <div class="flex flex-col w-full px-3 pb-3">
        <PropertyActionList
          :actions="commonActions"
          :vertical="false"
          justify="start"
          variant="ghost"
          size="xs"
          class="mb-2"
        />

        <PropertyActionList :actions="otherActions" justify="start" size="xs" />
      </div>
    </PropertySection>
  </div>
</template>
