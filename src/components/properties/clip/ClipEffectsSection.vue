<script setup lang="ts">
import type { AudioClipEffect, VideoClipEffect } from '~/timeline/types';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor.vue';
import type { ClipEffectKeyframeHooks } from '~/components/effects/ClipEffectsEditor.vue';

const props = withDefaults(
  defineProps<{
    videoEffects: VideoClipEffect[];
    audioEffects: AudioClipEffect[];
    showVideoEffects?: boolean;
    showAudioEffects?: boolean;
    videoKeyframes?: ClipEffectKeyframeHooks;
  }>(),
  {
    showVideoEffects: true,
    showAudioEffects: false,
    videoKeyframes: undefined,
  },
);

const emit = defineEmits<{
  updateVideoEffects: [effects: Array<VideoClipEffect | AudioClipEffect>];
  updateAudioEffects: [effects: Array<VideoClipEffect | AudioClipEffect>];
}>();

const { t } = useI18n();

const isVideoEnabled = defineModel<boolean>('videoEnabled', { default: true });
const isAudioEnabled = defineModel<boolean>('audioEnabled', { default: true });
</script>

<template>
  <ClipEffectsEditor
    v-if="props.showVideoEffects !== false"
    v-model:enabled="isVideoEnabled"
    target="video"
    :effects="props.videoEffects"
    :keyframes="props.videoKeyframes"
    :title="t('fastcat.effects.videoTitle')"
    :add-label="t('fastcat.effects.add')"
    :empty-label="t('fastcat.effects.empty')"
    :has-toggle="true"
    :disabled="!isVideoEnabled"
    @update:effects="emit('updateVideoEffects', $event)"
  />

  <ClipEffectsEditor
    v-if="props.showAudioEffects"
    v-model:enabled="isAudioEnabled"
    target="audio"
    :effects="props.audioEffects"
    :has-toggle="true"
    :disabled="!isAudioEnabled"
    @update:effects="emit('updateAudioEffects', $event)"
  />
</template>
