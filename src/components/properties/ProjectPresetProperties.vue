<script setup lang="ts">
import type { PresetManifestLike } from '~/composables/properties/usePropertyPresetEditor';
import type { PropertyAction } from '~/components/properties/PropertyActionList.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';

interface ProjectPresetManifest extends PresetManifestLike {
  icon?: string;
}

defineProps<{
  actions: PropertyAction[];
  manifest?: ProjectPresetManifest | null;
}>();

const isSaveModalOpen = defineModel<boolean>('saveOpen', { default: false });
const isRenameModalOpen = defineModel<boolean>('renameOpen', { default: false });
const newPresetName = defineModel<string>('newName', { default: '' });
const renamingPresetName = defineModel<string>('renamingName', { default: '' });

const emit = defineEmits<{
  rename: [];
  save: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="manifest" class="w-full flex flex-col gap-4 text-ui-text text-sm">
    <div class="flex items-center gap-2">
      <UIcon :name="manifest.icon" class="w-6 h-6 text-primary" />
      <span class="font-medium text-base">{{ manifest.name }}</span>
    </div>

    <div class="space-y-3 bg-ui-bg border border-ui-border rounded p-3">
      <slot />
    </div>

    <PropertyActionList :actions="actions" :vertical="false" size="sm" />

    <PresetSaveModal
      v-model:open="isSaveModalOpen"
      v-model:name="newPresetName"
      @save="emit('save')"
    />
    <PresetSaveModal
      v-model:open="isRenameModalOpen"
      v-model:name="renamingPresetName"
      :title="t('common.rename')"
      @save="emit('rename')"
    />
  </div>
  <UiEmptyState v-else :message="t('common.notFound')" wrapper-class="p-4 text-sm not-italic" />
</template>
