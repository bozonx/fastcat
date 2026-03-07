import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';
import { createUiFileTreePersistenceModule } from '~/stores/ui/uiFileTreePersistence';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';

export interface FsEntrySelection {
  kind: 'file' | 'directory';
  name: string;
  path?: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  source?: 'local' | 'remote';
  remoteId?: string;
  remotePath?: string;
  remoteData?: unknown;
}

export interface PendingRemoteDownloadRequest {
  entry: RemoteFsEntry;
  targetDirHandle: FileSystemDirectoryHandle;
  targetDirPath: string;
}

export const useUiStore = defineStore('ui', () => {
  const selectedFsEntry = ref<FsEntrySelection | null>(null);
  const showHiddenFiles = ref(readLocalStorageJson('gran-video-editor:show-hidden-files', false));
  const monitorVolume = ref(readLocalStorageJson('gran-video-editor:monitor-volume', 1));
  const monitorMuted = ref(readLocalStorageJson('gran-video-editor:monitor-muted', false));

  watch(
    () => showHiddenFiles.value,
    (val) => writeLocalStorageJson('gran-video-editor:show-hidden-files', val),
  );

  watch(
    () => monitorVolume.value,
    (val) => writeLocalStorageJson('gran-video-editor:monitor-volume', val),
  );

  watch(
    () => monitorMuted.value,
    (val) => writeLocalStorageJson('gran-video-editor:monitor-muted', val),
  );

  const isGlobalDragging = ref(false);
  const isFileManagerDragging = ref(false);

  const fileTreeExpandedPaths = ref<Record<string, true>>({});

  const pendingFsEntryDelete = ref<FsEntry[] | null>(null);
  const pendingFsEntryRename = ref<FsEntry | null>(null);
  const pendingFsEntryCreateFolder = ref<FsEntry | null>(null);
  const pendingFsEntryCreateTimeline = ref<FsEntry | null>(null);
  const pendingFsEntryCreateMarkdown = ref<FsEntry | null>(null);
  const pendingOtioCreateVersion = ref<FsEntry | null>(null);
  const pendingRemoteDownloadRequest = ref<PendingRemoteDownloadRequest | null>(null);
  const remoteExchangeModalOpen = ref(false);
  const remoteExchangeLocalEntry = ref<FsEntry | null>(null);

  const fileManagerUpdateCounter = ref(0);

  function notifyFileManagerUpdate() {
    fileManagerUpdateCounter.value++;
  }

  const fileTreeModule = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
  const {
    restoreFileTreeStateOnce,
    hasPersistedFileTreeState,
    isFileTreePathExpanded,
    setFileTreePathExpanded,
  } = fileTreeModule;

  const fsSidebarWidth = ref(0);
  const previewZoomTrigger = ref({ dir: 0, timestamp: 0 });
  const previewZoomResetTrigger = ref(0);
  const monitorZoomTrigger = ref({ dir: 0, timestamp: 0 });
  const monitorZoomResetTrigger = ref(0);
  const previewPlaybackTrigger = ref<{
    action: 'toggle' | 'toggle1' | 'toStart' | 'toEnd' | 'set' | '';
    speed?: number;
    direction?: 'forward' | 'backward' | '';
    timestamp: number;
  }>({ action: '', speed: 0, direction: '', timestamp: 0 });
  const previewFullscreenToggleTrigger = ref(0);

  function setFsSidebarWidth(width: number) {
    fsSidebarWidth.value = width;
  }

  function triggerPreviewZoom(dir: 1 | -1) {
    previewZoomTrigger.value = { dir, timestamp: Date.now() };
  }

  function triggerPreviewZoomReset() {
    previewZoomResetTrigger.value = Date.now();
  }

  function triggerMonitorZoom(dir: 1 | -1) {
    monitorZoomTrigger.value = { dir, timestamp: Date.now() };
  }

  function triggerMonitorZoomReset() {
    monitorZoomResetTrigger.value = Date.now();
  }

  function triggerPreviewPlayback(
    action: 'toggle' | 'toggle1' | 'toStart' | 'toEnd' | 'set',
    speed?: number,
    direction?: 'forward' | 'backward',
  ) {
    previewPlaybackTrigger.value = { action, speed, direction, timestamp: Date.now() };
  }

  function togglePreviewFullscreen() {
    previewFullscreenToggleTrigger.value = Date.now();
  }

  const scrollToEffectsTrigger = ref(0);

  function triggerScrollToEffects() {
    scrollToEffectsTrigger.value = Date.now();
  }

  const timelineSaveTrigger = ref(0);

  function notifyTimelineSave() {
    timelineSaveTrigger.value++;
  }

  return {
    selectedFsEntry,
    isGlobalDragging,
    isFileManagerDragging,
    fileTreeExpandedPaths,
    pendingFsEntryDelete,
    pendingFsEntryRename,
    pendingFsEntryCreateFolder,
    pendingFsEntryCreateMarkdown,
    pendingFsEntryCreateTimeline,
    pendingOtioCreateVersion,
    pendingRemoteDownloadRequest,
    remoteExchangeModalOpen,
    remoteExchangeLocalEntry,

    fsSidebarWidth,
    setFsSidebarWidth,

    previewZoomTrigger,
    previewZoomResetTrigger,
    monitorZoomTrigger,
    monitorZoomResetTrigger,
    previewPlaybackTrigger,
    previewFullscreenToggleTrigger,

    triggerPreviewZoom,
    triggerPreviewZoomReset,
    triggerMonitorZoom,
    triggerMonitorZoomReset,
    triggerPreviewPlayback,
    togglePreviewFullscreen,
    timelineSaveTrigger,

    showHiddenFiles,
    fileManagerUpdateCounter,
    notifyFileManagerUpdate,
    notifyTimelineSave,
    restoreFileTreeStateOnce,
    hasPersistedFileTreeState,
    isFileTreePathExpanded,
    setFileTreePathExpanded,

    scrollToEffectsTrigger,
    triggerScrollToEffects,

    monitorVolume,
    monitorMuted,
  };
});
