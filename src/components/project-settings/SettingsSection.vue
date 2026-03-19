<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  title: string;
  summary?: string;
  defaultExpanded?: boolean;
}>();

const isExpanded = ref(props.defaultExpanded ?? false);
</script>

<template>
  <div class="space-y-4">
    <div
      class="w-full flex justify-between items-center cursor-pointer group"
      @click="isExpanded = !isExpanded"
    >
      <div class="flex items-center gap-2">
        <h3 v-show="isExpanded" class="text-lg font-semibold text-ui-text">
          {{ title }}
        </h3>
        <span v-show="!isExpanded" class="text-sm text-ui-text-muted font-normal">
          {{ summary || title }}
        </span>
      </div>
      <UIcon
        :name="
          isExpanded ? 'i-heroicons-chevron-down-20-solid' : 'i-heroicons-chevron-right-20-solid'
        "
        class="w-5 h-5 text-ui-text-muted group-hover:text-ui-text transition-colors"
      />
    </div>

    <div v-show="isExpanded" class="space-y-4 pt-2">
      <slot />
    </div>
  </div>
</template>
