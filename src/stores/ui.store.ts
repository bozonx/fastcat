import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { useProjectStore } from './project.store';

import {
  readLocalStorageJson,
  writeLocalStorageJson,
  STORAGE_KEYS,
} from '~/stores/ui/uiLocalStorage';
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
  adapterPayload?: unknown;
}

export interface PendingRemoteDownloadRequest {
  entry: RemoteFsEntry;
  targetDirPath: string;
}

export const useUiStore = defineStore('ui', () => {
  const workspaceStore = useWorkspaceStore();
  const selectedFsEntry = ref<FsEntrySelection | null>(null);
  const monitorVolume = ref(readLocalStorageJson(STORAGE_KEYS.UI.MONITOR_VOLUME, 1));
  const monitorMuted = ref(readLocalStorageJson(STORAGE_KEYS.UI.MONITOR_MUTED, false));

  watch(
    () => monitorVolume.value,
    (val) => {
      if (workspaceStore.isEphemeral) return;
      writeLocalStorageJson(STORAGE_KEYS.UI.MONITOR_VOLUME, val);
    },
  );

  watch(
    () => monitorMuted.value,
    (val) => {
      if (workspaceStore.isEphemeral) return;
      writeLocalStorageJson(STORAGE_KEYS.UI.MONITOR_MUTED, val);
    },
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
  const pendingBloggerDogCreateSubgroup = ref<FsEntry | null>(null);
  const pendingBloggerDogCreateItem = ref<FsEntry | null>(null);
  const pendingFsEntryPaste = ref<FsEntry | null>(null);
  const pendingClipRename = ref<{ trackId: string; itemId: string; name: string } | null>(null);
  const pendingRecoveryDialog = ref<{
    timelinePath: string;
    resolve: (choice: 'open-saved' | 'restore-autosave') => void;
  } | null>(null);
  const pendingCloseDialog = ref<{
    dirtyCount: number;
    resolve: (choice: 'save' | 'dont-save' | 'cancel') => void;
  } | null>(null);
  const clipPasteParametersTrigger = ref<{
    trackId: string;
    itemId: string;
    timestamp: number;
  } | null>(null);

  function triggerClipPasteParameters(trackId: string, itemId: string) {
    clipPasteParametersTrigger.value = { trackId, itemId, timestamp: Date.now() };
  }

  const fileManagerUpdateCounter = ref(0);
  const isProjectSettingsOpen = ref(false);
  const isEditorSettingsOpen = ref(false);
  const isBackgroundTasksOpen = ref(false);
  const isExtractingAudio = ref(false);
  const extractingAudioError = ref<string | null>(null);
  const editorSettingsActiveSection = ref<string>('user.general');
  const activeModalsCount = ref(0);
  const isMobileTimelineDrawerOpen = ref(false);

  const DEFAULT_LIBRARY_TAB = 'texts';
  const activeLibraryTab = ref<'texts' | 'shapes' | 'hud'>(DEFAULT_LIBRARY_TAB);

  const isTextPresetModalOpen = ref(false);
  const pendingTextPresetClipInfo = ref<{ trackId: string; itemId: string } | null>(null);

  const mediaReplaceTarget = ref<{
    trackId: string;
    itemId: string;
    expectedType: 'video' | 'image' | 'audio';
  } | null>(null);
  const isMediaReplaceModalOpen = ref(false);

  const remoteExchangeModalOpen = ref(false);
  const remoteExchangeLocalEntry = ref<FsEntry | null>(null);

  function notifyFileManagerUpdate() {
    fileManagerUpdateCounter.value++;
  }

  const projectStore = useProjectStore();
  const fileTreeModule = createUiFileTreePersistenceModule({
    fileTreeExpandedPaths,
  });
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

  const previewZoomTrigger = ref({ dir: 0, timestamp: 0 });
  const previewZoomResetTrigger = ref(0);
  const previewZoomFitTrigger = ref(0);
  const monitorZoomTrigger = ref({ dir: 0, timestamp: 0 });
  const monitorZoomResetTrigger = ref(0);
  const monitorZoomFitTrigger = ref(0);
  const previewPlaybackTrigger = ref<{
    action: 'toggle' | 'toggle1' | 'toStart' | 'toEnd' | 'set' | '';
    speed?: number;
    direction?: 'forward' | 'backward' | '';
    timestamp: number;
  }>({ action: '', speed: 0, direction: '', timestamp: 0 });
  const previewFullscreenToggleTrigger = ref(0);
  const fileBrowserSelectAllTrigger = ref(0);
  const fileBrowserNavigateBackTrigger = ref(0);
  const fileBrowserNavigateForwardTrigger = ref(0);
  const fileBrowserNavigateUpTrigger = ref(0);
  const fileBrowserMoveSelectionTrigger = ref<{
    dir: 'up' | 'down' | 'left' | 'right';
    timestamp: number;
  }>({
    dir: 'up',
    timestamp: 0,
  });

  function triggerPreviewZoom(dir: 1 | -1) {
    previewZoomTrigger.value = { dir, timestamp: Date.now() };
  }

  function triggerPreviewZoomReset() {
    previewZoomResetTrigger.value = Date.now();
  }

  function triggerPreviewZoomFit() {
    previewZoomFitTrigger.value = Date.now();
  }

  function triggerMonitorZoom(dir: 1 | -1) {
    monitorZoomTrigger.value = { dir, timestamp: Date.now() };
  }

  function triggerMonitorZoomReset() {
    monitorZoomResetTrigger.value = Date.now();
  }

  function triggerMonitorZoomFit() {
    monitorZoomFitTrigger.value = Date.now();
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

  const scrollToFileTreeEntryPath = ref<string | null>(null);
  const scrollToFileTreeEntryTrigger = ref(0);

  function triggerScrollToFileTreeEntry(path: string) {
    scrollToFileTreeEntryPath.value = path;
    scrollToFileTreeEntryTrigger.value = Date.now();
  }

  const showTextPresetMenuTrigger = ref<{
    trackId: string;
    itemId: string;
    x: number;
    y: number;
    timestamp: number;
  } | null>(null);

  function triggerShowTextPresetMenu(params: {
    trackId: string;
    itemId: string;
    x: number;
    y: number;
  }) {
    showTextPresetMenuTrigger.value = { ...params, timestamp: Date.now() };
  }

  const timelineSaveTrigger = ref(0);

  function notifyTimelineSave() {
    timelineSaveTrigger.value++;
  }

  const openAutoMontageTrigger = ref<{ itemIds: string[]; timestamp: number } | null>(null);

  function triggerOpenAutoMontage(itemIds: string[]) {
    openAutoMontageTrigger.value = { itemIds, timestamp: Date.now() };
  }

  function showIntegrationSettings() {
    editorSettingsActiveSection.value = 'user.integrations';
    isEditorSettingsOpen.value = true;
  }

  const speedModalTrigger = ref<{
    trackId: string;
    itemId: string;
    speed: number;
    timestamp: number;
  } | null>(null);

  function triggerSpeedModal(trackId: string, itemId: string, speed: number) {
    speedModalTrigger.value = { trackId, itemId, speed, timestamp: Date.now() };
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
    pendingBloggerDogCreateSubgroup,
    pendingBloggerDogCreateItem,
    pendingFsEntryPaste,
    pendingClipRename,
    clipPasteParametersTrigger,
    triggerClipPasteParameters,
    remoteExchangeModalOpen,
    remoteExchangeLocalEntry,
    pendingRecoveryDialog,
    pendingCloseDialog,

    previewZoomTrigger,
    previewZoomResetTrigger,
    previewZoomFitTrigger,
    monitorZoomTrigger,
    monitorZoomResetTrigger,
    monitorZoomFitTrigger,
    previewPlaybackTrigger,
    previewFullscreenToggleTrigger,
    fileBrowserSelectAllTrigger,
    fileBrowserNavigateBackTrigger,
    fileBrowserNavigateForwardTrigger,
    fileBrowserNavigateUpTrigger,
    fileBrowserMoveSelectionTrigger,

    triggerPreviewZoom,
    triggerPreviewZoomReset,
    triggerPreviewZoomFit,
    triggerMonitorZoom,
    triggerMonitorZoomReset,
    triggerMonitorZoomFit,
    triggerPreviewPlayback,
    togglePreviewFullscreen,
    timelineSaveTrigger,

    fileManagerUpdateCounter,
    notifyFileManagerUpdate,
    notifyTimelineSave,
    restoreFileTreeStateOnce,
    hasPersistedFileTreeState,
    isFileTreePathExpanded,
    setFileTreePathExpanded,

    scrollToEffectsTrigger,
    triggerScrollToEffects,

    scrollToFileTreeEntryPath,
    scrollToFileTreeEntryTrigger,
    triggerScrollToFileTreeEntry,

    showTextPresetMenuTrigger,
    triggerShowTextPresetMenu,

    monitorVolume,
    monitorMuted,
    isProjectSettingsOpen,
    isEditorSettingsOpen,
    isBackgroundTasksOpen,
    isExtractingAudio,
    extractingAudioError,
    activeModalsCount,
    isMobileTimelineDrawerOpen,
    activeLibraryTab,
    isTextPresetModalOpen,
    pendingTextPresetClipInfo,
    mediaReplaceTarget,
    isMediaReplaceModalOpen,
    editorSettingsActiveSection,
    showIntegrationSettings,
    openAutoMontageTrigger,
    triggerOpenAutoMontage,
    speedModalTrigger,
    triggerSpeedModal,
  };
});
