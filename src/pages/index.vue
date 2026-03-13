<script setup lang="ts">
import { onMounted } from 'vue';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';

const { resetProjectState } = useProjectActions();
const route = useRoute();
const router = useRouter();

// Принудительно сбрасываем состояние проекта в Pinia при попадании на корень
resetProjectState();

onMounted(() => {
  // Детекция мобильного устройства
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768;

  // Если мобильное устройство и не выбран принудительный десктопный режим
  if (isMobile && route.query.mode !== 'desktop') {
    router.push('/m');
    return;
  }
});
</script>

<template>
  <ProjectsScreen />
</template>
