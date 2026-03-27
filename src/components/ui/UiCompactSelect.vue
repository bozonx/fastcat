<script setup lang="ts">
import { computed, nextTick } from 'vue';

defineOptions({ inheritAttrs: false });

interface UiCompactSelectProps {
  modelValue?: unknown;
  items: unknown[];
  placeholder?: string;
  disabled?: boolean;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  valueKey?: string;
  labelKey?: string;
  multiple?: boolean;
  fullWidth?: boolean;
  searchInput?: any;
}

const props = withDefaults(defineProps<UiCompactSelectProps>(), {
  modelValue: undefined,
  placeholder: undefined,
  disabled: false,
  size: 'sm',
  valueKey: 'value',
  labelKey: 'label',
  multiple: false,
  fullWidth: false,
  searchInput: undefined,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: unknown): void }>();

const ui = computed(() => ({
  content: 'min-w-48',
  base: 'px-1! pe-3.5!',
  trailing: 'ps-0 pe-0.5',
  trailingIcon: 'w-3 h-3',
}));

function onUpdate(val: unknown) {
  emit('update:modelValue', val);
  nextTick(() => {
    (document.activeElement as HTMLElement)?.blur();
  });
}
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
    :class="props.fullWidth ? 'w-full' : 'w-auto'"
    :ui="ui"
    :searchable="false"
    :search-input="undefined"
    @update:model-value="onUpdate"
  >
    <template v-for="(_, slot) in $slots" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps" />
    </template>
  </USelectMenu>
</template>
