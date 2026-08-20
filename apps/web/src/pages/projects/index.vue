<script setup lang="ts">
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectStore } from '~/stores/project.store';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';

const { resetProjectState } = useProjectActions();
const projectStore = useProjectStore();

// Reset project state in Pinia when landing on the root/projects list — but only if a project
// is actually open. Otherwise this becomes a floating promise (closeProject + save)
// that may race ongoing project load in the editor.
if (projectStore.currentProjectName) {
  void resetProjectState();
}
</script>

<template>
  <ProjectsScreen />
</template>
