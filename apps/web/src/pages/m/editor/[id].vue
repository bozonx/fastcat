<script setup lang="ts">
import { until } from '@vueuse/core';
import MobileShell, { type MobileShellTab } from '~/components/editor/MobileShell.vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { usePendingNewProjectFiles } from '~/composables/project/useProjectManagement';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';
import { readLocalStorageString, writeLocalStorageString } from '~/stores/ui/uiLocalStorage';

definePageMeta({
  layout: 'mobile',
});

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const { openProject, leaveProject } = useProjectActions();
const isOpeningProject = ref(true);
const projectOpenError = ref<string | null>(null);

const { pendingFilesForNewProject } = usePendingNewProjectFiles();
const fileManager = useFileManager();
const { addMediaToTimeline } = useAddMediaToTimeline();

const tabToViewMap = {
  files: 'files',
  edit: 'cut',
  export: 'export',
  settings: 'settings',
} as const;

onMounted(async () => {
  const projectId = route.params.id as string;
  if (!projectId) {
    router.push('/m');
    return;
  }

  isOpeningProject.value = true;
  projectOpenError.value = null;

  if (workspaceStore.isInitializing) {
    await until(() => !workspaceStore.isInitializing).toBeTruthy();
  }

  const isTauri = workspaceStore.workspaceProviderId === 'tauri';
  if (!isTauri && !workspaceStore.workspaceHandle) {
    router.push('/m');
    return;
  }

  try {
    await openProject(decodeURIComponent(projectId));
    if (!projectStore.currentProjectName) {
      throw new Error('Project failed to open');
    }

    // Handle view query parameter or restore last active tab from localStorage
    const viewParam = route.query.view as string;
    let targetTab: MobileShellTab = 'edit';
    if (viewParam && ['files', 'edit', 'export', 'settings'].includes(viewParam)) {
      targetTab = viewParam as MobileShellTab;
    } else {
      const lastTab = readLocalStorageString('fastcat:mobile:last-tab', 'edit') as MobileShellTab;
      targetTab = lastTab && ['files', 'edit'].includes(lastTab) ? lastTab : 'edit';
    }

    projectStore.setView(tabToViewMap[targetTab]);

    if (route.query.view !== targetTab) {
      router.replace({
        query: { ...route.query, view: targetTab },
      });
    }

    if (targetTab === 'edit' || targetTab === 'files') {
      writeLocalStorageString('fastcat:mobile:last-tab', targetTab);
    }

    // Auto-import pending files for new project
    if (pendingFilesForNewProject.value.length > 0) {
      const filesToImport = [...pendingFilesForNewProject.value];
      pendingFilesForNewProject.value = []; // Reset immediately to prevent double triggers

      filesToImport.sort((a, b) => a.lastModified - b.lastModified);

      const uploadResults = await fileManager.handleFiles(filesToImport, {
        selectInFileManager: false,
      });

      if (uploadResults && uploadResults.length > 0) {
        const mediaEntries = uploadResults.map((r) => ({
          name: r.fileName,
          path: r.targetPath,
        }));
        await addMediaToTimeline(mediaEntries);
      }
    }
  } catch (error: unknown) {
    projectOpenError.value =
      error instanceof Error ? error.message : t('fastcat.projects.openProjectFailedFallback');
  } finally {
    isOpeningProject.value = false;
  }
});

/** Mirrors the shell's tab into the URL so a reload lands on the same view. */
function onTabChange(tab: MobileShellTab) {
  router.replace({
    query: { ...route.query, view: tab },
  });
  if (tab === 'edit' || tab === 'files') {
    writeLocalStorageString('fastcat:mobile:last-tab', tab);
  }
}

async function handleBack() {
  await leaveProject('/m');
}
</script>

<template>
  <div
    v-if="isOpeningProject"
    class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-ui-text-muted"
  >
    <Icon name="lucide:loader-circle" class="h-8 w-8 animate-spin text-primary-400" />
    <div>
      <p class="text-sm font-medium text-ui-text">{{ t('fastcat.projects.openingProject') }}</p>
      <p class="text-xs text-ui-text-muted">
        {{ t('fastcat.projects.preparingProjectMobile') }}
      </p>
    </div>
  </div>

  <div
    v-else-if="projectOpenError"
    class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
  >
    <div class="max-w-sm rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-200">
      <p class="text-sm font-semibold">{{ t('fastcat.projects.failedToOpenProject') }}</p>
      <p class="mt-2 text-xs text-red-200/80">{{ projectOpenError }}</p>
    </div>
    <UButton
      color="neutral"
      variant="soft"
      icon="lucide:arrow-left"
      :label="t('common.back')"
      @click="handleBack"
    />
  </div>

  <MobileShell v-else @tab-change="onTabChange" />
</template>
