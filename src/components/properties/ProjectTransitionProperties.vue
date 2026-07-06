<script setup lang="ts">
import { computed } from 'vue';
import { getTransitionManifest, normalizeTransitionParams } from '~/transitions';
import { usePresetsStore } from '~/stores/presets.store';
import TransitionParamFields from '~/components/properties/TransitionParamFields.vue';
import ProjectPresetProperties from '~/components/properties/ProjectPresetProperties.vue';
import { usePropertyPresetEditor } from '~/composables/properties/usePropertyPresetEditor';

const props = defineProps<{
  transitionType: string;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const manifest = computed(() => {
  const base = getTransitionManifest(props.transitionType);
  if (!base) return undefined;
  if (base.isCustom) {
    const custom = presetsStore.customPresets.find((p) => p.id === props.transitionType);
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
  source: () => props.transitionType,
  initParams: (type) => normalizeTransitionParams(type) as Record<string, unknown>,
  saveAsPreset: (man, name, savedParams) => {
    const baseType = man.baseType || man.type;
    presetsStore.saveAsPreset('transition', baseType, name, savedParams);
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
    <TransitionParamFields
      v-if="manifest?.paramFields && manifest.paramFields.length > 0"
      :fields="manifest.paramFields"
      :params="params"
      @update:param="handleUpdateParam"
    />
    <UiEmptyState
      v-else
      :message="t('fastcat.transitions.noSettings')"
      wrapper-class="py-2 not-italic"
    />
  </ProjectPresetProperties>
</template>
