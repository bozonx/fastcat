<script setup lang="ts">
import { computed } from 'vue';
import { getTransitionManifest, normalizeTransitionParams } from '~/transitions';
import { usePresetsStore } from '~/stores/presets.store';
import TransitionParamFields from '~/components/properties/TransitionParamFields.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';
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
  <div v-if="manifest" class="w-full flex flex-col gap-4 text-ui-text text-sm">
    <div class="flex items-center gap-2">
      <UIcon :name="manifest.icon" class="w-6 h-6 text-primary" />
      <span class="font-medium text-base">{{ manifest.name }}</span>
    </div>

    <div class="space-y-3 bg-ui-bg border border-ui-border rounded p-3">
      <TransitionParamFields
        v-if="manifest.paramFields && manifest.paramFields.length > 0"
        :fields="manifest.paramFields"
        :params="params"
        @update:param="handleUpdateParam"
      />
      <UiEmptyState
        v-else
        :message="t('fastcat.transitions.noSettings')"
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
