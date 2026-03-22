<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ inheritAttrs: false });

interface UiSelectProps {
  modelValue?: unknown;
  items: unknown[];
  placeholder?: string;
  disabled?: boolean;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  valueKey?: string;
  labelKey?: string;
  multiple?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
}

const props = withDefaults(defineProps<UiSelectProps>(), {
  modelValue: undefined,
  placeholder: undefined,
  disabled: false,
  size: 'sm',
  valueKey: 'value',
  labelKey: 'label',
  multiple: false,
  fullWidth: false,
  compact: false,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: unknown): void }>();

const ui = computed(() => {
  const base = {
    content: 'min-w-48',
  };

  if (props.compact) {
    return {
      ...base,
      select: 'px-0.1',
      trailing: 'ps-0 pe-0',
      trailingIcon: 'w-3 h-3',
    };
  }

  return base;
});
</script>

<template>
  <USelectMenu
    v-bind="$attrs as object"
    :model-value="props.modelValue as never"
    :items="props.items as never[]"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :size="props.size"
    :value-key="props.valueKey as never"
    :label-key="props.labelKey as never"
    :multiple="props.multiple"
    :class="props.fullWidth ? 'w-full' : 'w-auto min-w-20'"
    :ui="ui"
    @update:model-value="(val: unknown) => emit('update:modelValue', val)"
  >
    <template v-for="(_, slot) in $slots" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps" />
    </template>
  </USelectMenu>
</template>
