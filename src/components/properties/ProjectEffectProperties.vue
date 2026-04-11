<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

import { ref, watch, computed } from 'vue';
import { getEffectManifest } from '~/effects';
import { usePresetsStore } from '~/stores/presets.store';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

const props = defineProps<{
  effectType: string;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const manifest = computed(() => getEffectManifest(props.effectType));

const params = ref<Record<string, any>>({});
const isSaveModalOpen = ref(false);
const newPresetName = ref('');

watch(
  () => props.effectType,
  (type) => {
    const man = getEffectManifest(type);
    if (man) {
      params.value = JSON.parse(JSON.stringify(man.defaultValues || {}));
    } else {
      params.value = {};
    }
  },
  { immediate: true },
);

function handleUpdateParam(key: string, value: any) {
  params.value[key] = value;
}

function handleSavePreset() {
  if (!manifest.value || !newPresetName.value.trim()) return;

  const baseType = manifest.value.baseType || manifest.value.type;
  const target = manifest.value.target ?? 'video';
  presetsStore.saveAsPreset('effect', baseType, newPresetName.value.trim(), params.value, target);

  isSaveModalOpen.value = false;
  newPresetName.value = '';
}

function handleUpdatePreset() {
  if (!manifest.value || !manifest.value.isCustom) return;
  presetsStore.updatePreset(manifest.value.type, params.value);
}

const actions = computed(() => {
  const list: any[] = [];
  if (manifest.value?.isCustom) {
    list.push({
      id: 'update-preset',
      label: t('common.save'),
      icon: 'i-heroicons-check',
      onClick: handleUpdatePreset,
    });
  }
  list.push({
    id: 'save-as-preset',
    label: manifest.value?.isCustom
      ? t('fastcat.effects.saveAsNew')
      : t('fastcat.effects.saveAsPreset'),
    icon: 'i-heroicons-bookmark',
    onClick: () => (isSaveModalOpen.value = true),
  });
  return list;
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
      <div
        v-if="!manifest.controls || manifest.controls.length === 0"
        class="text-xs text-ui-text-muted text-center py-2"
      >
        {{ t('fastcat.effects.noSettings') }}
      </div>
    </div>

    <PropertyActionList :actions="actions" :vertical="false" size="sm" />

    <UiModal
      v-model:open="isSaveModalOpen"
      :title="t('fastcat.effects.savePresetTitle')"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UiFormField :label="t('common.name')">
            <UiTextInput
              v-model="newPresetName"
              :placeholder="t('fastcat.effects.presetNamePlaceholder')"
              autofocus
              @keyup.enter="handleSavePreset"
            />
          </UiFormField>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" @click="isSaveModalOpen = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="primary" :disabled="!newPresetName.trim()" @click="handleSavePreset">
              {{ t('common.save') }}
            </UButton>
          </div>
        </div>
      </template>
    </UiModal>
  </div>
  <div v-else class="text-ui-text-muted text-center text-sm p-4">
    {{ t('common.notFound') }}
  </div>
</template>
