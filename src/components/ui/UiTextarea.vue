<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBlurOnPointerDownOutside } from '~/composables/useBlurOnPointerDownOutside';

const uTextareaRef = ref<ComponentPublicInstance | null>(null);
const containerRef = computed(() => uTextareaRef.value?.$el as HTMLElement | null);
useBlurOnPointerDownOutside(containerRef);

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
  ui?: { base?: string; root?: string; [key: string]: string | undefined };
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

const textareaElement = computed<HTMLTextAreaElement | null>(() => {
  const el = containerRef.value;
  return el?.querySelector('textarea') ?? null;
});

defineExpose({
  input: textareaElement,
  focus: () => textareaElement.value?.focus(),
});
</script>

<template>
  <UTextarea
    ref="uTextareaRef"
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
