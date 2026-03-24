<script setup lang="ts">
/**
 * A wrapper around UFormField that provides a consistent design system for labels.
 * Labels are always muted (text-ui-text-muted) and follow a uniform typography.
 */

interface Props {
  label?: string;
  description?: string;
  help?: string;
  error?: string | boolean;
  required?: boolean;
}

const props = defineProps<Props>();
</script>

<template>
  <UFormField
    v-bind="props"
    :ui="{
      label: 'text-xs text-ui-text-muted font-medium mb-2',
      help: 'text-xs text-ui-text-muted/70 mt-1',
      description: 'text-xs text-ui-text-muted/70 mb-1',
      error: 'text-xs text-error-500 mt-1',
    }"
  >
    <template v-for="(_, slot) in $slots" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps" />
    </template>
  </UFormField>
</template>
