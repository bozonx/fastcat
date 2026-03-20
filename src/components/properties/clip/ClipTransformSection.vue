<script setup lang="ts">
import type { ClipTransform } from '~/timeline/types';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import { useClipTransform } from '~/composables/properties/useClipTransform';
import { computed, type Ref } from 'vue';

const props = defineProps<{
  clip: import('~/timeline/types').TimelineClipItem;
  trackKind: import('~/timeline/types').TrackKind;
  canEditReversed: boolean;
  isReversed: boolean;
}>();

const emit = defineEmits<{
  updateTransform: [next: ClipTransform];
  toggleReversed: [];
  updateSpeed: [speed: number];
}>();

const { t } = useI18n();

const clipRef = computed(() => props.clip);
const trackKindRef = computed(() => props.trackKind);

const {
  anchorPresetOptions,
  canEditTransform,
  transformAnchorPreset,
  transformAnchorX,
  transformAnchorY,
  transformPosX,
  transformPosY,
  transformRotationDeg,
  transformScaleLinked,
  transformScaleX,
  transformScaleY,
  transformCropTop,
  transformCropBottom,
  transformCropLeft,
  transformCropRight,
  toggleFlipHorizontal,
  toggleFlipVertical,
  resetScale,
  resetPosition,
  resetRotation,
  resetAnchor,
  resetCrop,
  resetAll,
} = useClipTransform({
  clip: clipRef as Ref<import('~/timeline/types').TimelineClipItem>,
  trackKind: trackKindRef,
  updateTransform: (next) => emit('updateTransform', next),
});

const speedPercent = computed({
  get: () => Math.abs(Math.round((props.clip.speed ?? 1) * 100)),
  set: (val: number) => {
    const absSpeed = Math.max(0.01, val / 100);
    const sign = props.isReversed ? -1 : 1;
    emit('updateSpeed', absSpeed * sign);
  },
});
</script>

<template>
  <div
    v-if="canEditTransform || props.canEditReversed"
    class="space-y-4 bg-ui-bg-elevated p-4 rounded-lg border border-ui-border"
  >
    <div
      class="flex items-center justify-between text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-2"
    >
      <span>{{ t('fastcat.clip.transform.title', 'Transform') }}</span>
      <UButton
        v-if="canEditTransform"
        icon="i-heroicons-arrow-path"
        size="2xs"
        color="neutral"
        variant="ghost"
        class="text-ui-text-muted hover:text-ui-text"
        :title="t('fastcat.clip.transform.resetAll', 'Reset All')"
        @click="resetAll"
      />
    </div>

    <div v-if="props.canEditReversed" class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-sm text-ui-text">{{
          t('fastcat.clip.reversed', 'Reverse Playback')
        }}</span>
        <USwitch :model-value="props.isReversed" @update:model-value="emit('toggleReversed')" />
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ t('fastcat.clip.speed', 'Speed (%)') }}</span>
        <div class="flex gap-2">
          <UiWheelNumberInput v-model="speedPercent" size="sm" :step="1" :min="1" :max="1000" />
          <UButton
            icon="i-heroicons-arrow-path"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            @click="emit('updateSpeed', props.isReversed ? -1 : 1)"
          />
        </div>
      </div>
    </div>

    <div v-if="canEditTransform" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <UButton
          icon="i-heroicons-arrows-right-left"
          size="2xs"
          color="neutral"
          variant="ghost"
          class="text-ui-text-muted hover:text-ui-text"
          :title="t('fastcat.clip.transform.flipHorizontal', 'Flip Horizontal')"
          @click="toggleFlipHorizontal"
        />
        <UButton
          icon="i-heroicons-arrows-up-down"
          size="2xs"
          color="neutral"
          variant="ghost"
          class="text-ui-text-muted hover:text-ui-text"
          :title="t('fastcat.clip.transform.flipVertical', 'Flip Vertical')"
          @click="toggleFlipVertical"
        />
      </div>

      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            transformScaleLinked
              ? t('fastcat.clip.transform.scale', 'Scale (%)')
              : t('fastcat.clip.transform.scaleX', 'Scale X (%)')
          }}</span>
          <UButton
            icon="i-heroicons-arrow-path"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            @click="resetScale"
          />
        </div>
        <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <UiWheelNumberInput v-model="transformScaleX" size="sm" :step="1" />

          <div class="flex items-center justify-center">
            <UButton
              :icon="transformScaleLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'"
              size="2xs"
              color="neutral"
              variant="ghost"
              :class="[transformScaleLinked ? 'text-ui-primary' : 'text-ui-text-muted']"
              @click="transformScaleLinked = !transformScaleLinked"
            />
          </div>

          <div v-if="!transformScaleLinked">
            <UiWheelNumberInput v-model="transformScaleY" size="sm" :step="1" />
          </div>
          <div v-else />
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.rotation', 'Rotation (deg)')
          }}</span>
          <UButton
            icon="i-heroicons-arrow-path"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            @click="resetRotation"
          />
        </div>
        <UiWheelNumberInput v-model="transformRotationDeg" size="sm" :step="1" />
      </div>

      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.position', 'Position (px)')
          }}</span>
          <UButton
            icon="i-heroicons-arrow-path"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            @click="resetPosition"
          />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-ui-text-muted uppercase tracking-tight">X</span>
            <UiWheelNumberInput v-model="transformPosX" size="sm" :step="1" />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-ui-text-muted uppercase tracking-tight">Y</span>
            <UiWheelNumberInput v-model="transformPosY" size="sm" :step="1" />
          </div>
        </div>
      </div>

      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.anchor', 'Anchor')
          }}</span>
          <UButton
            icon="i-heroicons-arrow-path"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            @click="resetAnchor"
          />
        </div>
        <USelectMenu
          v-model="transformAnchorPreset"
          :items="anchorPresetOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
        />
        <div v-if="transformAnchorPreset === 'custom'" class="grid grid-cols-2 gap-2 mt-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-ui-text-muted uppercase tracking-tight">X</span>
            <UiWheelNumberInput v-model="transformAnchorX" size="sm" :step="0.01" />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-ui-text-muted uppercase tracking-tight">Y</span>
            <UiWheelNumberInput v-model="transformAnchorY" size="sm" :step="0.01" />
          </div>
        </div>
      </div>

      <div class="space-y-1 border-t border-ui-border pt-2 mt-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-ui-text uppercase tracking-wide">
            {{ t('fastcat.clip.transform.crop', 'Crop (%)') }}
          </span>
          <UButton
            icon="i-heroicons-arrow-path"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            @click="resetCrop"
          />
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropTop', 'Top')
            }}</span>
            <UiWheelNumberInput v-model="transformCropTop" size="sm" :step="1" :min="0" :max="100" />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropBottom', 'Bottom')
            }}</span>
            <UiWheelNumberInput
              v-model="transformCropBottom"
              size="sm"
              :step="1"
              :min="0"
              :max="100"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropLeft', 'Left')
            }}</span>
            <UiWheelNumberInput
              v-model="transformCropLeft"
              size="sm"
              :step="1"
              :min="0"
              :max="100"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropRight', 'Right')
            }}</span>
            <UiWheelNumberInput
              v-model="transformCropRight"
              size="sm"
              :step="1"
              :min="0"
              :max="100"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
