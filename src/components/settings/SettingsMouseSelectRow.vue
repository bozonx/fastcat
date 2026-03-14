<script setup lang="ts">
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

function updateValue(value: SelectItem | string | null | undefined) {
  emit('update:modelValue', value && typeof value === 'object' ? value.value : (value ?? ''));
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
      <USelectMenu
        :model-value="modelValue"
        :items="items"
        value-key="value"
        label-key="label"
        class="w-full"
        @update:model-value="updateValue"
      >
        <template #item-label="{ item }">
          <span class="flex items-center gap-2">
            {{ item.label }}
            <span
              v-if="props.isDefaultValue(item.value)"
              class="text-[10px] italic opacity-50"
            >
              ({{ defaultLabel }})
            </span>
          </span>
        </template>
      </USelectMenu>
    </td>
  </tr>
</template>
