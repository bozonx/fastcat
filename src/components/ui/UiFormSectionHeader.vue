<script setup lang="ts">
/**
 * A unified header for sections within forms.
 * Used for inner grouping of fields (e.g., 'Metadata', 'Audio Settings').
 * Follows a muted, bold, uppercase design.
 */

defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="flex items-center justify-between mb-2 mt-4 first:mt-0 select-none">
    <div>
      <h3 class="text-2xs text-ui-text-muted font-bold uppercase tracking-wider antialiased">
        {{ title }}
      </h3>
      <p v-if="subtitle" class="text-2xs text-ui-text-muted mt-0.5">
        {{ subtitle }}
      </p>
    </div>
    <slot />
  </div>
</template>
