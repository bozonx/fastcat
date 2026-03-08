<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { getEffectManifest } from '~/effects';
import { usePresetsStore } from '~/stores/presets.store';
import WheelSlider from '~/components/ui/WheelSlider.vue';

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
  presetsStore.saveAsPreset('effect', baseType, newPresetName.value.trim(), params.value);
  
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
      <template v-for="control in manifest.controls" :key="String(control.key)">
        <div v-if="control.kind === 'slider'" class="flex flex-col gap-1">
          <div class="flex justify-between text-xs text-ui-text-muted">
            <span>{{ control.label }}</span>
            <span>
              {{ control.format ? control.format(params[control.key as string]) : params[control.key as string] }}
            </span>
          </div>
          <WheelSlider
            :model-value="params[control.key as string]"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :default-value="manifest.defaultValues?.[control.key as any]"
            @update:model-value="handleUpdateParam(control.key as string, $event)"
          />
        </div>
        <div v-else-if="control.kind === 'toggle'" class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{ control.label }}</span>
          <USwitch
            :model-value="params[control.key as string]"
            size="sm"
            @update:model-value="handleUpdateParam(control.key as string, $event)"
          />
        </div>
        <div v-else-if="control.kind === 'select'" class="flex flex-col gap-1">
          <span class="text-xs text-ui-text-muted">{{ control.label }}</span>
          <USelectMenu
            :model-value="params[control.key as string]"
            :items="control.options"
            size="sm"
            value-key="value"
            label-key="label"
            @update:model-value="handleUpdateParam(control.key as string, $event)"
          />
        </div>
      </template>
      <div v-if="!manifest.controls || manifest.controls.length === 0" class="text-xs text-ui-text-muted text-center py-2">
        {{ t('granVideoEditor.effects.noSettings', 'No settings available') }}
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
        {{ manifest.isCustom ? t('granVideoEditor.effects.saveAsNew', 'Save as new') : t('granVideoEditor.effects.saveAsPreset', 'Save as preset') }}
      </UButton>
    </div>

    <UModal v-model:open="isSaveModalOpen" :title="t('granVideoEditor.effects.savePresetTitle', 'Save Preset')">
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField :label="t('common.name', 'Name')">
            <UInput v-model="newPresetName" :placeholder="t('granVideoEditor.effects.presetNamePlaceholder', 'My Custom Preset')" autofocus @keyup.enter="handleSavePreset" />
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
