<script setup lang="ts">
const props = defineProps<{
  label: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <span class="text-xs text-ui-text-muted">{{ props.label }}</span>
    <slot />
  </div>
</template>
