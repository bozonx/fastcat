<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useEditorViewStore } from '~/stores/editorView.store';

const projectStore = useProjectStore();
const viewStore = useEditorViewStore();

// Если проект уже открыт, переходим к монтажу
if (projectStore.currentProjectName) {
  viewStore.goToCut();
  navigateTo('/editor');
}
</script>

<template>
  <div></div>
</template>
