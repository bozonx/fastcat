<script setup lang="ts">
import { computed } from 'vue';
import type { EffectManifest } from '~/effects/core/registry';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';

const props = defineProps<{
  modelValue: boolean;
  effect?: Record<string, any>;
  manifest?: EffectManifest<any>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:effect': [updates: Record<string, any>];
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const settingsControls = computed(() => {
  return props.manifest?.settingsControls ?? [];
});

const effectValues = computed(() => {
  return props.effect ?? {};
});

function handleUpdateValue(key: string, value: any) {
  // Support nested paths for array updates like "points.0.gain"
  const keys = key.split('.');
  
  if (keys.length === 1) {
    emit('update:effect', { [key]: value });
    return;
  }
  
  // Create a deep copy of the property
  const rootKey = keys[0];
  if (!rootKey) return;
  const updates: Record<string, any> = { [rootKey]: JSON.parse(JSON.stringify(effectValues.value[rootKey] ?? {})) };
  
  // Traverse and set
  let current: any = updates[rootKey];
  for (let i = 1; i < keys.length - 1; i++) {
    const k = keys[i];
    if (k && current[k] === undefined) {
      current[k] = isNaN(Number(keys[i + 1])) ? {} : [];
    }
    if (k) {
      current = current[k];
    }
  }
  
  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }
  emit('update:effect', updates);
}

function handleClose() {
  isOpen.value = false;
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="manifest?.name ?? t('granVideoEditor.effects.settings', 'Settings')" class="sm:max-w-2xl">
    <template #body>
      <div v-if="settingsControls.length > 0" class="max-h-[60vh] overflow-y-auto pr-2 space-y-4">
        <ParamsRenderer
          :controls="settingsControls"
          :values="effectValues"
          size="sm"
          @update:value="handleUpdateValue"
        />
      </div>
      <div v-else class="text-center text-sm text-ui-text-muted py-8">
        {{ t('granVideoEditor.effects.noSettings', 'No additional settings available.') }}
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end w-full">
        <UButton color="primary" @click="handleClose">
          {{ t('common.done', 'Done') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
