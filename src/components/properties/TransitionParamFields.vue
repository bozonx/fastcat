<script setup lang="ts">
import { computed } from 'vue';
import type { TransitionParamField } from '~/transitions/core/registry';
import DurationSliderInput from '~/components/ui/DurationSliderInput.vue';

const props = defineProps<{
  fields: TransitionParamField[];
  params: Record<string, any>;
}>();

const emit = defineEmits<{
  'update:param': [key: string, value: any];
}>();

const { t } = useI18n();

const visibleFields = computed(() => {
  return props.fields.filter((field) => {
    if (field.showIf && !field.showIf(props.params)) {
      return false;
    }
    return true;
  });
});

function getSelectValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeSelectEmittedValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  if ('value' in value) {
    const v = (value as { value?: unknown }).value;
    return typeof v === 'string' ? v : v != null ? String(v) : undefined;
  }
  return undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getColorValue(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : '#000000';
}

function updateParam(key: string, value: any) {
  emit('update:param', key, value);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="field in visibleFields"
      :key="field.key"
      class="flex flex-col gap-1"
    >
      <span class="text-xs text-ui-text-muted">{{ t(field.labelKey) }}</span>

      <USelectMenu
        v-if="field.kind === 'select'"
        :model-value="getSelectValue(params[field.key])"
        :items="
          (field.options ?? []).map((option) => ({
            label: t(option.labelKey),
            value: option.value,
          }))
        "
        value-key="value"
        label-key="label"
        size="xs"
        @update:model-value="(value: unknown) => updateParam(field.key, normalizeSelectEmittedValue(value))"
      />

      <UInput
        v-else-if="field.kind === 'number'"
        :model-value="getNumberValue(params[field.key])"
        type="number"
        size="xs"
        :min="field.min"
        :max="field.max"
        :step="field.step ?? 0.01"
        @update:model-value="(value: string | number) => updateParam(field.key, Number(value))"
      />

      <DurationSliderInput
        v-else-if="field.kind === 'slider'"
        :model-value="getNumberValue(params[field.key]) ?? field.min ?? 0"
        :min="field.min ?? 0"
        :max="field.max ?? 1"
        :step="field.step ?? 0.01"
        :decimals="2"
        unit=""
        @update:model-value="(value: number) => updateParam(field.key, value)"
      />

      <input
        v-else-if="field.kind === 'color'"
        :value="getColorValue(params[field.key])"
        type="color"
        class="h-8 w-full rounded border border-ui-border bg-ui-bg px-1"
        @input="(event) => updateParam(field.key, (event.target as HTMLInputElement).value)"
      />
    </div>
  </div>
</template>
