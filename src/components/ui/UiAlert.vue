<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  /** Optional icon name. Defaults to 'i-heroicons-information-circle' */
  icon?: string;
  /** Color type for the alert icon/styling */
  variant?: 'info' | 'warning' | 'error' | 'success';
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'i-heroicons-information-circle',
  variant: 'info',
});

const iconColorClass = computed(() => {
  switch (props.variant) {
    case 'warning':
      return 'text-amber-500';
    case 'error':
      return 'text-red-500';
    case 'success':
      return 'text-emerald-500';
    case 'info':
    default:
      return 'text-primary-500';
  }
});
</script>

<template>
  <div
    class="text-xs text-ui-text-muted bg-ui-bg-elevated/40 p-3 rounded-2xl flex gap-3 border border-white/5 leading-normal"
  >
    <UIcon v-if="icon" :name="icon" class="w-4 h-4 shrink-0 mt-0.5" :class="iconColorClass" />
    <div class="flex-1 min-w-0">
      <slot />
    </div>
  </div>
</template>
