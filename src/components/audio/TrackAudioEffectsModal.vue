<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useModalOpenModel } from '~/composables/ui/useModalOpenModel';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor.vue';
import type { AudioClipEffect, VideoClipEffect } from '~/timeline/types';

const props = defineProps<{
  trackId: string;
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const isOpen = useModalOpenModel(props, emit);

const track = computed(() => timelineStore.timelineDoc?.tracks.find((t) => t.id === props.trackId));

const trackName = computed(() => track.value?.name || '');

const trackAudioEffects = computed(() =>
  (track.value?.effects ?? []).filter(
    (effect): effect is AudioClipEffect => effect?.target === 'audio',
  ),
);

function handleUpdateEffects(effects: Array<VideoClipEffect | AudioClipEffect>) {
  if (!track.value) return;
  const videoEffects = (track.value.effects ?? []).filter((e) => e?.target !== 'audio');
  timelineStore.updateTrackProperties(props.trackId, {
    effects: [
      ...videoEffects,
      ...effects.filter((e): e is AudioClipEffect => e.target === 'audio'),
    ],
  });
}
</script>

<template>
  <UiModal v-model:open="isOpen" :title="t('fastcat.effects.trackAudioTitle', { name: trackName })">
    <div class="max-h-[70vh] overflow-y-auto pr-1">
      <ClipEffectsEditor
        target="audio"
        :effects="trackAudioEffects"
        @update:effects="handleUpdateEffects"
      />
    </div>
    <template #footer>
      <div class="flex justify-end w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.close') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
