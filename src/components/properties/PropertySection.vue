<script setup lang="ts">
const props = defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <div
      class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest border-b border-ui-border pb-1"
    >
      {{ props.title }}
    </div>
    <div class="space-y-2">
      <slot />
    </div>
  </div>
</template>
