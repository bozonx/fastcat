<script setup lang="ts">
interface UiTextareaProps {
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  rows?: number;
  maxrows?: number;
  autoresize?: boolean;
  readonly?: boolean;
  fullWidth?: boolean;
  spellcheck?: boolean;
  ui?: { base?: string };
}

const props = withDefaults(defineProps<UiTextareaProps>(), {
  placeholder: undefined,
  disabled: false,
  size: 'sm',
  rows: undefined,
  maxrows: undefined,
  autoresize: false,
  readonly: false,
  fullWidth: false,
  spellcheck: true,
  ui: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'focus' | 'blur', event: FocusEvent): void;
}>();
</script>

<template>
  <UTextarea
    :model-value="props.modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :size="size"
    :rows="rows"
    :maxrows="maxrows"
    :autoresize="autoresize"
    :readonly="readonly"
    :spellcheck="spellcheck"
    :class="fullWidth ? 'w-full' : 'w-auto'"
    :ui="{
      base: 'transition-colors',
      ...ui,
    }"
    @update:model-value="(val: string | number) => emit('update:modelValue', String(val))"
    @focus="(e: FocusEvent) => emit('focus', e)"
    @blur="(e: FocusEvent) => emit('blur', e)"
  />
</template>
