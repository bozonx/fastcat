<script setup lang="ts">
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';

defineProps<{
  isOpen: boolean;
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <UiMobileDrawer
    :open="isOpen"
    :show-close="false"
    :ui="{ body: 'pb-8' }"
    @update:open="!$event && $emit('close')"
  >
    <ProjectHistory mobile />
  </UiMobileDrawer>
</template>
