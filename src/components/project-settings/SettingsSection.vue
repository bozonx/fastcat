<script setup lang="ts">
import UiAccordion from '~/components/ui/UiAccordion.vue';

const props = defineProps<{
  title: string;
  summary?: string;
  defaultExpanded?: boolean;
}>();
</script>

<template>
  <UiAccordion
    :title="title"
    :summary="summary"
    :default-open="defaultExpanded"
  >
    <div class="space-y-4 pt-1">
      <slot />
    </div>
  </UiAccordion>
</template>
