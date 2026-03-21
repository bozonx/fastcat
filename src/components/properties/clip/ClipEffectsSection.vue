<script setup lang="ts">
import type { TimelineBlendMode, AudioClipEffect, VideoClipEffect } from '~/timeline/types';
import AudioEffectsEditor from '~/components/effects/AudioEffectsEditor.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';

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
      <UiSelect
        :model-value="props.blendMode"
        :items="props.blendModeOptions"
        value-key="value"
        label-key="label"
        size="sm"
        @update:model-value="emit('updateBlendMode', $event)"
      />
    </div>

    <UiSliderInput
      :label="t('fastcat.clip.opacity', 'Opacity')"
      :formatted-value="`${Math.round(props.opacity * 100)}%`"
      :model-value="props.opacity"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="1"
      :wheel-step-multiplier="10"
      @update:model-value="emit('updateOpacity', $event)"
    />
  </div>

  <EffectsEditor
    :effects="props.videoEffects"
    :title="t('fastcat.effects.videoTitle', 'Video effects')"
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
