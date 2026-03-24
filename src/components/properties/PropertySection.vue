<script setup lang="ts">
const props = defineProps<{
  title?: string;
}>();

import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <UiFormSectionHeader
      v-if="props.title || $slots['header-actions']"
      :title="props.title ?? ''"
      class="border-b border-ui-border pb-1 mt-0! mb-1!"
    >
      <slot name="header-actions" />
    </UiFormSectionHeader>
    <div class="flex flex-col">
      <slot />
    </div>
  </div>
</template>
