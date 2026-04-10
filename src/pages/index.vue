<script setup lang="ts">
import { useProjectActions } from '~/composables/editor/useProjectActions';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';
import {
  readLocalStorageString,
  writeLocalStorageString,
  STORAGE_KEYS,
} from '~/stores/ui/uiLocalStorage';

const { resetProjectState } = useProjectActions();
const route = useRoute();
const router = useRouter();
const { isMobile } = useDevice();

// Принудительно сбрасываем состояние проекта в Pinia при попадании на корень
resetProjectState();

onMounted(() => {
  const alreadyLaunched =
    readLocalStorageString(STORAGE_KEYS.APP.ALREADY_LAUNCHED) === 'true';

  if (!alreadyLaunched) {
    writeLocalStorageString(STORAGE_KEYS.APP.ALREADY_LAUNCHED, 'true');
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
