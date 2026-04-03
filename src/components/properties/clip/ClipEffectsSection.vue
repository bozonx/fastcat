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
</script>

<template>
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
