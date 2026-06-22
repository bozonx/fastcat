<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useModalOpenModel } from '~/composables/ui/useModalOpenModel';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor.vue';
import type { AudioClipEffect, VideoClipEffect } from '~/timeline/types';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const isOpen = useModalOpenModel(props, emit);

const masterEffects = computed(
  () => (timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? []) as AudioClipEffect[],
);

function handleUpdateEffects(effects: Array<VideoClipEffect | AudioClipEffect>) {
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: effects.filter((e): e is AudioClipEffect => e.target === 'audio'),
  });
}
</script>

<template>
  <UiModal v-model:open="isOpen" :title="t('fastcat.effects.masterTitle')">
    <div class="max-h-[70vh] overflow-y-auto pr-1">
      <ClipEffectsEditor
        target="audio"
        :effects="masterEffects"
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
