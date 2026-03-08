<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { getTransitionManifest, normalizeTransitionParams } from '~/transitions';
import { usePresetsStore } from '~/stores/presets.store';
import TransitionParamFields from '~/components/properties/TransitionParamFields.vue';

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
        {{ t('granVideoEditor.transitions.noSettings', 'No settings available') }}
      </div>
    </div>

    <div class="flex gap-2">
      <UButton
        v-if="manifest.isCustom"
        variant="soft"
        color="primary"
        icon="i-heroicons-check"
        class="flex-1 justify-center"
        @click="handleUpdatePreset"
      >
        {{ t('common.save', 'Save') }}
      </UButton>
      <UButton
        variant="soft"
        color="primary"
        icon="i-heroicons-bookmark"
        class="flex-1 justify-center"
        @click="isSaveModalOpen = true"
      >
        {{
          manifest.isCustom
            ? t('granVideoEditor.effects.saveAsNew', 'Save as new')
            : t('granVideoEditor.effects.saveAsPreset', 'Save as preset')
        }}
      </UButton>
    </div>

    <UModal
      v-model:open="isSaveModalOpen"
      :title="t('granVideoEditor.effects.savePresetTitle', 'Save Preset')"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField :label="t('common.name', 'Name')">
            <UInput
              v-model="newPresetName"
              :placeholder="t('granVideoEditor.effects.presetNamePlaceholder', 'My Custom Preset')"
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
    </UModal>
  </div>
  <div v-else class="text-ui-text-muted text-center text-sm p-4">
    {{ t('common.notFound', 'Not found') }}
  </div>
</template>
