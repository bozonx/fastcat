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

// Reset project state in Pinia when landing on the root — but only if a project
// is actually open. Otherwise this becomes a floating promise (closeProject + save)
// that may race the ongoing project load in the editor during autostart
// (`openLastProjectOnStart` → navigateTo('/editor/X')) and wipe its state.
if (projectStore.currentProjectName) {
  void resetProjectState();
}

onMounted(() => {
  if (route.query.mode === 'desktop') {
    writeLocalStorageString(STORAGE_KEYS.APP.PREFER_DESKTOP, 'true');
  }

  const preferDesktop = readLocalStorageString(STORAGE_KEYS.APP.PREFER_DESKTOP) === 'true';

  // If on a mobile device and forced desktop mode is not selected
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
