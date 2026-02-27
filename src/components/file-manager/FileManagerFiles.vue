<script setup lang="ts">
import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import FileManagerTree from '~/components/FileManagerTree.vue';
import type { FsEntry } from '~/composables/fileManager/useFileManager';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();

const props = defineProps<{
  isDragging: boolean;
  isLoading: boolean;
  error: string | null;
  isApiSupported: boolean;
  rootEntries: FsEntry[];
  getFileIcon: (entry: FsEntry) => string;
}>();

const emit = defineEmits<{
  (e: 'toggle', entry: FsEntry): void;
  (
    e: 'action',
    action: 'createFolder' | 'rename' | 'info' | 'delete' | 'createProxy' | 'deleteProxy',
    entry: FsEntry,
  ): void;
  (e: 'createFolder', entry: FsEntry | null): void;
}>();

const rootContextMenuItems = computed(() => {
  if (!projectStore.currentProjectName) return [];
  return [
    [
      {
        label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
        icon: 'i-heroicons-folder-plus',
        onSelect: () => emit('createFolder', null),
      },
    ],
  ];
});

async function onEntrySelect(entry: FsEntry) {
  uiStore.selectedFsEntry = entry as any;

  if (entry.kind === 'file') {
    focusStore.setTempFocus('left');
  }

  if (entry.kind !== 'file') return;
  if (!entry.path?.toLowerCase().endsWith('.otio')) return;

  await projectStore.openTimelineFile(entry.path);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();
}
</script>

<template>
  <div class="flex-1 overflow-auto min-h-0 min-w-0 relative">
    <UContextMenu :items="rootContextMenuItems">
      <div
        class="min-w-full w-max min-h-full flex flex-col"
        @pointerdown="uiStore.selectedFsEntry = null"
      >
        <!-- Dropzone Top Banner (visible when dragging anywhere in the app) -->
        <div
          v-if="uiStore.isGlobalDragging"
          class="flex flex-col items-center justify-center p-3 bg-primary-500/10 border-2 border-dashed border-primary-500/50 m-2 rounded-lg transition-colors pointer-events-none"
          :class="{ 'bg-primary-500/20 border-primary-500': isDragging }"
        >
          <UIcon
            name="i-heroicons-arrow-down-tray"
            class="w-6 h-6 text-primary-500 mb-1"
            :class="{ 'animate-bounce': isDragging }"
          />
          <p class="text-xs font-medium text-primary-400 text-center">
            {{ t('videoEditor.fileManager.actions.dropFilesToFolder', 'Drop to specific folder below or release here') }}
          </p>
        </div>

        <div v-if="isLoading" class="px-3 py-4 text-sm text-ui-text-muted">
          {{ t('common.loading', 'Loading...') }}
        </div>

        <!-- Empty state -->
        <div
          v-else-if="rootEntries.length === 0 && !error"
          class="flex flex-col items-center justify-center flex-1 w-full gap-3 text-ui-text-disabled px-4 text-center min-h-50"
        >
          <UIcon name="i-heroicons-folder-open" class="w-10 h-10" />
          <p class="text-sm">
            {{
              isApiSupported
                ? t('videoEditor.fileManager.empty', 'No files in this project')
                : t(
                    'videoEditor.fileManager.unsupported',
                    'File System Access API is not supported in this browser',
                  )
            }}
          </p>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="px-3 py-4 text-sm text-error-500 bg-error-500/10 m-2 rounded">
          {{ error }}
        </div>

        <!-- File tree -->
        <FileManagerTree
          v-else
          :entries="rootEntries"
          :depth="0"
          :get-file-icon="getFileIcon"
          @toggle="emit('toggle', $event)"
          @select="onEntrySelect"
          @action="(action, entry) => emit('action', action, entry)"
        />
      </div>
    </UContextMenu>
  </div>
</template>
