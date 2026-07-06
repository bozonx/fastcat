<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { usePresetsStore } from '~/stores/presets.store';
import { useAudioPluginsStore } from '~/stores/audio-plugins.store';
import EffectCatalogGroup from './EffectCatalogGroup.vue';

import UiModal from '~/components/ui/UiModal.vue';
import { useModalOpenModel } from '~/composables/ui/useModalOpenModel';
import { useEffectManifestGroups } from '~/composables/effects/useEffectManifestGroups';

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
const audioPluginsStore = useAudioPluginsStore();
const isOpen = useModalOpenModel(props, emit);

watchEffect(() => {
  if (props.target === 'audio') {
    void audioPluginsStore.ensureInit();
  }
});

const { groups: effectGroups } = useEffectManifestGroups(() => props.target);

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
    <div class="space-y-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
      <!-- Basic Effects -->
      <EffectCatalogGroup
        v-if="effectGroups.basic.length > 0"
        v-model:is-collapsed="presetsStore.effectsStandardCollapsed"
        :title="t('fastcat.effects.groups.standard')"
        :items="effectGroups.basic"
        :draggable="false"
        @select="(effect) => handleSelect(effect.type)"
      />

      <!-- Artistic/Voice Effects (mostly for audio) -->
      <EffectCatalogGroup
        v-if="effectGroups.nonBasic.length > 0"
        v-model:is-collapsed="presetsStore.audioStandardCollapsed"
        :title="t('fastcat.effects.groups.artistic')"
        :items="effectGroups.nonBasic"
        :draggable="false"
        @select="(effect) => handleSelect(effect.type)"
      />

      <!-- Custom Effects -->
      <EffectCatalogGroup
        v-if="effectGroups.custom.length > 0"
        v-model:is-collapsed="presetsStore.effectsCustomCollapsed"
        :title="t('fastcat.effects.groups.custom')"
        :items="effectGroups.custom"
        :draggable="false"
        @select="(effect) => handleSelect(effect.type)"
      />

      <UiEmptyState
        v-if="!effectGroups.hasAnyEffects"
        :message="t('fastcat.effects.empty')"
        wrapper-class="py-8"
      />
    </div>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="void (isOpen = false)">
          {{ t('common.cancel') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
