<script setup lang="ts">
import type { AudioClipEffect, VideoClipEffect } from '~/timeline/types';
import AudioEffectsEditor from '~/components/effects/AudioEffectsEditor.vue';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';

const props = defineProps<{
  clipType: string;
  videoEffects: VideoClipEffect[];
  audioEffects: AudioClipEffect[];
  canEditAudioEffects: boolean;
}>();

const emit = defineEmits<{
  updateVideoEffects: [effects: VideoClipEffect[]];
  updateAudioEffects: [effects: AudioClipEffect[]];
}>();

const { t } = useI18n();

const isVideoEnabled = defineModel<boolean>('videoEnabled', { default: true });
const isAudioEnabled = defineModel<boolean>('audioEnabled', { default: true });
</script>

<template>
  <EffectsEditor
    v-model:toggle-value="isVideoEnabled"
    :effects="props.videoEffects"
    :title="t('fastcat.effects.videoTitle')"
    :add-label="t('fastcat.effects.add')"
    :empty-label="t('fastcat.effects.empty')"
    :has-toggle="true"
    :disabled="!isVideoEnabled"
    @update:effects="emit('updateVideoEffects', $event)"
  />

  <AudioEffectsEditor
    v-if="props.canEditAudioEffects"
    v-model:toggle-value="isAudioEnabled"
    :effects="props.audioEffects"
    :has-toggle="true"
    :disabled="!isAudioEnabled"
    @update:effects="emit('updateAudioEffects', $event)"
  />
</template>
