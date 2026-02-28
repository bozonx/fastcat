<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import FileManagerTree from '~/components/FileManagerTree.vue';
import type { FsEntry } from '~/composables/fileManager/useFileManager';
import { FILE_MANAGER_MOVE_DRAG_TYPE } from '~/composables/useDraggedFile';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();

const scrollEl = ref<HTMLElement | null>(null);
const lastDragEvent = ref<DragEvent | null>(null);
let autoScrollRaf: number | null = null;
let isWheelListenerAttached = false;

function isRelevantDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) || types.includes('Files');
}

function stopAutoScroll() {
  lastDragEvent.value = null;
  if (autoScrollRaf !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }

  if (isWheelListenerAttached && typeof window !== 'undefined') {
    window.removeEventListener('wheel', onWindowWheel as any);
    isWheelListenerAttached = false;
  }
}

function onWindowWheel(e: WheelEvent) {
  const el = scrollEl.value;
  if (!el) return;

  if (!lastDragEvent.value) return;
  if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;

  e.preventDefault();
  el.scrollTop += e.deltaY;
}

function scheduleAutoScroll() {
  if (autoScrollRaf !== null) return;
  if (typeof window === 'undefined') return;

  const tick = () => {
    autoScrollRaf = null;
    const el = scrollEl.value;
    const ev = lastDragEvent.value;
    if (!el || !ev) return;

    const rect = el.getBoundingClientRect();
    const zone = 48;
    const maxSpeed = 16;

    const topDist = ev.clientY - rect.top;
    const bottomDist = rect.bottom - ev.clientY;

    let dy = 0;
    if (topDist >= 0 && topDist < zone) {
      dy = -Math.ceil(((zone - topDist) / zone) * maxSpeed);
    } else if (bottomDist >= 0 && bottomDist < zone) {
      dy = Math.ceil(((zone - bottomDist) / zone) * maxSpeed);
    }

    if (dy !== 0) {
      el.scrollTop += dy;
      scheduleAutoScroll();
    }
  };

  autoScrollRaf = window.requestAnimationFrame(tick);
}

function onContainerDragOver(e: DragEvent) {
  if (!isRelevantDrag(e)) return;
  lastDragEvent.value = e;
  scheduleAutoScroll();

  if (!isWheelListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('wheel', onWindowWheel, { passive: false });
    isWheelListenerAttached = true;
  }
}

function onContainerDrop() {
  stopAutoScroll();
}

function onContainerDragLeave(e: DragEvent) {
  const currentTarget = e.currentTarget as HTMLElement | null;
  const relatedTarget = e.relatedTarget as Node | null;
  if (!currentTarget?.contains(relatedTarget)) {
    stopAutoScroll();
  }
}

const props = defineProps<{
  isDragging: boolean;
  isLoading: boolean;
  isApiSupported: boolean;
  rootEntries: FsEntry[];
  getFileIcon: (entry: FsEntry) => string;
  findEntryByPath: (path: string) => FsEntry | null;
  moveEntry: (params: {
    source: FsEntry;
    targetDirHandle: FileSystemDirectoryHandle;
    targetDirPath: string;
  }) => Promise<void>;
  getProjectRootDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
  handleFiles: (
    files: FileList | File[],
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) => Promise<void>;
}>();

const emit = defineEmits<{
  (e: 'toggle', entry: FsEntry): void;
  (
    e: 'action',
    action:
      | 'createFolder'
      | 'rename'
      | 'info'
      | 'delete'
      | 'createProxy'
      | 'deleteProxy'
      | 'upload'
      | 'createProxyForFolder',
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

const isRootDropOver = ref(false);

function onRootDragOver(e: DragEvent) {
  if (!isRelevantDrag(e)) return;

  isRootDropOver.value = true;
  e.dataTransfer!.dropEffect = e.dataTransfer?.types.includes('Files') ? 'copy' : 'move';
}

function onRootDragLeave(e: DragEvent) {
  const currentTarget = e.currentTarget as HTMLElement | null;
  const relatedTarget = e.relatedTarget as Node | null;
  if (!currentTarget?.contains(relatedTarget)) {
    isRootDropOver.value = false;
  }
}

async function onRootDrop(e: DragEvent) {
  isRootDropOver.value = false;

  const rootHandle = await props.getProjectRootDirHandle();
  if (!rootHandle) return;

  if (e.dataTransfer?.types.includes('Files')) {
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await props.handleFiles(files, rootHandle, '');
    }
    return;
  }

  const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
  if (!moveRaw) return;

  let parsed: any;
  try {
    parsed = JSON.parse(moveRaw);
  } catch {
    return;
  }

  const sourcePath = typeof parsed?.path === 'string' ? parsed.path : '';
  if (!sourcePath) return;

  const source = props.findEntryByPath(sourcePath);
  if (!source) return;

  await props.moveEntry({
    source,
    targetDirHandle: rootHandle,
    targetDirPath: '',
  });
}

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
  <div
    ref="scrollEl"
    class="flex-1 overflow-auto min-h-0 min-w-0 relative"
    @dragover="onContainerDragOver"
    @dragleave="onContainerDragLeave"
    @drop="onContainerDrop"
  >
    <UContextMenu :items="rootContextMenuItems">
      <div
        class="min-w-full w-max min-h-full flex flex-col pb-12"
        @pointerdown="
          uiStore.selectedFsEntry = null;
          selectionStore.clearSelection();
        "
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

        <div v-if="isLoading && rootEntries.length === 0" class="px-3 py-4 text-sm text-ui-text-muted">
          {{ t('common.loading', 'Loading...') }}
        </div>

        <!-- Empty state -->
        <div
          v-else-if="rootEntries.length === 0"
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

        <!-- File tree -->
        <div v-else class="flex flex-col flex-1">
          <FileManagerTree
            :entries="rootEntries"
            :depth="0"
            :get-file-icon="getFileIcon"
            :find-entry-by-path="findEntryByPath"
            :move-entry="moveEntry"
            @toggle="emit('toggle', $event)"
            @select="onEntrySelect"
            @action="(action, entry) => emit('action', action, entry)"
          />
          <div v-if="isLoading" class="absolute inset-0 bg-ui-bg/30 flex items-center justify-center z-50">
            <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin text-primary-500" />
          </div>
        </div>

        <div
          class="h-12 shrink-0"
          :class="{ 'bg-primary-500/10 outline outline-primary-500/40 -outline-offset-1': isRootDropOver }"
          @dragover.prevent="onRootDragOver"
          @dragleave.prevent="onRootDragLeave"
          @drop.prevent="onRootDrop"
        />
      </div>
    </UContextMenu>
  </div>
</template>
