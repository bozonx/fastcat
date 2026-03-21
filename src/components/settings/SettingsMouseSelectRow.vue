<script setup lang="ts">
import UiSelect from '~/components/ui/UiSelect.vue';

interface SelectItem {
  label: string;
  value: string;
}

interface Props {
  label: string;
  modelValue: string;
  items: SelectItem[];
  modified: boolean;
  defaultLabel: string;
  isDefaultValue: (value: string) => boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function updateValue(value: unknown) {
  const item = value as SelectItem | string | null | undefined;
  emit('update:modelValue', item && typeof item === 'object' ? item.value : (item ?? ''));
}
</script>

<template>
  <tr class="group transition-colors hover:bg-ui-bg-accent/10">
    <td
      class="w-[40%] border-r border-ui-border/50 p-3 py-2.5 align-middle"
      :class="{ 'bg-yellow-400/10': modified }"
    >
      <span class="text-sm font-medium leading-tight text-ui-text">
        {{ label }}
      </span>
    </td>
    <td class="p-2 py-2.5 align-middle">
      <UiSelect
        :model-value="modelValue"
        :items="items"
        value-key="value"
        label-key="label"
        full-width
        @update:model-value="updateValue"
      >
        <template #item-label="{ item }">
          <span class="flex items-center gap-2">
            {{ item.label }}
            <span v-if="props.isDefaultValue(item.value)" class="text-[10px] italic opacity-50">
              ({{ defaultLabel }})
            </span>
          </span>
        </template>
      </UiSelect>
    </td>
  </tr>
</template>
