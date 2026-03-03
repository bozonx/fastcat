<script setup lang="ts">
defineProps<{
  progress: number;
  size?: 'sm' | 'md' | 'lg';
}>();
</script>

<template>
  <svg
    class="transform -rotate-90"
    :class="{
      'w-4 h-4': size === 'sm' || !size,
      'w-6 h-6': size === 'md',
      'w-8 h-8': size === 'lg',
    }"
    viewBox="0 0 16 16"
  >
    <circle
      cx="8"
      cy="8"
      r="6"
      stroke="currentColor"
      stroke-width="2"
      fill="none"
      class="text-ui-border"
    />
    <circle
      cx="8"
      cy="8"
      r="6"
      stroke="currentColor"
      stroke-width="2"
      fill="none"
      class="text-amber-400 transition-all duration-300"
      :stroke-dasharray="37.7"
      :stroke-dashoffset="37.7 - (37.7 * (progress ?? 0)) / 100"
      stroke-linecap="round"
    />
  </svg>
</template>
