<script setup lang="ts">
import { onMounted } from 'vue';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useWorkspaceStore } from '~/stores/workspace.store';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';

const { resetProjectState } = useProjectActions();
const workspaceStore = useWorkspaceStore();
const route = useRoute();

// Сбрасываем текущее состояние открытого проекта
resetProjectState();

onMounted(() => {
  // Детекция мобильного устройства
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
  
  // Если мы на мобилке и не форсируем десктопный режим, редиректим на /m
  if (isMobile && route.query.mode !== 'desktop') {
    navigateTo('/m');
    return;
  }

  // Очищаем из local storage последний открытый проект, 
  // чтобы при перезагрузке страницы на корне не срабатывало авто-открытие
  workspaceStore.lastProjectName = null;
});
</script>

<template>
  <ProjectsScreen />
</template>
