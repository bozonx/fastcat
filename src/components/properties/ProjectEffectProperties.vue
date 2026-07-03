<script setup lang="ts">
import { computed } from 'vue';
import { cloneValue } from '~/utils/clone';
import { getEffectManifest } from '~/effects';
import { usePresetsStore } from '~/stores/presets.store';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';
import { usePropertyPresetEditor } from '~/composables/properties/usePropertyPresetEditor';

const props = defineProps<{
  effectType: string;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const manifest = computed(() => {
  const base = getEffectManifest(props.effectType);
  if (!base) return undefined;
  if (base.isCustom) {
    const custom = presetsStore.customPresets.find((p) => p.id === props.effectType);
    if (custom) {
      return { ...base, name: custom.name };
    }
  }
  return base;
});

const {
  params,
  isSaveModalOpen,
  isRenameModalOpen,
  newPresetName,
  renamingPresetName,
  handleUpdateParam,
  handleSavePreset,
  handleRenamePreset,
  actions,
} = usePropertyPresetEditor({
  manifest,
  source: () => props.effectType,
  initParams: (type) => cloneValue(getEffectManifest(type)?.defaultValues || {}),
  saveAsPreset: (man, name, savedParams) => {
    const baseType = man.baseType || man.type;
    const target = man.target ?? 'video';
    presetsStore.saveAsPreset('effect', baseType, name, savedParams, target);
  },
});
</script>

<template>
  <div v-if="manifest" class="w-full flex flex-col gap-4 text-ui-text text-sm">
    <div class="flex items-center gap-2">
      <UIcon :name="manifest.icon" class="w-6 h-6 text-primary" />
      <span class="font-medium text-base">{{ manifest.name }}</span>
    </div>

    <div class="space-y-3 bg-ui-bg border border-ui-border rounded p-3">
      <ParamsRenderer
        v-if="manifest.controls && manifest.controls.length > 0"
        :controls="manifest.controls"
        :values="params"
        @update:value="handleUpdateParam"
      />
      <UiEmptyState
        v-if="!manifest.controls || manifest.controls.length === 0"
        :message="t('fastcat.effects.noSettings')"
        wrapper-class="py-2 not-italic"
      />
    </div>

    <PropertyActionList :actions="actions" :vertical="false" size="sm" />

    <PresetSaveModal
      v-model:open="isSaveModalOpen"
      v-model:name="newPresetName"
      @save="handleSavePreset"
    />
    <PresetSaveModal
      v-model:open="isRenameModalOpen"
      v-model:name="renamingPresetName"
      :title="t('common.rename')"
      @save="handleRenamePreset"
    />
  </div>
  <UiEmptyState v-else :message="t('common.notFound')" wrapper-class="p-4 text-sm not-italic" />
</template>
