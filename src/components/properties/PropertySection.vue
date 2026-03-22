<script setup lang="ts">
const props = defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <div
      v-if="props.title || $slots['header-actions']"
      class="flex items-center justify-between text-2xs font-bold text-ui-text-muted uppercase tracking-widest border-b border-ui-border pb-1"
    >
      <span>{{ props.title }}</span>
      <slot name="header-actions" />
    </div>
    <div class="flex flex-col">
      <slot />
    </div>
  </div>
</template>
