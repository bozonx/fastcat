<script setup lang="ts">
import { computed } from 'vue';
import { useSelectBlurUpdate } from '~/composables/ui/useSelectBlurUpdate';

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
  searchable?: boolean;
  searchInput?: boolean | object;
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
  searchable: true,
  searchInput: undefined,
});

const emit = defineEmits<{ (e: 'update:modelValue', value: unknown): void }>();

const ui = computed(() => ({
  content: 'min-w-48 z-[calc(var(--z-fixed)+20)]',
  base: 'justify-start! text-left! gap-1.5 min-w-0',
  leading: 'ps-2.5 pointer-events-none',
  leadingIcon: 'size-4 shrink-0',
  value: 'min-w-0 flex-1 truncate text-left',
  placeholder: 'min-w-0 flex-1 truncate text-left',
  trailing: 'pe-2.5',
  trailingIcon: 'size-4 shrink-0',
  itemWrapper: 'min-w-0 flex-1',
  itemLabel: 'truncate text-left',
  itemLeadingIcon: 'size-4 shrink-0',
}));

const onUpdate = useSelectBlurUpdate(emit);
</script>

<template>
  <USelectMenu
    v-bind="$attrs as object"
    class="ui-select-menu"
    :model-value="props.modelValue as never"
    :items="props.items as never[]"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :size="props.size"
    :value-key="props.valueKey as never"
    :label-key="props.labelKey as never"
    :multiple="props.multiple"
    :search-input="props.searchable ? (props.searchInput ?? true) : false"
    :class="props.fullWidth ? 'w-full' : 'w-auto min-w-20'"
    :ui="ui"
    @update:model-value="onUpdate"
  >
    <template v-for="(_, slot) in $slots" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps" />
    </template>
  </USelectMenu>
</template>
