<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { useBlurOnPointerDownOutside } from '~/composables/useBlurOnPointerDownOutside';

interface UiTextInputProps {
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  mono?: boolean;
  fullWidth?: boolean;
  type?: 'text' | 'password' | 'email' | 'url' | 'search';
  autofocus?: boolean;
  selectOnFocus?: boolean;
  variant?: 'outline' | 'soft' | 'subtle' | 'ghost' | 'none';
  autocomplete?: string;
  ui?: { base?: string };
}

const props = withDefaults(defineProps<UiTextInputProps>(), {
  placeholder: undefined,
  disabled: false,
  size: 'xs',
  mono: false,
  fullWidth: false,
  type: 'text',
  autofocus: false,
  selectOnFocus: false,
  variant: 'outline',
  autocomplete: undefined,
  ui: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'keyup' | 'keydown', event: KeyboardEvent): void;
  (e: 'focus' | 'blur', event: FocusEvent): void;
}>();

const uInputRef = ref<ComponentPublicInstance | null>(null);

const containerRef = computed(() => uInputRef.value?.$el as HTMLElement | null);
useBlurOnPointerDownOutside(containerRef);

const inputElement = computed<HTMLInputElement | null>(() => {
  const el = containerRef.value;
  return el?.querySelector('input') ?? null;
});

function handleFocus(event: FocusEvent) {
  if (props.selectOnFocus) {
    (event.target as HTMLInputElement)?.select();
  }
  emit('focus', event);
}

onMounted(() => {
  if (props.autofocus && props.selectOnFocus) {
    nextTick(() => {
      inputElement.value?.focus();
      inputElement.value?.select();
    });
  }
});

defineExpose({
  input: inputElement,
});
</script>

<template>
  <UInput
    ref="uInputRef"
    :model-value="props.modelValue"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :size="size"
    :autofocus="autofocus"
    :variant="variant"
    :autocomplete="autocomplete"
    :class="[fullWidth ? 'w-full' : 'w-auto max-w-80', mono ? 'font-mono' : '']"
    :ui="{
      base: 'transition-colors',
      ...ui,
    }"
    @update:model-value="(val: string) => emit('update:modelValue', val)"
    @keyup="(e: KeyboardEvent) => emit('keyup', e)"
    @keydown="(e: KeyboardEvent) => emit('keydown', e)"
    @focus="handleFocus"
    @blur="(e: FocusEvent) => emit('blur', e)"
  >
    <template v-for="(_, slot) in $slots" #[slot]="scope">
      <slot :name="slot" v-bind="scope || {}" />
    </template>
  </UInput>
</template>
