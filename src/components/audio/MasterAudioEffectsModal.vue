<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import AudioEffectsEditor from '~/components/common/AudioEffectsEditor.vue';
import type { AudioClipEffect } from '~/timeline/types';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val),
});

const masterEffects = computed(
  () => (timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? []) as AudioClipEffect[],
);

function handleUpdateEffects(effects: AudioClipEffect[]) {
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: effects as any,
  });
}
</script>

<template>
  <UiModal v-model:open="isOpen" :title="t('fastcat.effects.masterTitle')">
    <div class="max-h-[70vh] overflow-y-auto pr-1">
      <AudioEffectsEditor :effects="masterEffects" @update:effects="handleUpdateEffects" />
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
