<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';

/**
 * A unified header for sections within forms.
 * Used for inner grouping of fields (e.g., 'Metadata', 'Audio Settings').
 * Follows a muted, bold, uppercase design.
 */

defineProps<{
  title: string;
  subtitle?: string;
  infoTooltip?: string;
}>();
</script>

<template>
  <div class="flex items-center justify-between mb-2 mt-4 first:mt-0 select-none">
    <div>
      <h3 class="flex items-center gap-1.5 text-2xs text-ui-text-muted font-bold tracking-wider antialiased">
        <span>{{ title }}</span>
        <UiTooltip v-if="infoTooltip" :text="infoTooltip">
          <UIcon
            name="i-heroicons-information-circle"
            class="w-3.5 h-3.5 text-ui-text-muted hover:text-ui-text cursor-help shrink-0"
          />
        </UiTooltip>
      </h3>
      <p v-if="subtitle" class="text-2xs text-ui-text-muted mt-0.5">
        {{ subtitle }}
      </p>
    </div>
    <slot />
  </div>
</template>
