<script setup lang="ts">
import type { AudioClipEffect, VideoClipEffect } from '~/timeline/types';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor.vue';

const props = defineProps<{
  clipType: string;
  videoEffects: VideoClipEffect[];
  audioEffects: AudioClipEffect[];
  canEditAudioEffects: boolean;
}>();

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
    v-model:enabled="isVideoEnabled"
    target="video"
    :effects="props.videoEffects"
    :title="t('fastcat.effects.videoTitle')"
    :add-label="t('fastcat.effects.add')"
    :empty-label="t('fastcat.effects.empty')"
    :has-toggle="true"
    :disabled="!isVideoEnabled"
    @update:effects="emit('updateVideoEffects', $event)"
  />

  <ClipEffectsEditor
    v-if="props.canEditAudioEffects"
    v-model:enabled="isAudioEnabled"
    target="audio"
    :effects="props.audioEffects"
    :has-toggle="true"
    :disabled="!isAudioEnabled"
    @update:effects="emit('updateAudioEffects', $event)"
  />
</template>
