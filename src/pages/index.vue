<script setup lang="ts">
import { useProjectActions } from '~/composables/editor/useProjectActions';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';

const { resetProjectState } = useProjectActions();
const route = useRoute();
const router = useRouter();
const { isMobile } = useDevice();

// Принудительно сбрасываем состояние проекта в Pinia при попадании на корень
resetProjectState();

onMounted(() => {
  const ALREADY_LAUNCHED_KEY = 'fastcat:app:already-launched';
  const alreadyLaunched = localStorage.getItem(ALREADY_LAUNCHED_KEY) === 'true';

  if (!alreadyLaunched) {
    localStorage.setItem(ALREADY_LAUNCHED_KEY, 'true');
    // Если мобильное устройство и не выбран принудительный десктопный режим
    if (isMobile && route.query.mode !== 'desktop') {
      router.replace('/m');
    }
  }
});
</script>

<template>
  <ProjectsScreen />
</template>
