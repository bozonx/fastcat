<script setup lang="ts">
import { useProjectActions } from '~/composables/editor/useProjectActions';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';

const { resetProjectState } = useProjectActions();
const route = useRoute();
const router = useRouter();
const { isMobile } = useDevice();

// Принудительно сбрасываем состояние проекта в Pinia при попадании на корень
resetProjectState();

// Если мобильное устройство и не выбран принудительный десктопный режим
if (isMobile && route.query.mode !== 'desktop') {
  router.replace('/m');
}
</script>

<template>
  <ProjectsScreen />
</template>
