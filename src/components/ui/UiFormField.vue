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
    class="flex flex-col gap-1 text-sm"
    :ui="{
      label: 'text-ui-text-muted font-medium mb-0',
      help: 'text-ui-text-muted/70 mt-1 text-xs',
      description: 'text-ui-text-muted/70 mb-1 text-xs',
      error: 'text-error-500 mt-1',
    }"
  >
    <template v-for="(_, slot) in $slots" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps" />
    </template>
  </UFormField>
</template>
