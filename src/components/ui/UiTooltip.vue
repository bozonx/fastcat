<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    text?: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    disabled?: boolean;
  }>(),
  {
    text: '',
    placement: 'top',
    disabled: false,
  }
);
</script>

<template>
  <UTooltip :text="text" :placement="placement" :prevent="disabled">
    <slot />
  </UTooltip>
</template>
