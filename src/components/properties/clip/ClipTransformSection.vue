<script setup lang="ts">
import type { ClipTransform } from '~/timeline/types';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import { useClipTransform } from '~/composables/properties/useClipTransform';
import { computed, type Ref } from 'vue';

const props = defineProps<{
  clip: import('~/timeline/types').TimelineClipItem;
  trackKind: import('~/timeline/types').TrackKind;
  canEditReversed: boolean;
  isReversed: boolean;
  mediaMeta?: any;
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

const speedMultiplier = computed({
  get: () => {
    return Number((props.clip.speed ?? 1).toFixed(2));
  },
  set: (val: number) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return;
    emit('updateSpeed', num);
  },
});

const mediaWidth = computed(() => props.mediaMeta?.video?.displayWidth ?? props.mediaMeta?.image?.width ?? 1920);
const mediaHeight = computed(() => props.mediaMeta?.video?.displayHeight ?? props.mediaMeta?.image?.height ?? 1080);

const cropTopPx = computed({
  get: () => Math.round(((transformCropTop.value || 0) / 100) * mediaHeight.value),
  set: (val: number) => { transformCropTop.value = clampNumber(((val || 0) / mediaHeight.value) * 100, 0, 100); },
});
const cropBottomPx = computed({
  get: () => Math.round(((transformCropBottom.value || 0) / 100) * mediaHeight.value),
  set: (val: number) => { transformCropBottom.value = clampNumber(((val || 0) / mediaHeight.value) * 100, 0, 100); },
});
const cropLeftPx = computed({
  get: () => Math.round(((transformCropLeft.value || 0) / 100) * mediaWidth.value),
  set: (val: number) => { transformCropLeft.value = clampNumber(((val || 0) / mediaWidth.value) * 100, 0, 100); },
});
const cropRightPx = computed({
  get: () => Math.round(((transformCropRight.value || 0) / 100) * mediaWidth.value),
  set: (val: number) => { transformCropRight.value = clampNumber(((val || 0) / mediaWidth.value) * 100, 0, 100); },
});

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
</script>

<template>
  <PropertySection
    v-if="canEditTransform || props.canEditReversed"
    :title="t('fastcat.clip.transform.title', 'Transform')"
  >
    <template #header-actions>
      <button
        v-if="canEditTransform"
        class="flex items-center gap-1 text-[10px] text-ui-text-muted hover:text-ui-text"
        :title="t('fastcat.clip.transform.resetAll', 'Reset All')"
        @click="() => { resetAll(); emit('updateSpeed', 1); }"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
      </button>
    </template>

    <div class="flex flex-col gap-4">

    <div v-if="props.canEditReversed" class="space-y-4">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ t('fastcat.clip.speedMultiplier', 'Speed (x)') }}</span>
        <div class="flex items-center gap-2">
          <UiWheelSlider
            v-model="speedMultiplier"
            :min="-5"
            :max="5"
            :step="0.01"
            :default-value="1"
            class="flex-1"
          />
          <UiWheelNumberInput
            v-model="speedMultiplier"
            size="sm"
            :step="0.1"
            :min="-50"
            :max="50"
            :default-value="1"
            :wheel-step-multiplier="10"
            class="w-14"
          />
          <button
            class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text shrink-0"
            :title="t('common.reset', 'Reset')"
            @click="emit('updateSpeed', 1)"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="canEditTransform" class="space-y-4">
      <!-- Anchor -->
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.anchor', 'Anchor')
          }}</span>
          <button
            class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text"
            @click="resetAnchor"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
          </button>
        </div>
        <USelectMenu
          v-model="transformAnchorPreset"
          :items="anchorPresetOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
        />
        <div v-if="transformAnchorPreset === 'custom'" class="flex items-center gap-2 mt-2">
          <span class="text-[10px] text-ui-text-muted uppercase tracking-tight">X</span>
          <UiWheelNumberInput v-model="transformAnchorX" size="sm" :step="0.01" :default-value="0.5" />
          <span class="text-[10px] text-ui-text-muted uppercase tracking-tight ml-2">Y</span>
          <UiWheelNumberInput v-model="transformAnchorY" size="sm" :step="0.01" :default-value="0.5" />
        </div>
      </div>

      <!-- Reflect -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-ui-text-muted mr-1">{{ t('fastcat.clip.transform.reflect', 'Отразить:') }}</span>
        <UButton
          icon="i-heroicons-arrows-right-left"
          size="xs"
          color="neutral"
          variant="ghost"
          class="text-ui-text-muted hover:text-ui-text"
          :title="t('fastcat.clip.transform.flipHorizontal', 'Flip Horizontal')"
          @click="toggleFlipHorizontal"
        />
        <UButton
          icon="i-heroicons-arrows-up-down"
          size="xs"
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
          <button
            class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text"
            @click="resetScale"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
          </button>
        </div>
        <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <UiWheelNumberInput v-model="transformScaleX" size="sm" :step="1" :wheel-step-multiplier="10" :default-value="100" />

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
            <UiWheelNumberInput v-model="transformScaleY" size="sm" :step="1" :wheel-step-multiplier="10" :default-value="100" />
          </div>
          <div v-else />
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.rotation', 'Rotation (deg)')
          }}</span>
          <button
            class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text"
            @click="resetRotation"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
          </button>
        </div>
        <UiWheelNumberInput v-model="transformRotationDeg" size="sm" :step="1" :wheel-step-multiplier="10" :default-value="0" />
      </div>

      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.position', 'Position (px)')
          }}</span>
          <button
            class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text"
            @click="resetPosition"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
          </button>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-ui-text-muted uppercase tracking-tight w-2 text-center">X</span>
          <UiWheelNumberInput v-model="transformPosX" size="sm" :step="1" :wheel-step-multiplier="10" :default-value="0" />
          <span class="text-[10px] text-ui-text-muted uppercase tracking-tight w-2 text-center ml-1">Y</span>
          <UiWheelNumberInput v-model="transformPosY" size="sm" :step="1" :wheel-step-multiplier="10" :default-value="0" />
        </div>
      </div>



      <div class="space-y-1 border-t border-ui-border pt-2 mt-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-ui-text uppercase tracking-wide">
            {{ t('fastcat.clip.transform.crop', 'Crop (px)') }}
          </span>
          <button
            class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text"
            @click="resetCrop"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
          </button>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropTop', 'Top')
            }}</span>
            <UiWheelNumberInput v-model="cropTopPx" size="sm" :step="1" :min="0" :wheel-step-multiplier="10" :default-value="0" />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropBottom', 'Bottom')
            }}</span>
            <UiWheelNumberInput
              v-model="cropBottomPx"
              size="sm"
              :step="1"
              :min="0"
              :wheel-step-multiplier="10"
              :default-value="0"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropLeft', 'Left')
            }}</span>
            <UiWheelNumberInput
              v-model="cropLeftPx"
              size="sm"
              :step="1"
              :min="0"
              :wheel-step-multiplier="10"
              :default-value="0"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.cropRight', 'Right')
            }}</span>
            <UiWheelNumberInput
              v-model="cropRightPx"
              size="sm"
              :step="1"
              :min="0"
              :wheel-step-multiplier="10"
              :default-value="0"
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  </PropertySection>
</template>
