<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import {
  getAllVideoEffectManifests,
  getAllAudioEffectManifests,
  getEffectManifest,
  type AudioEffectManifest,
} from '~/effects';
import { usePresetsStore } from '~/stores/presets.store';
import CollapsibleEffectGroup from './CollapsibleEffectGroup.vue';
import EffectCard from './EffectCard.vue';

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

const standardEffects = computed(() => allManifests.value.filter((e) => !e.isCustom));
const basicEffects = computed(() =>
  standardEffects.value.filter((e: any) => (e.category ?? 'basic') === 'basic'),
);
const artisticEffects = computed(() =>
  standardEffects.value.filter((e: any) => e.category === 'artistic'),
);

const customEffects = computed(() => {
  return presetsStore.customPresets
    .filter((p) => p.category === 'effect' && (p.effectTarget ?? 'video') === props.target)
    .map((p) => getEffectManifest(p.id))
    .filter((m): m is NonNullable<typeof m> => !!m);
});

const hasAnyEffects = computed(() => allManifests.value.length > 0 || customEffects.value.length > 0);

function handleSelect(type: string) {
  emit('select', type);
  isOpen.value = false;
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="target === 'video' ? t('videoEditor.fileManager.tabs.effects') : t('granVideoEditor.effects.tabs.audio')"
  >
    <template #body>
      <div class="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
        <!-- Basic Effects -->
        <CollapsibleEffectGroup
          v-if="basicEffects.length > 0"
          v-model:is-collapsed="presetsStore.effectsStandardCollapsed"
          :title="t('granVideoEditor.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-2">
            <EffectCard
              v-for="effect in basicEffects"
              :key="effect.type"
              :manifest="effect"
              @click="handleSelect(effect.type)"
            />
          </div>
        </CollapsibleEffectGroup>

        <!-- Artistic/Voice Effects (mostly for audio) -->
        <CollapsibleEffectGroup
          v-if="artisticEffects.length > 0"
          v-model:is-collapsed="presetsStore.audioStandardCollapsed"
          :title="t('granVideoEditor.effects.groups.artistic')"
        >
          <div class="grid grid-cols-1 gap-2">
            <EffectCard
              v-for="effect in artisticEffects"
              :key="effect.type"
              :manifest="effect"
              @click="handleSelect(effect.type)"
            />
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Effects -->
        <CollapsibleEffectGroup
          v-if="customEffects.length > 0"
          v-model:is-collapsed="presetsStore.effectsCustomCollapsed"
          :title="t('granVideoEditor.effects.groups.custom')"
        >
          <div class="grid grid-cols-1 gap-2">
            <EffectCard
              v-for="effect in customEffects"
              :key="effect.type"
              :manifest="effect"
              @click="handleSelect(effect.type)"
            />
          </div>
        </CollapsibleEffectGroup>

        <div v-if="!hasAnyEffects" class="py-8 text-center text-ui-text-muted italic">
          {{ t('granVideoEditor.effects.empty') }}
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

