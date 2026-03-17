<script setup lang="ts">
import type { TimelineBlendMode, AudioClipEffect, VideoClipEffect } from '~/timeline/types';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import AudioEffectsEditor from '~/components/common/AudioEffectsEditor.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';

const props = defineProps<{
  clipType: string;
  opacity: number;
  blendMode: TimelineBlendMode;
  videoEffects: VideoClipEffect[];
  audioEffects: AudioClipEffect[];
  canEditAudioEffects: boolean;
  blendModeOptions: Array<{ value: TimelineBlendMode; label: string }>;
}>();

const emit = defineEmits<{
  updateOpacity: [val: number];
  updateBlendMode: [val: TimelineBlendMode | string];
  updateVideoEffects: [effects: VideoClipEffect[]];
  updateAudioEffects: [effects: AudioClipEffect[]];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="props.clipType !== 'adjustment'"
    class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border"
  >
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-ui-text-muted">{{
        t('fastcat.clip.blendMode.title', 'Blend mode')
      }}</span>
      <USelectMenu
        :model-value="props.blendMode"
        :items="props.blendModeOptions"
        value-key="value"
        label-key="label"
        size="sm"
        @update:model-value="emit('updateBlendMode', $event)"
      />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-ui-text uppercase tracking-wide">
        {{ t('fastcat.clip.opacity', 'Opacity') }}
      </span>
      <span class="text-xs font-mono text-ui-text-muted"
        >{{ Math.round(props.opacity * 100) }}%</span
      >
    </div>
    <UiWheelSlider
      :model-value="props.opacity"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="1"
      @update:model-value="emit('updateOpacity', $event as number)"
    />
  </div>

  <EffectsEditor
    :effects="props.videoEffects"
    :title="t('fastcat.effects.clipTitle', 'Clip effects')"
    :add-label="t('fastcat.effects.add', 'Add')"
    :empty-label="t('fastcat.effects.empty', 'No effects')"
    @update:effects="emit('updateVideoEffects', $event)"
  />

  <AudioEffectsEditor
    v-if="props.canEditAudioEffects"
    :effects="props.audioEffects"
    @update:effects="emit('updateAudioEffects', $event)"
  />
</template>
