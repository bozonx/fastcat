<script setup lang="ts">
import { computed } from 'vue';

interface UiTextInputProps {
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  mono?: boolean;
  fullWidth?: boolean;
}

const props = withDefaults(defineProps<UiTextInputProps>(), {
  placeholder: undefined,
  disabled: false,
  size: 'xs',
  mono: false,
  fullWidth: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const value = computed({
  get: () => props.modelValue,
  set: (val: string) => emit('update:modelValue', val),
});
</script>

<template>
  <UInput
    v-model="value"
    :placeholder="placeholder"
    :disabled="disabled"
    :size="size"
    :class="[fullWidth ? 'w-full' : 'w-auto max-w-80', mono ? 'font-mono' : '']"
    :ui="{
      base: 'transition-colors',
    }"
  />
</template>
