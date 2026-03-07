<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';

const projectStore = useProjectStore();

// Если проект уже открыт, переходим к монтажу
if (projectStore.currentProjectName) {
  projectStore.goToCut();
  navigateTo('/editor');
}
</script>

<template>
  <ProjectsScreen />
</template>
