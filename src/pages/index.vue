<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';

const projectStore = useProjectStore();

// Если проект уже открыт, переходим к монтажу
if (projectStore.currentProjectName) {
  navigateTo('/cut');
}
</script>

<template>
  <div></div>
</template>
