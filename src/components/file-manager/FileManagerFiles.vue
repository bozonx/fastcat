<script setup lang="ts">
import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import FileManagerTree from '~/components/FileManagerTree.vue';
import type { FsEntry } from '~/composables/fileManager/useFileManager';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();

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
  (e: 'action', action: 'createFolder' | 'rename' | 'info' | 'delete', entry: FsEntry): void;
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
      <div class="min-w-full w-max min-h-full flex flex-col">
        <!-- Dropzone Overlay -->
        <div
          v-if="isDragging"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900/80 backdrop-blur-sm border-2 border-dashed border-primary-500 m-2 rounded-lg pointer-events-none"
        >
          <UIcon
            name="i-heroicons-arrow-down-tray"
            class="w-12 h-12 text-primary-500 mb-2 animate-bounce"
          />
          <p class="text-sm font-medium text-primary-400">
            {{ t('videoEditor.fileManager.actions.dropFilesHere', 'Drop files here') }}
          </p>
        </div>

        <div v-if="isLoading" class="px-3 py-4 text-sm text-gray-400">
          {{ t('common.loading', 'Loading...') }}
        </div>

        <!-- Empty state -->
        <div
          v-else-if="rootEntries.length === 0 && !error"
          class="flex flex-col items-center justify-center flex-1 w-full gap-3 text-gray-600 px-4 text-center min-h-50"
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
        <div v-else-if="error" class="px-3 py-4 text-sm text-red-500 bg-red-500/10 m-2 rounded">
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
