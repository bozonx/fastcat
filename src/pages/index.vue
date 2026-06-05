<script setup lang="ts">
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectStore } from '~/stores/project.store';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';
import {
  readLocalStorageString,
  writeLocalStorageString,
  STORAGE_KEYS,
} from '~/stores/ui/uiLocalStorage';

const { resetProjectState } = useProjectActions();
const projectStore = useProjectStore();
const route = useRoute();
const router = useRouter();
const { isMobile } = useDevice();

// Сбрасываем состояние проекта в Pinia при попадании на корень — но только если
// проект реально открыт. Иначе это floating-промис (closeProject + save), который
// при автостарте (`openLastProjectOnStart` → navigateTo('/editor/X')) может
// «догнать» уже идущую загрузку проекта в редакторе и обнулить её состояние.
if (projectStore.currentProjectName) {
  void resetProjectState();
}

onMounted(() => {
  if (route.query.mode === 'desktop') {
    writeLocalStorageString(STORAGE_KEYS.APP.PREFER_DESKTOP, 'true');
  }

  const preferDesktop = readLocalStorageString(STORAGE_KEYS.APP.PREFER_DESKTOP) === 'true';

  // Если мобильное устройство и не выбран принудительный десктопный режим
  if (isMobile && !preferDesktop) {
    router.replace('/m');
    return;
  }

  const alreadyLaunched = readLocalStorageString(STORAGE_KEYS.APP.ALREADY_LAUNCHED) === 'true';
  if (!alreadyLaunched) {
    writeLocalStorageString(STORAGE_KEYS.APP.ALREADY_LAUNCHED, 'true');
  }
});
</script>

<template>
  <ProjectsScreen />
</template>
