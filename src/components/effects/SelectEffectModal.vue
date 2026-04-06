<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import {
  getAllVideoEffectManifests,
  getAllAudioEffectManifests,
  getEffectManifest,
  type EffectManifest,
} from '~/effects';
import { usePresetsStore } from '~/stores/presets.store';
import CollapsibleEffectGroup from './CollapsibleEffectGroup.vue';
import EffectCard from './EffectCard.vue';

import UiModal from '~/components/ui/UiModal.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    target?: 'video' | 'audio';
  }>(),
  {
    target: 'video',
  },
);

const emit = defineEmits<{
  'update:open': [value: boolean];
  select: [effectType: string];
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();
const isOpen = ref(props.open);

watch(
  () => props.open,
  (val) => {
    isOpen.value = val;
  },
);

watch(isOpen, (val) => {
  if (val !== props.open) {
    emit('update:open', val);
  }
});

const allManifests = computed(() =>
  props.target === 'video' ? getAllVideoEffectManifests() : getAllAudioEffectManifests(),
);

const groupedEffects = computed<{
  basic: EffectManifest[];
  custom: EffectManifest[];
  hasAnyEffects: boolean;
  nonBasic: EffectManifest[];
}>(() => {
  const basic: EffectManifest[] = [];
  const nonBasic: EffectManifest[] = [];

  for (const manifest of allManifests.value) {
    if (manifest.isCustom) continue;

    if ((manifest.category ?? 'basic') === 'basic') {
      basic.push(manifest);
      continue;
    }

    nonBasic.push(manifest);
  }

  const custom = presetsStore.customPresets
    .filter(
      (preset) => preset.category === 'effect' && (preset.effectTarget ?? 'video') === props.target,
    )
    .map((preset) => getEffectManifest(preset.id))
    .filter((manifest): manifest is EffectManifest => Boolean(manifest));

  return {
    basic,
    nonBasic,
    custom,
    hasAnyEffects: basic.length > 0 || nonBasic.length > 0 || custom.length > 0,
  };
});

const modalTitle = computed(() =>
  props.target === 'video'
    ? t('videoEditor.fileManager.tabs.effects')
    : t('fastcat.effects.tabs.audio'),
);

function handleSelect(type: string) {
  emit('select', type);
  isOpen.value = false;
}
</script>

<template>
  <UiModal v-model:open="isOpen" :title="modalTitle">
    <div class="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
      <!-- Basic Effects -->
      <CollapsibleEffectGroup
        v-if="groupedEffects.basic.length > 0"
        v-model:is-collapsed="presetsStore.effectsStandardCollapsed"
        :title="t('fastcat.effects.groups.standard')"
      >
        <div class="grid grid-cols-1 gap-2">
          <EffectCard
            v-for="effect in groupedEffects.basic"
            :key="effect.type"
            :manifest="effect"
            @click="handleSelect(effect.type)"
          />
        </div>
      </CollapsibleEffectGroup>

      <!-- Artistic/Voice Effects (mostly for audio) -->
      <CollapsibleEffectGroup
        v-if="groupedEffects.nonBasic.length > 0"
        v-model:is-collapsed="presetsStore.audioStandardCollapsed"
        :title="t('fastcat.effects.groups.artistic')"
      >
        <div class="grid grid-cols-1 gap-2">
          <EffectCard
            v-for="effect in groupedEffects.nonBasic"
            :key="effect.type"
            :manifest="effect"
            @click="handleSelect(effect.type)"
          />
        </div>
      </CollapsibleEffectGroup>

      <!-- Custom Effects -->
      <CollapsibleEffectGroup
        v-if="groupedEffects.custom.length > 0"
        v-model:is-collapsed="presetsStore.effectsCustomCollapsed"
        :title="t('fastcat.effects.groups.custom')"
      >
        <div class="grid grid-cols-1 gap-2">
          <EffectCard
            v-for="effect in groupedEffects.custom"
            :key="effect.type"
            :manifest="effect"
            @click="handleSelect(effect.type)"
          />
        </div>
      </CollapsibleEffectGroup>

      <div v-if="!groupedEffects.hasAnyEffects" class="py-8 text-center text-ui-text-muted italic">
        {{ t('fastcat.effects.empty') }}
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.cancel') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
