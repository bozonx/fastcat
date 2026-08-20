<script setup lang="ts">
import type {
  AnimatableParamPath,
  ClipSourceOrientation,
  ClipTransform,
  FixedAnimatableParamPath,
} from '~/timeline/types';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import ClipAnimationStopwatchButton from './ClipAnimationStopwatchButton.vue';
import { useClipTransform } from '~/composables/properties/useClipTransform';
import { computed, type Ref } from 'vue';

const props = defineProps<{
  clip: import('~/timeline/types').TimelineClipItem;
  trackKind: import('~/timeline/types').TrackKind;
  canEditReversed: boolean;
  isReversed: boolean;
  mediaMeta?: unknown;
  /**
   * Omitted by the multi-clip batch panel (keyframes are single-clip only in
   * v1 — each clip has its own local time, so there's no coherent "batch
   * animate"). When absent, every param reports as never-animated.
   */
  isParamAnimated?: (path: AnimatableParamPath) => boolean;
  getAnimatedValue?: (path: AnimatableParamPath, staticValue: number) => number;
}>();

const isParamAnimated = (path: AnimatableParamPath) => props.isParamAnimated?.(path) ?? false;
const getAnimatedValue = (path: AnimatableParamPath, staticValue: number) =>
  props.getAnimatedValue?.(path, staticValue) ?? staticValue;

const emit = defineEmits<{
  updateTransform: [next: ClipTransform];
  updateSourceOrientation: [next: ClipSourceOrientation];
  toggleReversed: [];
  toggleParamAnimation: [paths: FixedAnimatableParamPath[]];
  recordAnimatedValue: [path: AnimatableParamPath, value: number];
}>();

const { t } = useI18n();

const isEnabled = defineModel<boolean>('enabled', { default: true });

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
  transformFlipHorizontal,
  transformFlipVertical,
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
  isParamAnimated,
  onAnimatedParamEdit: (path, value) => emit('recordAnimatedValue', path, value),
  getAnimatedDisplayValue: getAnimatedValue,
});

const mediaMetaObj = computed(
  () => props.mediaMeta as unknown as Record<string, unknown> | undefined,
);
const mediaWidth = computed(
  () =>
    Number((mediaMetaObj.value?.video as Record<string, unknown> | undefined)?.displayWidth) ||
    Number((mediaMetaObj.value?.image as Record<string, unknown> | undefined)?.width) ||
    1920,
);
const mediaHeight = computed(
  () =>
    Number((mediaMetaObj.value?.video as Record<string, unknown> | undefined)?.displayHeight) ||
    Number((mediaMetaObj.value?.image as Record<string, unknown> | undefined)?.height) ||
    1080,
);
const canEditSourceLayout = computed(() => props.clip.clipType === 'media');

const sourceOrientationOptions = computed<Array<{ value: ClipSourceOrientation; label: string }>>(
  () => [
    { value: 'auto', label: t('fastcat.clip.transform.sourceOrientationOptions.auto') },
    { value: '0', label: t('fastcat.clip.transform.sourceOrientationOptions.deg0') },
    { value: '90', label: t('fastcat.clip.transform.sourceOrientationOptions.deg90') },
    { value: '180', label: t('fastcat.clip.transform.sourceOrientationOptions.deg180') },
    { value: '270', label: t('fastcat.clip.transform.sourceOrientationOptions.deg270') },
  ],
);

const sourceOrientation = computed({
  get: () => props.clip.sourceOrientation ?? 'auto',
  set: (val: ClipSourceOrientation) => emit('updateSourceOrientation', val),
});

const cropTopPx = computed({
  get: () => Math.round(((transformCropTop.value || 0) / 100) * mediaHeight.value),
  set: (val: number) => {
    if (!mediaHeight.value) return;
    transformCropTop.value = clampNumber((val / mediaHeight.value) * 100, 0, 100);
  },
});
const cropBottomPx = computed({
  get: () => Math.round(((transformCropBottom.value || 0) / 100) * mediaHeight.value),
  set: (val: number) => {
    if (!mediaHeight.value) return;
    transformCropBottom.value = clampNumber((val / mediaHeight.value) * 100, 0, 100);
  },
});
const cropLeftPx = computed({
  get: () => Math.round(((transformCropLeft.value || 0) / 100) * mediaWidth.value),
  set: (val: number) => {
    if (!mediaWidth.value) return;
    transformCropLeft.value = clampNumber((val / mediaWidth.value) * 100, 0, 100);
  },
});
const cropRightPx = computed({
  get: () => Math.round(((transformCropRight.value || 0) / 100) * mediaWidth.value),
  set: (val: number) => {
    if (!mediaWidth.value) return;
    transformCropRight.value = clampNumber((val / mediaWidth.value) * 100, 0, 100);
  },
});

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function handleResetAll() {
  resetAll();
  emit('updateSourceOrientation', 'auto');
}

// Logical groups: the panel toggles/animates position and scale as a pair of
// axes at once (they're almost always keyframed together), while rotation is
// a single leaf param.
const SCALE_PATHS: FixedAnimatableParamPath[] = ['transform.scale.x', 'transform.scale.y'];
const POSITION_PATHS: FixedAnimatableParamPath[] = ['transform.position.x', 'transform.position.y'];
const ROTATION_PATHS: FixedAnimatableParamPath[] = ['transform.rotationDeg'];
const ANCHOR_PATHS: FixedAnimatableParamPath[] = ['transform.anchor.x', 'transform.anchor.y'];
const CROP_PATHS: FixedAnimatableParamPath[] = [
  'transform.crop.top',
  'transform.crop.bottom',
  'transform.crop.left',
  'transform.crop.right',
];
const FLIP_PATHS: FixedAnimatableParamPath[] = [
  'transform.flipHorizontal',
  'transform.flipVertical',
];

const isScaleAnimated = computed(() => SCALE_PATHS.some((p) => isParamAnimated(p)));
const isPositionAnimated = computed(() => POSITION_PATHS.some((p) => isParamAnimated(p)));
const isRotationAnimated = computed(() => ROTATION_PATHS.some((p) => isParamAnimated(p)));
const isAnchorAnimated = computed(() => ANCHOR_PATHS.some((p) => isParamAnimated(p)));
const isCropAnimated = computed(() => CROP_PATHS.some((p) => isParamAnimated(p)));
const isFlipAnimated = computed(() => FLIP_PATHS.some((p) => isParamAnimated(p)));
</script>

<template>
  <PropertySection
    v-if="canEditTransform || props.canEditReversed"
    v-model:enabled="isEnabled"
    :title="t('fastcat.clip.transform.title')"
    has-toggle
  >
    <template #header-actions>
      <button
        v-if="canEditTransform"
        class="flex items-center gap-1 text-2xs text-ui-text-muted hover:text-ui-text disabled:opacity-50"
        :title="t('fastcat.clip.transform.resetAll')"
        :disabled="!isEnabled"
        @click="handleResetAll"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
      </button>
    </template>

    <div class="flex flex-col gap-4" :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
      <div v-if="canEditTransform" class="space-y-4">
        <!-- Reflect -->
        <div v-if="canEditSourceLayout" class="space-y-1">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.sourceOrientation')
          }}</span>
          <UiSelect
            v-model="sourceOrientation"
            :items="sourceOrientationOptions"
            value-key="value"
            label-key="label"
            size="sm"
            full-width
            :disabled="!isEnabled"
          />
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs text-ui-text-muted mr-1">{{
            t('fastcat.clip.transform.reflect')
          }}</span>
          <ClipAnimationStopwatchButton
            :active="isFlipAnimated"
            :disabled="!isEnabled"
            @toggle="emit('toggleParamAnimation', FLIP_PATHS)"
          />
          <UiActionButton
            icon="i-heroicons-arrows-right-left"
            size="xs"
            :color="transformFlipHorizontal ? 'primary' : 'neutral'"
            :variant="transformFlipHorizontal ? 'soft' : 'ghost'"
            class="text-ui-text-muted hover:text-ui-text"
            :title="t('fastcat.clip.transform.flipHorizontal')"
            :disabled="!isEnabled"
            @click="toggleFlipHorizontal"
          />
          <UiActionButton
            icon="i-heroicons-arrows-up-down"
            size="xs"
            :color="transformFlipVertical ? 'primary' : 'neutral'"
            :variant="transformFlipVertical ? 'soft' : 'ghost'"
            class="text-ui-text-muted hover:text-ui-text"
            :title="t('fastcat.clip.transform.flipVertical')"
            :disabled="!isEnabled"
            @click="toggleFlipVertical"
          />
        </div>

        <!-- Anchor -->
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-ui-text-muted">{{ t('fastcat.clip.transform.anchor') }}</span>
            <div class="flex items-center gap-1">
              <ClipAnimationStopwatchButton
                :active="isAnchorAnimated"
                :disabled="!isEnabled"
                @toggle="emit('toggleParamAnimation', ANCHOR_PATHS)"
              />
              <button
                class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text disabled:opacity-50"
                :disabled="!isEnabled"
                @click="resetAnchor"
              >
                <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
              </button>
            </div>
          </div>
          <UiSelect
            v-model="transformAnchorPreset"
            :items="anchorPresetOptions"
            value-key="value"
            label-key="label"
            size="sm"
            full-width
            :disabled="!isEnabled"
          />
          <div v-if="transformAnchorPreset === 'custom'" class="flex items-center gap-2 mt-2">
            <span class="text-2xs text-ui-text-muted uppercase tracking-tight">X</span>
            <UiWheelNumberInput
              v-model="transformAnchorX"
              size="sm"
              :step="0.01"
              :default-value="0.5"
              :disabled="!isEnabled"
            />
            <span class="text-2xs text-ui-text-muted uppercase tracking-tight ml-2">Y</span>
            <UiWheelNumberInput
              v-model="transformAnchorY"
              size="sm"
              :step="0.01"
              :default-value="0.5"
              :disabled="!isEnabled"
            />
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-ui-text-muted">{{
              transformScaleLinked
                ? t('fastcat.clip.transform.scale')
                : t('fastcat.clip.transform.scaleX')
            }}</span>
            <div class="flex items-center gap-1">
              <ClipAnimationStopwatchButton
                :active="isScaleAnimated"
                :disabled="!isEnabled"
                @toggle="emit('toggleParamAnimation', SCALE_PATHS)"
              />
              <button
                class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text disabled:opacity-50"
                :disabled="!isEnabled"
                @click="resetScale"
              >
                <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
              </button>
            </div>
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
            <UiWheelNumberInput
              v-model="transformScaleX"
              size="sm"
              :step="1"
              :wheel-step-multiplier="10"
              :default-value="100"
              full-width
              :disabled="!isEnabled"
            />

            <div class="flex items-center justify-center">
              <UiActionButton
                :icon="transformScaleLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'"
                size="2xs"
                color="neutral"
                variant="ghost"
                :class="[transformScaleLinked ? 'text-ui-primary' : 'text-ui-text-muted']"
                :disabled="!isEnabled"
                @click="transformScaleLinked = !transformScaleLinked"
              />
            </div>

            <div v-if="!transformScaleLinked">
              <UiWheelNumberInput
                v-model="transformScaleY"
                size="sm"
                :step="1"
                :wheel-step-multiplier="10"
                :default-value="100"
                full-width
                :disabled="!isEnabled"
              />
            </div>
            <div v-else />
          </div>
        </div>

        <div class="flex flex-col gap-0.5">
          <div class="flex items-center justify-between">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.rotation')
            }}</span>
            <div class="flex items-center gap-1">
              <ClipAnimationStopwatchButton
                :active="isRotationAnimated"
                :disabled="!isEnabled"
                @toggle="emit('toggleParamAnimation', ROTATION_PATHS)"
              />
              <button
                class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text disabled:opacity-50"
                :disabled="!isEnabled"
                @click="resetRotation"
              >
                <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
              </button>
            </div>
          </div>
          <UiWheelNumberInput
            v-model="transformRotationDeg"
            size="sm"
            :step="1"
            :wheel-step-multiplier="10"
            :default-value="0"
            :disabled="!isEnabled"
          />
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.transform.position')
            }}</span>
            <div class="flex items-center gap-1">
              <ClipAnimationStopwatchButton
                :active="isPositionAnimated"
                :disabled="!isEnabled"
                @toggle="emit('toggleParamAnimation', POSITION_PATHS)"
              />
              <button
                class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text disabled:opacity-50"
                :disabled="!isEnabled"
                @click="resetPosition"
              >
                <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
              </button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="flex items-center gap-1.5">
              <span
                class="text-2xs text-ui-text-muted uppercase tracking-tight w-2 text-center shrink-0"
                >X</span
              >
              <UiWheelNumberInput
                v-model="transformPosX"
                size="sm"
                :step="1"
                :wheel-step-multiplier="10"
                :default-value="0"
                full-width
                :disabled="!isEnabled"
              />
            </div>
            <div class="flex items-center gap-1.5">
              <span
                class="text-2xs text-ui-text-muted uppercase tracking-tight w-2 text-center shrink-0 ml-1"
                >Y</span
              >
              <UiWheelNumberInput
                v-model="transformPosY"
                size="sm"
                :step="1"
                :wheel-step-multiplier="10"
                :default-value="0"
                full-width
                :disabled="!isEnabled"
              />
            </div>
          </div>
        </div>

        <div class="space-y-1 border-t border-ui-border pt-2 mt-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-ui-text uppercase tracking-wide">
              {{ t('fastcat.clip.transform.crop') }}
            </span>
            <div class="flex items-center gap-1">
              <ClipAnimationStopwatchButton
                :active="isCropAnimated"
                :disabled="!isEnabled"
                @toggle="emit('toggleParamAnimation', CROP_PATHS)"
              />
              <button
                class="p-1 rounded hover:bg-ui-border-elevated text-ui-text-muted hover:text-ui-text disabled:opacity-50"
                :disabled="!isEnabled"
                @click="resetCrop"
              >
                <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
              </button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-2">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.cropTop')
              }}</span>
              <UiWheelNumberInput
                v-model="cropTopPx"
                size="sm"
                :step="1"
                :min="0"
                :wheel-step-multiplier="10"
                :default-value="0"
                full-width
                :disabled="!isEnabled"
              />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.cropBottom')
              }}</span>
              <UiWheelNumberInput
                v-model="cropBottomPx"
                size="sm"
                :step="1"
                :min="0"
                :wheel-step-multiplier="10"
                :default-value="0"
                full-width
                :disabled="!isEnabled"
              />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.cropLeft')
              }}</span>
              <UiWheelNumberInput
                v-model="cropLeftPx"
                size="sm"
                :step="1"
                :min="0"
                :wheel-step-multiplier="10"
                :default-value="0"
                full-width
                :disabled="!isEnabled"
              />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-ui-text-muted">{{
                t('fastcat.clip.transform.cropRight')
              }}</span>
              <UiWheelNumberInput
                v-model="cropRightPx"
                size="sm"
                :step="1"
                :min="0"
                :wheel-step-multiplier="10"
                :default-value="0"
                full-width
                :disabled="!isEnabled"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </PropertySection>
</template>
