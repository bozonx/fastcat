<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import ProjectMarkers from '~/components/project/ProjectMarkers.vue';

defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const isLandscape = useMediaQuery('(orientation: landscape)');
</script>

<template>
  <UiMobileDrawer
    :open="isOpen"
    :show-close="false"
    :ui="{ body: 'pb-8' }"
    @update:open="!$event && emit('close')"
  >
    <ProjectMarkers
      compact
      :color-filter-orientation="isLandscape ? 'vertical' : 'horizontal'"
      @marker-click="emit('close')"
    />
  </UiMobileDrawer>
</template>
