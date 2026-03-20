<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    className?: string;
  }>(),
  {
    className: '',
  },
);
</script>

<template>
  <div class="overflow-y-auto custom-scrollbar" :class="className">
    <slot />
  </div>
</template>

<style scoped>
.custom-scrollbar {
  /* This enables native overlay scrollbars on macOS while remaining styled elsewhere */
  scrollbar-width: thin;
  scrollbar-color: var(--color-ui-border) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-ui-border);
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--color-ui-text-muted);
}
</style>
