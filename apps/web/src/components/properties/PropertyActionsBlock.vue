<script setup lang="ts">
import PropertyActionList from './PropertyActionList.vue';
import type { PropertyAction } from './PropertyActionList.vue';

defineProps<{
  quickActions?: PropertyAction[];
  additionalActions?: PropertyAction[];
}>();
</script>

<template>
  <div class="flex flex-col w-full gap-2">
    <PropertyActionList
      v-if="quickActions && quickActions.length > 0"
      :actions="quickActions"
      :vertical="false"
      variant="ghost"
      size="sm"
    />
    <PropertyActionList
      v-if="additionalActions && additionalActions.length > 0"
      :actions="additionalActions"
      justify="start"
      size="sm"
    />
  </div>
</template>
