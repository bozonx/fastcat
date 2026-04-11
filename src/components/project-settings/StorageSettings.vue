<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { computeDirectoryStats, type DirectoryStats } from '~/utils/fs';
import { formatBytes } from '~/utils/format';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import { resolveStorageRootHandle, ensureDirectoryChain } from '~/utils/storage-handles';

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const emit = defineEmits<{
  clearTemp: [];
  deleteProject: [];
}>();

const projectStats = ref<DirectoryStats | null>(null);
const vardataStats = ref<DirectoryStats | null>(null);
const backupStats = ref<DirectoryStats | null>(null);
const isLoadingStats = ref(false);

async function updateStats() {
  if (!projectStore.currentProjectId) return;
  isLoadingStats.value = true;

  try {
    // 1. Calculate project main directory stats
    const projectDir = await projectStore.getProjectDirHandle();
    if (projectDir) {
      projectStats.value = (await computeDirectoryStats(projectDir)) ?? null;
    }

    // 2. Calculate backup directory stats
    try {
      const backupDir = await projectStore.getDirectoryHandleByPath('.fastcat/backups', { create: false });
      if (backupDir) {
        backupStats.value = (await computeDirectoryStats(backupDir)) ?? null;
      } else {
        backupStats.value = { size: 0, filesCount: 0 };
      }
    } catch {
      backupStats.value = { size: 0, filesCount: 0 };
    }

    // 2. Calculate project vardata stats
    if (workspaceStore.workspaceHandle) {
      const workspaceTopology = getWorkspaceStorageTopology();
      const tempRootDir = await resolveStorageRootHandle({
        workspaceHandle: workspaceStore.workspaceHandle,
        rootPath: workspaceStore.resolvedStorageTopology.tempRoot,
      });
      const projectsDir = await ensureDirectoryChain({
        baseDir: tempRootDir,
        segments: [workspaceTopology.tempProjectsDirName],
      });

      try {
        const projectVardataDir = await projectsDir.getDirectoryHandle(
          projectStore.currentProjectId,
        );
        vardataStats.value = (await computeDirectoryStats(projectVardataDir)) ?? null;
      } catch {
        vardataStats.value = { size: 0, filesCount: 0 };
      }
    }
  } catch (e) {
    console.error('Failed to update storage stats', e);
  } finally {
    isLoadingStats.value = false;
  }
}

onMounted(() => {
  updateStats();
});

watch(
  () => projectStore.currentProjectId,
  () => {
    updateStats();
  },
);
</script>

<template>
  <div v-if="projectStore.projectSettings" class="space-y-4 pt-1">
    <div class="space-y-3">
      <!-- Project Size Info -->
      <div class="p-3 rounded border border-ui-border bg-ui-surface">
        <div class="flex items-center justify-between gap-3">
          <div class="flex flex-col gap-1 min-w-0">
            <div class="font-medium text-ui-text">
              {{ t('videoEditor.projectSettings.projectStorage') }}
            </div>
            <div class="text-sm text-ui-text-muted">
              {{ t('common.size') }}:
              <span v-if="projectStats" class="text-ui-text font-medium">
                {{ formatBytes(projectStats.size) }}
              </span>
              <span v-else-if="isLoadingStats" class="opacity-50">...</span>
              <span v-else class="opacity-50">—</span>
            </div>
          </div>
          <UIcon name="i-heroicons-folder" class="w-5 h-5 text-ui-text-muted shrink-0" />
        </div>
      </div>

      <!-- Clear Vardata -->
      <div class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border">
        <div class="flex flex-col gap-1 min-w-0">
          <div class="font-medium text-ui-text">
            {{ t('videoEditor.projectSettings.clearTemp') }}
          </div>
          <div class="text-sm text-ui-text-muted mb-1">
            {{
              t(
                'videoEditor.projectSettings.clearTempHint',
                'Removes all files from vardata for this project',
              )
            }}
          </div>
          <div class="text-xs flex items-center gap-1.5">
            <span class="text-ui-text-muted">{{ t('common.size') }}:</span>
            <span v-if="vardataStats" class="text-ui-text font-medium">
              {{ formatBytes(vardataStats.size) }}
            </span>
            <span v-else-if="isLoadingStats" class="opacity-50">...</span>
            <span v-else class="opacity-50">—</span>
          </div>
        </div>

        <UButton
          color="warning"
          variant="soft"
          icon="i-heroicons-trash"
          :disabled="!projectStore.currentProjectId"
          :label="t('videoEditor.projectSettings.clearTempAction')"
          @click="emit('clearTemp')"
        />
      </div>

      <!-- Clear Backups -->
      <div class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border">
        <div class="flex flex-col gap-1 min-w-0">
          <div class="font-medium text-ui-text">
            {{ t('videoEditor.projectSettings.clearBackups') }}
          </div>
          <div class="text-sm text-ui-text-muted mb-1">
            {{
              t(
                'videoEditor.projectSettings.clearBackupsHint',
                'Removes all auto-saved backups for this project',
              )
            }}
          </div>
          <div class="text-xs flex items-center gap-1.5">
            <span class="text-ui-text-muted">{{ t('common.size') }}:</span>
            <span v-if="backupStats" class="text-ui-text font-medium">
              {{ formatBytes(backupStats.size) }}
            </span>
            <span v-else-if="isLoadingStats" class="opacity-50">...</span>
            <span v-else class="opacity-50">—</span>
          </div>
        </div>

        <UButton
          color="warning"
          variant="soft"
          icon="i-heroicons-trash"
          :disabled="!projectStore.currentProjectId || (backupStats?.size === 0)"
          :label="t('videoEditor.projectSettings.clearTempAction')"
          @click="emit('clearBackups')"
        />
      </div>

      <!-- Delete Project -->
      <div
        class="flex items-center justify-between gap-3 p-3 rounded border border-error-500/20 bg-error-500/5"
      >
        <div class="flex flex-col gap-1 min-w-0">
          <div class="font-medium text-error-400">
            {{ t('videoEditor.projectSettings.deleteProject') }}
          </div>
          <div class="text-sm text-error-400/70">
            {{
              t(
                'videoEditor.projectSettings.deleteProjectConfirmDescription',
                'Permanently delete project folder and all its content',
              )
            }}
          </div>
        </div>

        <UButton
          color="error"
          variant="solid"
          icon="i-heroicons-trash"
          :label="t('videoEditor.projectSettings.deleteProjectAction')"
          @click="emit('deleteProject')"
        />
      </div>
    </div>
  </div>
</template>
