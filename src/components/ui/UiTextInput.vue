<script setup lang="ts">
import { computed } from 'vue';

interface UiTextInputProps {
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  mono?: boolean;
  fullWidth?: boolean;
  type?: 'text' | 'password' | 'email' | 'url' | 'search';
  autofocus?: boolean;
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
  ui: undefined,
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
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :size="size"
    :autofocus="autofocus"
    :class="[fullWidth ? 'w-full' : 'w-auto max-w-80', mono ? 'font-mono' : '']"
    :ui="{
      base: 'transition-colors',
      ...ui,
    }"
  >
    <template v-for="(_, slot) in $slots" #[slot]="scope">
      <slot :name="slot" v-bind="scope || {}" />
    </template>
  </UInput>
</template>
