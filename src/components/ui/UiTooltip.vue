<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    text: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
  }>(),
  {
    placement: 'top',
  }
);
</script>

<template>
  <UTooltip :text="text" :placement="placement">
    <slot />
  </UTooltip>
</template>
