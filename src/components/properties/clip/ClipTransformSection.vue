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
  toggleFlipHorizontal,
  toggleFlipVertical,
} = useClipTransform({
  clip: clipRef as Ref<import('~/timeline/types').TimelineClipItem>,
  trackKind: trackKindRef,
  updateTransform: (next) => emit('updateTransform', next),
});
</script>

<template>
  <div
    v-if="canEditTransform || props.canEditReversed"
    class="space-y-4 bg-ui-bg-elevated p-4 rounded-lg border border-ui-border"
  >
    <div
      class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-2"
    >
      {{ t('fastcat.clip.transform.title', 'Transform') }}
    </div>

    <div v-if="props.canEditReversed" class="flex items-center justify-between">
      <span class="text-sm text-ui-text">{{ t('fastcat.clip.reversed', 'Reverse Playback') }}</span>
      <USwitch :model-value="props.isReversed" @update:model-value="emit('toggleReversed')" />
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

      <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            transformScaleLinked
              ? t('fastcat.clip.transform.scale', 'Scale (%)')
              : t('fastcat.clip.transform.scaleX', 'Scale X (%)')
          }}</span>
          <UiWheelNumberInput v-model="transformScaleX" size="sm" :step="1" />
        </div>

        <div class="flex items-center justify-center pb-1">
          <UButton
            :icon="transformScaleLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'"
            size="2xs"
            color="neutral"
            variant="ghost"
            :class="[transformScaleLinked ? 'text-ui-primary' : 'text-ui-text-muted']"
            @click="transformScaleLinked = !transformScaleLinked"
          />
        </div>

        <div v-if="!transformScaleLinked" class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.scaleY', 'Scale Y (%)')
          }}</span>
          <UiWheelNumberInput v-model="transformScaleY" size="sm" :step="1" />
        </div>
        <div v-else class="flex flex-col gap-0.5" />
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.transform.rotation', 'Rotation (deg)')
        }}</span>
        <UiWheelNumberInput v-model="transformRotationDeg" size="sm" :step="1" />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.positionX', 'Position X (px)')
          }}</span>
          <UiWheelNumberInput v-model="transformPosX" size="sm" :step="1" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.positionY', 'Position Y (px)')
          }}</span>
          <UiWheelNumberInput v-model="transformPosY" size="sm" :step="1" />
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.transform.anchor', 'Anchor')
        }}</span>
        <USelectMenu
          v-model="transformAnchorPreset"
          :items="anchorPresetOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
        />
      </div>

      <div v-if="transformAnchorPreset === 'custom'" class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.anchorX', 'Anchor X (0..1)')
          }}</span>
          <UiWheelNumberInput v-model="transformAnchorX" size="sm" :step="0.01" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.anchorY', 'Anchor Y (0..1)')
          }}</span>
          <UiWheelNumberInput v-model="transformAnchorY" size="sm" :step="0.01" />
        </div>
      </div>
    </div>
  </div>
</template>
