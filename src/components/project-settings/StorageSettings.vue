<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, onMounted, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  computeDirectoryStats,
  computeDirectoryStatsByPath,
  type DirectoryStats,
} from '~/utils/fs';
import { formatBytes } from '~/utils/format';
import { toProjectProxiesVfsPath, toProjectTempVfsPath } from '~/utils/storage-topology';
import { useVfs } from '~/composables/useVfs';
const log = createDevLogger('StorageSettings');

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const vfs = useVfs();

const emit = defineEmits<{
  clearTemp: [];
}>();

const projectStats = ref<DirectoryStats | null>(null);
const vardataStats = ref<DirectoryStats | null>(null);
const isLoadingStats = ref(false);

function combineStats(stats: DirectoryStats[]): DirectoryStats {
  return stats.reduce<DirectoryStats>(
    (acc, item) => ({
      size: acc.size + item.size,
      filesCount: acc.filesCount + item.filesCount,
      truncated: acc.truncated || item.truncated,
    }),
    { size: 0, filesCount: 0 },
  );
}

async function computeVfsStats(path: string): Promise<DirectoryStats> {
  try {
    return await computeDirectoryStatsByPath(vfs, path);
  } catch {
    return { size: 0, filesCount: 0 };
  }
}

async function updateStats() {
  if (!projectStore.currentProjectId) return;
  isLoadingStats.value = true;

  try {
    // 1. Calculate project main directory stats
    const projectDir = await projectStore.getProjectDirHandle();
    if (projectDir) {
      projectStats.value = (await computeDirectoryStats(projectDir)) ?? null;
    }

    const tempPath = toProjectTempVfsPath(projectStore.currentProjectId);
    const proxiesPath = toProjectProxiesVfsPath(
      workspaceStore.resolvedStorageTopology,
      projectStore.currentProjectId,
    );
    const paths = [...new Set([tempPath, proxiesPath])];
    vardataStats.value = combineStats(
      await Promise.all(paths.map((path) => computeVfsStats(path))),
    );
  } catch (e) {
    log.error('Failed to update storage stats', e);
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
      <!-- Storage block -->
      <div class="rounded border border-ui-border divide-y divide-ui-border">
        <!-- Project files size -->
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <span class="text-sm text-ui-text-muted">
            {{ t('videoEditor.projectSettings.projectStorage') }}
          </span>
          <span v-if="projectStats" class="text-sm text-ui-text font-medium">
            {{ formatBytes(projectStats.size) }}
          </span>
          <span v-else-if="isLoadingStats" class="text-sm opacity-50">...</span>
          <span v-else class="text-sm opacity-50">—</span>
        </div>

        <!-- Temp files size + clear button -->
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <span class="text-sm text-ui-text-muted">
            {{ t('videoEditor.projectSettings.tempStorage') }}
          </span>
          <div class="flex items-center gap-2 shrink-0">
            <span v-if="vardataStats" class="text-sm text-ui-text font-medium">
              {{ formatBytes(vardataStats.size) }}
            </span>
            <span v-else-if="isLoadingStats" class="text-sm opacity-50">...</span>
            <span v-else class="text-sm opacity-50">—</span>
            <UButton
              color="warning"
              variant="soft"
              size="xs"
              icon="i-heroicons-trash"
              :disabled="!projectStore.currentProjectId"
              :label="t('videoEditor.projectSettings.clearTempAction')"
              @click="emit('clearTemp')"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
