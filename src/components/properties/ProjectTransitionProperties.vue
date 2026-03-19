<script setup lang="ts">
import UiModal from "~/components/ui/UiModal.vue";
import { ref, watch, computed } from 'vue';
import { getTransitionManifest, normalizeTransitionParams } from '~/transitions';
import { usePresetsStore } from '~/stores/presets.store';
import TransitionParamFields from '~/components/properties/TransitionParamFields.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

const props = defineProps<{
  transitionType: string;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const manifest = computed(() => getTransitionManifest(props.transitionType));

const params = ref<Record<string, any>>({});
const isSaveModalOpen = ref(false);
const newPresetName = ref('');

watch(
  () => props.transitionType,
  (type) => {
    const man = getTransitionManifest(type);
    if (man) {
      params.value = normalizeTransitionParams(type) as Record<string, any>;
    } else {
      params.value = {};
    }
  },
  { immediate: true },
);

function handleUpdateParam(key: string, value: any) {
  params.value = {
    ...params.value,
    [key]: value,
  };
}

function handleSavePreset() {
  if (!manifest.value || !newPresetName.value.trim()) return;

  const baseType = manifest.value.baseType || manifest.value.type;
  presetsStore.saveAsPreset('transition', baseType, newPresetName.value.trim(), params.value);

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
      label: t('common.save', 'Save'),
      icon: 'i-heroicons-check',
      onClick: handleUpdatePreset,
    });
  }
  list.push({
    id: 'save-as-preset',
    label: manifest.value?.isCustom
      ? t('fastcat.effects.saveAsNew', 'Save as new')
      : t('fastcat.effects.saveAsPreset', 'Save as preset'),
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
      <TransitionParamFields
        v-if="manifest.paramFields && manifest.paramFields.length > 0"
        :fields="manifest.paramFields"
        :params="params"
        @update:param="handleUpdateParam"
      />
      <div v-else class="text-xs text-ui-text-muted text-center py-2">
        {{ t('fastcat.transitions.noSettings', 'No settings available') }}
      </div>
    </div>

    <PropertyActionList :actions="actions" :vertical="false" size="sm" />

    <UiModal
      v-model:open="isSaveModalOpen"
      :title="t('fastcat.effects.savePresetTitle', 'Save Preset')"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField :label="t('common.name', 'Name')">
            <UInput
              v-model="newPresetName"
              :placeholder="t('fastcat.effects.presetNamePlaceholder', 'My Custom Preset')"
              autofocus
              @keyup.enter="handleSavePreset"
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" @click="isSaveModalOpen = false">
              {{ t('common.cancel', 'Cancel') }}
            </UButton>
            <UButton color="primary" :disabled="!newPresetName.trim()" @click="handleSavePreset">
              {{ t('common.save', 'Save') }}
            </UButton>
          </div>
        </div>
      </template>
    </UiModal>
  </div>
  <div v-else class="text-ui-text-muted text-center text-sm p-4">
    {{ t('common.notFound', 'Not found') }}
  </div>
</template>
