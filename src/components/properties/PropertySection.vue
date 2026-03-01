<script setup lang="ts">
const props = defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <div
      class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest border-b border-ui-border pb-1"
    >
      {{ props.title }}
    </div>
    <div class="flex flex-col">
      <slot />
    </div>
  </div>
</template>
