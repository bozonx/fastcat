<script setup lang="ts">
/**
 * A unified header for sections within forms.
 * Used for inner grouping of fields (e.g., 'Metadata', 'Audio Settings').
 * Follows a muted, bold, uppercase design.
 */

defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="flex items-center justify-between mb-2 mt-4 first:mt-0 select-none">
    <h3 class="text-xs text-ui-text-muted font-bold uppercase tracking-wider">
      {{ title }}
    </h3>
    <slot />
  </div>
</template>
