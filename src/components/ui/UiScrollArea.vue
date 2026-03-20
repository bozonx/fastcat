<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    className?: string;
  }>(),
  {
    className: '',
  }
);
</script>

<template>
  <div class="overflow-y-auto custom-scrollbar" :class="className">
    <slot />
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-ui-border);
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--color-ui-text-muted);
}
</style>
