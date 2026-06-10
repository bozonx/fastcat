<script setup lang="ts">
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import ProjectBackups from '~/components/project/ProjectBackups.vue';

defineProps<{
  isOpen: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <UiMobileDrawer
    :open="isOpen"
    :show-close="false"
    :ui="{ body: 'pb-8' }"
    @update:open="!$event && $emit('close')"
  >
    <div class="h-[60dvh] flex flex-col">
      <ProjectBackups class="flex-1 min-h-0 bg-transparent" />
    </div>
  </UiMobileDrawer>
</template>
