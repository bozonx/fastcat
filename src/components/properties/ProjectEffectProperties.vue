<script setup lang="ts">
import { computed } from 'vue';
import { cloneValue } from '~/utils/clone';
import { getEffectManifest } from '~/effects';
import { getEffectNumericInputRanges } from '~/effects/param-ranges';
import { usePresetsStore } from '~/stores/presets.store';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import ProjectPresetProperties from '~/components/properties/ProjectPresetProperties.vue';
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
  <ProjectPresetProperties
    v-model:save-open="isSaveModalOpen"
    v-model:rename-open="isRenameModalOpen"
    v-model:new-name="newPresetName"
    v-model:renaming-name="renamingPresetName"
    :manifest="manifest"
    :actions="actions"
    @save="handleSavePreset"
    @rename="handleRenamePreset"
  >
    <ParamsRenderer
      v-if="manifest?.controls && manifest.controls.length > 0"
      :controls="manifest.controls"
      :values="params"
      :numeric-input-ranges="getEffectNumericInputRanges(manifest.paramRanges)"
      @update:value="handleUpdateParam"
    />
    <UiEmptyState
      v-if="!manifest?.controls || manifest.controls.length === 0"
      :message="t('fastcat.effects.noSettings')"
      wrapper-class="py-2 not-italic"
    />
  </ProjectPresetProperties>
</template>
