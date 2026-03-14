import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { useProjectStore } from './project.store';

import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';
import { createUiFileTreePersistenceModule } from '~/stores/ui/uiFileTreePersistence';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';

export interface FsEntrySelection {
  kind: 'file' | 'directory';
  name: string;
  path?: string;
  parentPath?: string;
  lastModified?: number;
  size?: number;
  source?: 'local' | 'remote';
  remoteId?: string;
  remotePath?: string;
  remoteData?: unknown;
}

export interface PendingRemoteDownloadRequest {
  entry: RemoteFsEntry;
  targetDirPath: string;
}

export const useUiStore = defineStore('ui', () => {
  const selectedFsEntry = ref<FsEntrySelection | null>(null);
  const showHiddenFiles = ref(readLocalStorageJson('fastcat:ui:show-hidden-files', false));
  const monitorVolume = ref(readLocalStorageJson('fastcat:ui:monitor-volume', 1));
  const monitorMuted = ref(readLocalStorageJson('fastcat:ui:monitor-muted', false));

  watch(
    () => showHiddenFiles.value,
    (val) => writeLocalStorageJson('fastcat:ui:show-hidden-files', val),
  );

  watch(
    () => monitorVolume.value,
    (val) => writeLocalStorageJson('fastcat:ui:monitor-volume', val),
  );

  watch(
    () => monitorMuted.value,
    (val) => writeLocalStorageJson('fastcat:ui:monitor-muted', val),
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
  const isProjectSettingsOpen = ref(false);
  const isEditorSettingsOpen = ref(false);

  function notifyFileManagerUpdate() {
    fileManagerUpdateCounter.value++;
  }

  const projectStore = useProjectStore();
  const fileTreeModule = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
  const {
    restoreFileTreeStateOnce: _restore,
    hasPersistedFileTreeState: _hasState,
    isFileTreePathExpanded,
    setFileTreePathExpanded: _setExpanded,
  } = fileTreeModule;

  function restoreFileTreeStateOnce() {
    if (projectStore.currentProjectId) {
      _restore(projectStore.currentProjectId);
    }
  }

  function hasPersistedFileTreeState() {
    return projectStore.currentProjectId ? _hasState(projectStore.currentProjectId) : false;
  }

  function setFileTreePathExpanded(path: string, expanded: boolean) {
    if (projectStore.currentProjectId) {
      _setExpanded(projectStore.currentProjectId, path, expanded);
    }
  }

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
  const fileBrowserSelectAllTrigger = ref(0);
  const fileTreeSelectAllTrigger = ref(0);

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
    fileBrowserSelectAllTrigger,
    fileTreeSelectAllTrigger,

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
    isProjectSettingsOpen,
    isEditorSettingsOpen,
  };
});
