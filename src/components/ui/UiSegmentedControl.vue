<script setup lang="ts">
/**
 * Unified Segmented Control (Pill-style switcher)
 */

interface Option {
  label: string;
  value: any;
}

const props = defineProps<{
  modelValue: any;
  options: Option[];
  /** Optional size variant */
  size?: 'xs' | 'sm' | 'md';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: any];
}>();

function select(value: any) {
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="flex items-center bg-ui-bg/50 p-0.5 rounded-md border border-ui-border shrink-0">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="rounded text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap"
      :class="[
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        modelValue === option.value
          ? 'bg-ui-bg-elevated text-primary-500 shadow-sm'
          : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-elevated/50'
      ]"
      @click="select(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
