<script setup lang="ts">
import { ref, computed, watch, toRaw, onUnmounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import {
  useFilesPageStore,
  type FileViewMode,
  type FileSortField,
  type SortOrder,
} from '~/stores/filesPage.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFileManagerThumbnails } from '~/composables/fileManager/useFileManagerThumbnails';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import {
  getMediaTypeFromFilename,
  getIconForMediaType,
  getMimeTypeFromFilename,
  isOpenableProjectFileName,
} from '~/utils/media-types';
import WheelSlider from '~/components/ui/WheelSlider.vue';

import { useFileManagerActions } from '~/composables/fileManager/useFileManagerActions';
import FileBrowserToolbar from '~/components/file-manager/FileBrowserToolbar.vue';
import FileBrowserBreadcrumbs from '~/components/file-manager/FileBrowserBreadcrumbs.vue';
import FileBrowserStatusBar from '~/components/file-manager/FileBrowserStatusBar.vue';
import FileBrowserViewGrid from '~/components/file-manager/FileBrowserViewGrid.vue';
import FileBrowserViewList from '~/components/file-manager/FileBrowserViewList.vue';
import { useFileBrowserDragAndDrop } from '~/composables/fileManager/useFileBrowserDragAndDrop';
import ProgressSpinner from '~/components/ui/ProgressSpinner.vue';
import {
  useDraggedFile,
  INTERNAL_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { useFileDrop } from '~/composables/fileManager/useFileDrop';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import {
  createTimelineCommand,
  createMarkdownCommand,
} from '~/file-manager/application/fileManagerCommands';
import { useFileContextMenu } from '~/composables/fileManager/useFileContextMenu';
import type { FileAction as ContextMenuFileAction } from '~/composables/fileManager/useFileContextMenu';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';
import { useAudioExtraction } from '~/composables/fileManager/useAudioExtraction';
import { useFocusStore } from '~/stores/focus.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  downloadRemoteFile,
  fetchRemoteVfsList,
  getRemoteFileDownloadUrl,
  isRemoteFsEntry,
  type RemoteFsEntry,
  toRemoteFsEntry,
} from '~/utils/remote-vfs';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';
import type { RemoteVfsEntry, RemoteVfsFileEntry } from '~/types/remote-vfs';
import { transcribeProjectAudioFile } from '~/utils/stt';
import AppModal from '~/components/ui/AppModal.vue';
import {
  stripWorkspaceCommonPathPrefix,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

import PQueue from 'p-queue';

const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const fileManager = useFileManager();
const proxyStore = useProxyStore();
const workspaceStore = useWorkspaceStore();
const { addFileTab, setActiveTab } = useProjectTabs();
const runtimeConfig = useRuntimeConfig();
const toast = useToast();

const fileConversion = useFileConversion();
const { extractAudio } = useAudioExtraction();
const {
  isModalOpen: conversionModalOpen,
  videoFormat: conversionVideoFormat,
  videoCodec: conversionVideoCodec,
  videoBitrateMbps: conversionVideoBitrateMbps,
  excludeAudio: conversionExcludeAudio,
  audioCodec: conversionAudioCodec,
  audioBitrateKbps: conversionAudioBitrateKbps,
  bitrateMode: conversionBitrateMode,
  keyframeIntervalSec: conversionKeyframeIntervalSec,
  audioOnlyFormat: conversionAudioOnlyFormat,
  audioOnlyCodec: conversionAudioOnlyCodec,
  audioOnlyBitrateKbps: conversionAudioOnlyBitrateKbps,
  audioChannels: conversionAudioChannels,
  audioSampleRate: conversionAudioSampleRate,
  imageQuality: conversionImageQuality,
  imageWidth: conversionImageWidth,
  imageHeight: conversionImageHeight,
  isImageResolutionLinked: conversionIsImageResolutionLinked,
  imageAspectRatio: conversionImageAspectRatio,
  mediaType: conversionMediaType,
  targetEntry: conversionTargetEntry,
  originalAudioSampleRate: conversionOriginalAudioSampleRate,
  isConverting: conversionIsConverting,
  conversionProgress: conversionProgress,
  conversionError: conversionError,
  conversionPhase: conversionPhase,
} = fileConversion;

const props = defineProps<{
  isFilesPage?: boolean;
}>();
const {
  readDirectory,
  getFileIcon,
  loadProjectDirectory,
  createFolder,
  renameEntry,
  deleteEntry,
  handleFiles,
  moveEntry,
  findEntryByPath,
  resolveEntryByPath,
  reloadDirectory,
  vfs,
} = fileManager;
const { t } = useI18n();

const skipNextUpdateReload = ref(false);

const {
  isDragOverPanel,
  dragOverEntryPath,
  isRootDropOver,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onEntryDragStart,
  onEntryDragEnd,
  onEntryDragOver,
  onEntryDragLeave,
  onEntryDrop,
  onPanelDragOver,
  onPanelDragLeave,
  onPanelDrop,
} = useFileBrowserDragAndDrop({
  findEntryByPath,
  resolveEntryByPath,
  handleFiles,
  moveEntry,
  loadFolderContent,
  notifyFileManagerUpdate: () => {
    skipNextUpdateReload.value = true;
    uiStore.notifyFileManagerUpdate();
  },
});

const rootContainer = ref<HTMLElement | null>(null);
const pendingScrollToEntryPath = ref<string | null>(null);

const isMarqueeSelecting = ref(false);
const marqueeStart = ref<{ x: number; y: number } | null>(null);
const marqueeCurrent = ref<{ x: number; y: number } | null>(null);

function getPointInScrollContainer(
  e: PointerEvent,
  container: HTMLElement,
): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  return {
    x: e.clientX - rect.left + container.scrollLeft,
    y: e.clientY - rect.top + container.scrollTop,
  };
}

const marqueeRect = computed(() => {
  if (!isMarqueeSelecting.value || !marqueeStart.value || !marqueeCurrent.value) return null;
  const x1 = marqueeStart.value.x;
  const y1 = marqueeStart.value.y;
  const x2 = marqueeCurrent.value.x;
  const y2 = marqueeCurrent.value.y;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x1 - x2);
  const height = Math.abs(y1 - y2);
  return { left, top, width, height };
});

const marqueeStyle = computed(() => {
  const r = marqueeRect.value;
  if (!r) return null;
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  };
});

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function selectEntriesInMarquee() {
  const container = rootContainer.value;
  const r = marqueeRect.value;
  if (!container || !r) return;

  const selRect = {
    left: r.left,
    top: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
  };

  const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-entry-path]'));
  const byPath = new Map<string, FsEntry>();
  for (const e of sortedEntries.value) {
    if (e.path) byPath.set(e.path, e);
  }

  const selected: FsEntry[] = [];
  const containerRect = container.getBoundingClientRect();

  for (const el of nodes) {
    const path = el.dataset.entryPath;
    if (!path) continue;

    const entry = byPath.get(path);
    if (!entry) continue;

    const elRect = el.getBoundingClientRect();
    const left = elRect.left - containerRect.left + container.scrollLeft;
    const top = elRect.top - containerRect.top + container.scrollTop;
    const rect = {
      left,
      top,
      right: left + elRect.width,
      bottom: top + elRect.height,
    };

    if (rectsIntersect(selRect, rect)) {
      selected.push(entry);
    }
  }

  selectionStore.selectFsEntries(selected);
}

function onMarqueePointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const container = rootContainer.value;
  if (!container) return;

  focusBrowserPanel();

  const target = e.target as HTMLElement | null;
  if (target?.tagName === 'INPUT') return;
  if (target?.closest?.('[data-entry-path]')) return;

  const point = getPointInScrollContainer(e, container);
  isMarqueeSelecting.value = true;
  marqueeStart.value = point;
  marqueeCurrent.value = point;

  try {
    container.setPointerCapture(e.pointerId);
  } catch {
    // ignore
  }
}

function onMarqueePointerMove(e: PointerEvent) {
  if (!isMarqueeSelecting.value) return;
  const container = rootContainer.value;
  if (!container) return;

  marqueeCurrent.value = getPointInScrollContainer(e, container);
  selectEntriesInMarquee();
}

const preventClickClear = ref(false);

function focusBrowserPanel() {
  focusStore.setPanelFocus('filesBrowser');
}

function handleContainerClick() {
  focusBrowserPanel();
  if (preventClickClear.value) return;
  selectionStore.clearSelection();
}

function onMarqueePointerUp(e: PointerEvent) {
  if (!isMarqueeSelecting.value) return;
  const container = rootContainer.value;
  if (container) {
    try {
      container.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  const r = marqueeRect.value;
  if (r && (r.width > 3 || r.height > 3)) {
    preventClickClear.value = true;
    setTimeout(() => {
      preventClickClear.value = false;
    }, 0);
  }

  isMarqueeSelecting.value = false;
  marqueeStart.value = null;
  marqueeCurrent.value = null;
}

function onContainerKeyDown(e: KeyboardEvent) {
  const container = rootContainer.value;
  if (!container) return;

  // We only want to handle keys if focus is within our container
  // and not inside an input field (e.g. InlineNameEditor)
  const activeEl = document.activeElement as HTMLElement;
  if (activeEl?.tagName === 'INPUT') return;

  const items = Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'));

  if (items.length === 0) return;

  const currentIndex = items.indexOf(activeEl);

  if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();

    if (currentIndex === -1) {
      items[0]?.focus();
      return;
    }

    let nextIndex = currentIndex;
    const isGrid = filesPageStore.viewMode === 'grid';

    if (e.key === 'ArrowRight') {
      nextIndex = Math.min(currentIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowLeft') {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (e.key === 'ArrowDown') {
      if (isGrid && items[0]) {
        // Find columns count by looking at items in the first row
        const firstTop = items[0].offsetTop;
        let cols = 0;
        while (cols < items.length && items[cols]?.offsetTop === firstTop) cols++;
        cols = cols || 1;
        nextIndex = Math.min(currentIndex + cols, items.length - 1);
      } else {
        nextIndex = Math.min(currentIndex + 1, items.length - 1);
      }
    } else if (e.key === 'ArrowUp') {
      if (isGrid && items[0]) {
        const firstTop = items[0].offsetTop;
        let cols = 0;
        while (cols < items.length && items[cols]?.offsetTop === firstTop) cols++;
        cols = cols || 1;
        nextIndex = Math.max(currentIndex - cols, 0);
      } else {
        nextIndex = Math.max(currentIndex - 1, 0);
      }
    }

    if (nextIndex !== currentIndex) {
      const item = items[nextIndex];
      if (item) {
        item.focus();
      }
    }
  }
}

const folderEntries = ref<FsEntry[]>([]);
const parentFolders = ref<FsEntry[]>([]);
const isRemoteMode = ref(false);
const remoteCurrentFolder = ref<RemoteFsEntry | null>(null);
const lastLocalFolder = ref<FsEntry | null>(null);
const remoteTransferOpen = ref(false);
const remoteTransferProgress = ref(0);
const remoteTransferPhase = ref('');
const remoteTransferFileName = ref('');
const remoteTransferAbortController = ref<AbortController | null>(null);

const remoteFilesConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'files',
    integrations: workspaceStore.userSettings.integrations,
    granPublicadorBaseUrl:
      typeof runtimeConfig.public.gpanPublicadorBaseUrl === 'string'
        ? runtimeConfig.public.gpanPublicadorBaseUrl
        : '',
  }),
);

const isRemoteAvailable = computed(() => Boolean(remoteFilesConfig.value));

const sttConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'stt',
    integrations: workspaceStore.userSettings.integrations,
    granPublicadorBaseUrl:
      typeof runtimeConfig.public.gpanPublicadorBaseUrl === 'string'
        ? runtimeConfig.public.gpanPublicadorBaseUrl
        : '',
  }),
);

const {
  isDeleteConfirmModalOpen,
  editingEntryPath,
  commitRename,
  stopRename,
  startRename,
  deleteTargets,
  directoryUploadTarget,
  directoryUploadInput,
  handleDeleteConfirm,
  onFileAction: onFileActionBase,
} = useFileManagerActions({
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory,
  handleFiles,
  mediaCache: fileManager.mediaCache,
  vfs,
  findEntryByPath: fileManager.findEntryByPath,
  readDirectory: fileManager.readDirectory,
  reloadDirectory: fileManager.reloadDirectory,
  notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
  setFileTreePathExpanded: (path, expanded) => {
    const projectName = projectStore.currentProjectName;
    if (projectName) uiStore.setFileTreePathExpanded(projectName, path, expanded);
  },
  onAfterRename: () => {
    void loadFolderContent();
  },
  onAfterDelete: () => {
    void loadFolderContent();
  },
});

async function onFileAction(action: string, entry: FsEntry | FsEntry[]) {
  if (Array.isArray(entry)) {
    if (action === 'delete') {
      onFileActionBase('delete', entry);
      return;
    }
    if (action === 'createProxy') {
      onFileActionBase('createProxy', entry);
      return;
    }
    if (action === 'cancelProxy') {
      onFileActionBase('cancelProxy', entry);
      return;
    }
    if (action === 'deleteProxy') {
      onFileActionBase('deleteProxy', entry);
      return;
    }
    if (action === 'extractAudio') {
      for (const e of entry) {
        if (e.kind === 'file') {
          void extractAudio(e);
        }
      }
      return;
    }
    return;
  }

  if (action === 'createProxyForFolder') {
    if (entry.kind === 'directory' && entry.path !== undefined) {
      const dirHandle = await projectStore.getDirectoryHandleByPath(entry.path);
      if (!dirHandle) return;
      void proxyStore.generateProxiesForFolder({
        dirHandle,
        dirPath: entry.path,
      });
    }
  } else if (action === 'cancelProxyForFolder') {
    if (entry.kind === 'directory' && entry.path !== undefined) {
      const generatingProxies = proxyStore.generatingProxies;
      for (const p of generatingProxies) {
        if (p.startsWith(`${entry.path}/`)) {
          const rel = p.slice(entry.path.length + 1);
          if (!rel.includes('/')) {
            void proxyStore.cancelProxyGeneration(p);
          }
        }
      }
    }
  } else if (action === 'openAsPanelCut' || action === 'openAsPanelSound') {
    if (entry.kind !== 'file') return;
    if (!isOpenableProjectFileName(entry.name)) return;

    if (action === 'openAsPanelCut') {
      projectStore.goToCut();
    } else {
      projectStore.goToSound();
    }

    const type = getMediaTypeFromFilename(entry.name);
    if (type === 'text') {
      void (async () => {
        try {
          const file = await vfs.readFile(entry.path);
          const content = await file.text();
          projectStore.addTextPanel(
            entry.path,
            content,
            entry.name,
            undefined,
            undefined,
            action === 'openAsPanelCut' ? 'cut' : 'sound',
          );
        } catch {
          projectStore.addTextPanel(
            entry.path,
            '',
            entry.name,
            undefined,
            undefined,
            action === 'openAsPanelCut' ? 'cut' : 'sound',
          );
        }
      })();
    } else if (type === 'video' || type === 'audio' || type === 'image') {
      projectStore.addMediaPanel(
        entry,
        type,
        entry.name,
        undefined,
        undefined,
        action === 'openAsPanelCut' ? 'cut' : 'sound',
      );
    }
  } else if (action === 'openAsProjectTab') {
    if (entry.kind !== 'file' || !entry.path) return;
    if (!isOpenableProjectFileName(entry.name)) return;
    const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
    setActiveTab(tabId);
  } else if (action === 'createFolder') {
    const existingNames = folderEntries.value.map((e) => e.name);
    await onFileActionBase('createFolder', entry, () => existingNames);
    await loadFolderContent();
  } else if (action === 'createTimeline') {
    if (entry.kind === 'directory') {
      uiStore.pendingFsEntryCreateTimeline = entry;
    }
  } else if (action === 'createMarkdown') {
    if (entry.kind === 'directory') {
      uiStore.pendingFsEntryCreateMarkdown = entry;
    }
  } else if (action === 'convertFile') {
    if (entry.kind === 'file') {
      fileConversion.openConversionModal(entry);
    }
  } else if (action === 'uploadRemote') {
    if (entry.kind === 'file' && entry.source !== 'remote') {
      uiStore.remoteExchangeLocalEntry = entry;
      uiStore.remoteExchangeModalOpen = true;
    }
  } else if (action === 'transcribe') {
    openTranscriptionModal(entry);
  } else if (action === 'delete') {
    onFileActionBase('delete', entry);
  } else if (action === 'rename') {
    onFileActionBase('rename', entry);
  } else if (action === 'createProxy') {
    onFileActionBase('createProxy', entry);
  } else if (action === 'cancelProxy') {
    onFileActionBase('cancelProxy', entry);
  } else if (action === 'deleteProxy') {
    onFileActionBase('deleteProxy', entry);
  } else if (action === 'upload') {
    onFileActionBase('upload', entry);
  } else if (action === 'extractAudio') {
    if (entry.kind === 'file') {
      void extractAudio(entry);
    }
  }
}

async function refreshFileTree() {
  if (isRemoteMode.value) {
    await loadFolderContent();
    return;
  }
  folderSizes.value = {};
  await loadProjectDirectory({ fullRefresh: true } as any);
}

function buildRemoteDirectoryEntry(path: string): RemoteFsEntry {
  const normalizedPath = path || '/';
  const name =
    normalizedPath === '/'
      ? 'Remote'
      : normalizedPath.split('/').filter(Boolean).at(-1) || 'Remote';
  const remoteData: RemoteVfsEntry = {
    id: normalizedPath,
    name,
    path: normalizedPath,
    type: 'directory',
  };

  return {
    name,
    kind: 'directory',
    path: normalizedPath,
    source: 'remote',
    remoteId: normalizedPath,
    remotePath: normalizedPath,
    remoteType: 'directory',
    remoteData,
    mimeType: 'folder',
    size: 0,
  };
}

function setSelectedFsEntry(entry: FsEntry | null) {
  if (!entry) {
    uiStore.selectedFsEntry = null;
    selectionStore.clearSelection();
    return;
  }

  uiStore.selectedFsEntry = {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    parentPath: entry.parentPath,
    lastModified: entry.lastModified,
    size: entry.size,
    source: entry.source ?? 'local',
    remoteId: entry.remoteId,
    remotePath: entry.remotePath,
    remoteData: entry.remoteData,
  };
  selectionStore.selectFsEntry(entry);
}

function openRemoteExchangeModal() {
  uiStore.remoteExchangeModalOpen = true;
}

async function toggleRemoteMode() {
  if (!isRemoteAvailable.value) return;

  if (!isRemoteMode.value) {
    lastLocalFolder.value = filesPageStore.selectedFolder;
    isRemoteMode.value = true;
    remoteCurrentFolder.value = buildRemoteDirectoryEntry('/');
    await loadFolderContent();
    await loadParentFolders();
    setSelectedFsEntry(remoteCurrentFolder.value);
    return;
  }

  isRemoteMode.value = false;
  remoteCurrentFolder.value = null;
  await loadParentFolders();
  if (lastLocalFolder.value) {
    filesPageStore.selectFolder(lastLocalFolder.value);
  } else {
    await navigateToRoot();
  }
}

function onBrowserEntryDragStart(e: DragEvent, entry: FsEntry) {
  if (isRemoteMode.value && isRemoteFsEntry(entry)) {
    if (entry.kind !== 'file' || !e.dataTransfer) return;

    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(REMOTE_FILE_DRAG_TYPE, JSON.stringify(entry));
    e.dataTransfer.setData(INTERNAL_DRAG_TYPE, '1');

    const data: DraggedFileData = {
      name: entry.name,
      kind: 'file',
      path: entry.remotePath,
    };
    useDraggedFile().setDraggedFile(data);
    e.dataTransfer.setData('application/json', JSON.stringify(data));
    return;
  }

  onEntryDragStart(e, entry);
}

function onBrowserEntryDragEnd() {
  useDraggedFile().clearDraggedFile();
  onEntryDragEnd();
}

function onBrowserEntryDragOver(e: DragEvent, entry: FsEntry) {
  if (isRemoteMode.value) return;
  onEntryDragOver(e, entry);
}

function onBrowserEntryDragLeave(e: DragEvent, entry: FsEntry) {
  if (isRemoteMode.value) return;
  onEntryDragLeave(e, entry);
}

async function onBrowserEntryDrop(e: DragEvent, entry: FsEntry) {
  if (isRemoteMode.value) return;
  await onEntryDrop(e, entry);
}

function onBrowserRootDragOver(e: DragEvent) {
  if (isRemoteMode.value) return;
  onRootDragOver(e);
}

function onBrowserRootDragLeave(e: DragEvent) {
  if (isRemoteMode.value) return;
  onRootDragLeave(e);
}

async function onBrowserRootDrop(e: DragEvent) {
  if (isRemoteMode.value) return;
  await onRootDrop(e);
}

async function performRemoteDownload(params: { entry: RemoteFsEntry; targetDirPath: string }) {
  const config = remoteFilesConfig.value;
  if (!config) return;
  if (params.entry.kind !== 'file') return;

  const remoteFile = params.entry.remoteData as RemoteVfsFileEntry;
  const downloadUrl = getRemoteFileDownloadUrl({
    baseUrl: config.baseUrl,
    entry: remoteFile,
  });

  if (!downloadUrl) {
    throw new Error('Remote file download URL is missing');
  }

  const controller = new AbortController();
  remoteTransferAbortController.value = controller;
  remoteTransferFileName.value = params.entry.name;
  remoteTransferProgress.value = 0;
  remoteTransferPhase.value = t('videoEditor.fileManager.actions.downloadFiles', 'Download files');
  remoteTransferOpen.value = true;

  try {
    const blob = await downloadRemoteFile({
      url: downloadUrl,
      signal: controller.signal,
      onProgress: (progress) => {
        remoteTransferProgress.value = progress;
      },
    });

    const file = new File([blob], params.entry.name, {
      type: blob.type || params.entry.mimeType || 'application/octet-stream',
    });

    remoteTransferPhase.value = t('videoEditor.fileManager.actions.uploadFiles', 'Upload files');
    await handleFiles([file], params.targetDirPath);
    uiStore.notifyFileManagerUpdate();
    await loadFolderContent();
  } finally {
    remoteTransferAbortController.value = null;
    remoteTransferOpen.value = false;
    remoteTransferProgress.value = 0;
    remoteTransferPhase.value = '';
    remoteTransferFileName.value = '';
  }
}

function cancelRemoteTransfer() {
  remoteTransferAbortController.value?.abort();
}

async function createTimelineInDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  const existingInFolder = await readDirectory(entry.path);
  const existingNames = existingInFolder.map((e) => e.name);

  const createdPath = await createTimelineCommand({
    vfs,
    timelinesDirName: entry.path || undefined,
    existingNames,
  });

  await reloadDirectory(entry.path || '');
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();

  const createdEntry = findEntryByPath(createdPath);
  if (createdEntry) {
    selectionStore.selectFsEntry(createdEntry);
  }
}

async function createMarkdownInDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  if (entry.path) {
    const projectName = projectStore.currentProjectName;
    if (projectName) {
      uiStore.setFileTreePathExpanded(projectName, entry.path, true);
    }
  }

  const existingInFolder = await readDirectory(entry.path);
  const existingNames = existingInFolder.map((e) => e.name);

  const createdFileName = await createMarkdownCommand({
    vfs,
    dirPath: entry.path,
    existingNames,
  });

  await reloadDirectory(entry.path || '');
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();

  const createdPath = entry.path ? `${entry.path}/${createdFileName}` : createdFileName;
  const createdEntry = findEntryByPath(createdPath);
  if (createdEntry) {
    selectionStore.selectFsEntry(createdEntry);
  }
}

watch(
  () => uiStore.pendingFsEntryRename,
  (value) => {
    const entry = value as FsEntry | null;
    if (!entry) return;
    const inCurrentFolder = folderEntries.value.some((e) => e.path === entry.path);
    if (inCurrentFolder) {
      startRename(entry);
      uiStore.pendingFsEntryRename = null;
    }
  },
);

watch(
  () => uiStore.pendingFsEntryCreateTimeline,
  async (value) => {
    const entry = value as FsEntry | null;
    if (!entry || entry.kind !== 'directory') return;
    try {
      await createTimelineInDirectory(entry);
    } finally {
      uiStore.pendingFsEntryCreateTimeline = null;
    }
  },
);

watch(
  () => uiStore.pendingFsEntryCreateMarkdown,
  async (value) => {
    const entry = value as FsEntry | null;
    if (!entry || entry.kind !== 'directory') return;
    try {
      await createMarkdownInDirectory(entry);
    } finally {
      uiStore.pendingFsEntryCreateMarkdown = null;
    }
  },
);

function isGeneratingProxyInDirectory(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  const dirPath = entry.path;
  for (const p of proxyStore.generatingProxies) {
    if (!dirPath) {
      if (!p.includes('/')) return true;
    } else {
      if (p.startsWith(`${dirPath}/`)) {
        const rel = p.slice(dirPath.length + 1);
        if (!rel.includes('/')) return true;
      }
    }
  }
  return false;
}

function folderHasVideos(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  const children = Array.isArray(entry.children) ? entry.children : [];
  return children.some((child) => {
    if (child.kind !== 'file') return false;
    const ext = child.name.split('.').pop()?.toLowerCase() ?? '';
    return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
  });
}

function isVideo(entry: FsEntry): boolean {
  if (entry.kind !== 'file') return false;
  return getMediaTypeFromFilename(entry.name) === 'video';
}

function isTranscribableMediaFile(entry: FsEntry): boolean {
  if (entry.kind !== 'file' || entry.source === 'remote') return false;

  const type = getMediaTypeFromFilename(entry.name);

  return (
    (type === 'audio' || type === 'video') &&
    Boolean(sttConfig.value) &&
    Boolean(workspaceStore.workspaceHandle) &&
    Boolean(projectStore.currentProjectId) &&
    Boolean(entry.path)
  );
}

const sttTranscriptionModalOpen = ref(false);
const sttTranscriptionLanguage = ref('');
const sttTranscriptionError = ref('');
const sttTranscribing = ref(false);
const sttTranscriptionEntry = ref<FsEntry | null>(null);

const { getContextMenuItems } = useFileContextMenu(
  {
    isGeneratingProxyInDirectory,
    folderHasVideos,
    isOpenableMediaFile: (entry: FsEntry) => {
      if (entry.kind !== 'file') return false;
      return isOpenableProjectFileName(entry.name);
    },
    isConvertibleMediaFile: (entry: FsEntry) => {
      if (entry.kind !== 'file') return false;
      const type = getMediaTypeFromFilename(entry.name);
      return type === 'video' || type === 'audio' || type === 'image';
    },
    isTranscribableMediaFile,
    isVideo,
    getEntryMeta: (entry: FsEntry) => ({
      hasProxy: entry.path ? fileManager.mediaCache.hasProxy(entry.path) : false,
      generatingProxy: entry.path ? proxyStore.generatingProxies.has(entry.path) : false,
    }),
    isFilesPage: props.isFilesPage,
    getSelectedEntries: () => {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager') {
        if (selected.kind === 'multiple') return selected.entries;
        if ('entry' in selected) return [selected.entry];
      }
      return [];
    },
  },
  (action: ContextMenuFileAction, entry: FsEntry | FsEntry[]) => onFileAction(action, entry),
);

const emptySpaceContextMenuItems = computed(() => {
  if (isRemoteMode.value) return [];

  const selected = selectionStore.selectedEntity;
  if (
    selected?.source === 'fileManager' &&
    selected.kind === 'multiple' &&
    selected.entries.length > 1
  ) {
    const first = selected.entries[0];
    if (!first) return [];
    return getContextMenuItems(first);
  }
  if (!filesPageStore.selectedFolder) return [];
  return getContextMenuItems(filesPageStore.selectedFolder);
});

const GRID_SIZES = [80, 100, 130, 160, 200];
const GRID_SIZE_NAMES = ['xs', 's', 'm', 'l', 'xl'];

const currentGridSizeName = computed(() => {
  const index = GRID_SIZES.indexOf(filesPageStore.gridCardSize);
  return GRID_SIZE_NAMES[index] || 'm';
});

const resizingColumn = ref<string | null>(null);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

const folderSizes = ref<Record<string, number>>({});
const folderSizesLoading = ref<Record<string, boolean>>({});

const sizeCalcQueue = new PQueue({ concurrency: 5 });

async function calculateFolderSize(path: string, handle?: FileSystemDirectoryHandle) {
  if (folderSizes.value[path] !== undefined || folderSizesLoading.value[path]) return;

  folderSizesLoading.value[path] = true;
  await sizeCalcQueue.add(async () => {
    try {
      const resolvedHandle = handle ?? (await projectStore.getDirectoryHandleByPath(path));
      if (!resolvedHandle) return;
      let totalSize = 0;

      async function calc(dirHandle: FileSystemDirectoryHandle) {
        // @ts-expect-error Types for FileSystemDirectoryHandle values iterator may be incomplete
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            try {
              const file = await entry.getFile();
              totalSize += file.size;
            } catch {
              // skip
            }
          } else if (entry.kind === 'directory') {
            await calc(entry);
          }
        }
      }

      await calc(resolvedHandle);
      folderSizes.value[path] = totalSize;
    } catch (error) {
      console.error('Failed to calculate folder size:', error);
    } finally {
      folderSizesLoading.value[path] = false;
    }
  });
}

// Calculate size for selected entity (details view)
watch(
  () => uiStore.selectedFsEntry,
  (entry) => {
    if (isRemoteMode.value) {
      if (entry?.kind === 'file' && entry.path) {
        pendingScrollToEntryPath.value = entry.path;
      }
      return;
    }

    if (entry && entry.kind === 'directory' && entry.path) {
      void calculateFolderSize(entry.path);
    }

    if (entry?.kind === 'file' && entry.path) {
      pendingScrollToEntryPath.value = entry.path;
    }
  },
  { immediate: true },
);

// Trigger sizes for directories in list view (one by one)
watch(
  () => [folderEntries.value, filesPageStore.viewMode],
  () => {
    if (isRemoteMode.value) return;

    if (filesPageStore.viewMode === 'list' && folderEntries.value.length > 0) {
      for (const entry of folderEntries.value) {
        if (
          entry.kind === 'directory' &&
          entry.path &&
          folderSizes.value[entry.path] === undefined &&
          !folderSizesLoading.value[entry.path]
        ) {
          void calculateFolderSize(entry.path);
        }
      }
    }
  },
  { immediate: true },
);

async function loadFolderContent() {
  if (isRemoteMode.value) {
    if (!remoteCurrentFolder.value || !remoteFilesConfig.value) {
      folderEntries.value = [];
      return;
    }

    try {
      const response = await fetchRemoteVfsList({
        config: remoteFilesConfig.value,
        path: remoteCurrentFolder.value.remotePath || '/',
      });
      cleanupObjectUrls();
      folderEntries.value = response.items.map((entry) => toRemoteFsEntry(entry));
    } catch (error) {
      console.error('Failed to load remote folder content:', error);
      folderEntries.value = [];
      toast.add({
        color: 'error',
        title: t('common.error', 'Error'),
        description: error instanceof Error ? error.message : 'Failed to load remote folder',
      });
    }
    return;
  }

  if (!filesPageStore.selectedFolder) {
    cleanupObjectUrls();
    folderEntries.value = [];
    return;
  }

  try {
    const path = filesPageStore.selectedFolder.path || '';
    let entries = await readDirectory(path);
    if (!path) {
      const commonMetadata = await vfs.getMetadata(WORKSPACE_COMMON_PATH_PREFIX);
      if (commonMetadata?.kind === 'directory') {
        const commonEntry: FsEntry = {
          kind: 'directory',
          name: WORKSPACE_COMMON_DIR_NAME,
          path: WORKSPACE_COMMON_PATH_PREFIX,
        };
        entries = [
          commonEntry,
          ...entries.filter((entry) => entry.path !== WORKSPACE_COMMON_PATH_PREFIX),
        ];
      }
    }
    // readDirectory already filters hidden files based on deps.showHiddenFiles(),
    // but just to be sure we also filter it here if needed.
    const filteredEntries = entries.filter(
      (e) => uiStore.showHiddenFiles || !e.name.startsWith('.'),
    );
    cleanupObjectUrls();
    folderEntries.value = await supplementEntries(filteredEntries);
  } catch (error) {
    console.error('Failed to load folder content:', error);
    cleanupObjectUrls();
    folderEntries.value = [];
  }
}

function cleanupObjectUrls() {
  for (const entry of folderEntries.value as ExtendedFsEntry[]) {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }
}

onUnmounted(() => {
  cleanupObjectUrls();
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
});

async function loadParentFolders() {
  parentFolders.value = [];

  if (isRemoteMode.value) {
    const currentPath = remoteCurrentFolder.value?.remotePath || '/';
    const parts = currentPath.split('/').filter(Boolean);
    let accum = '';

    for (const part of parts) {
      accum = `${accum}/${part}`;
      parentFolders.value.push(buildRemoteDirectoryEntry(accum));
    }
    return;
  }

  const selectedFolderPath = filesPageStore.selectedFolder?.path;
  if (!selectedFolderPath) return;

  if (selectedFolderPath === WORKSPACE_COMMON_PATH_PREFIX) {
    parentFolders.value.push({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
    });
    return;
  }

  if (selectedFolderPath.startsWith(`${WORKSPACE_COMMON_PATH_PREFIX}/`)) {
    let currentPath = WORKSPACE_COMMON_PATH_PREFIX;
    parentFolders.value.push({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
    });

    const pathParts = stripWorkspaceCommonPathPrefix(selectedFolderPath).split('/').filter(Boolean);
    for (const part of pathParts) {
      currentPath = `${currentPath}/${part}`;
      parentFolders.value.push({
        kind: 'directory',
        name: part,
        path: currentPath,
      });
    }
    return;
  }

  const pathParts = selectedFolderPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const part of pathParts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    parentFolders.value.push({
      kind: 'directory',
      name: part,
      path: currentPath,
    });
  }
}

watch(
  () => uiStore.showHiddenFiles,
  async () => {
    await loadFolderContent();
  },
);

watch(
  () => filesPageStore.selectedFolder,
  async () => {
    if (isRemoteMode.value) return;
    await loadFolderContent();
    await loadParentFolders();

    if (!pendingScrollToEntryPath.value) return;

    const targetPath = pendingScrollToEntryPath.value;
    const selectedFolderPath = filesPageStore.selectedFolder?.path ?? '';
    const targetParentPath = targetPath.split('/').slice(0, -1).join('/');

    if (targetParentPath !== selectedFolderPath) return;

    requestAnimationFrame(() => {
      const container = rootContainer.value;
      if (!container || !pendingScrollToEntryPath.value) return;

      const targetNode = container.querySelector<HTMLElement>(
        `[data-entry-path="${CSS.escape(pendingScrollToEntryPath.value)}"]`,
      );
      if (!targetNode) return;

      targetNode.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
      targetNode.focus();
      pendingScrollToEntryPath.value = null;
    });
  },
  { immediate: true },
);

watch(
  () => uiStore.pendingRemoteDownloadRequest,
  async (request) => {
    if (!request) return;

    try {
      await performRemoteDownload(request);
    } catch (error) {
      if ((error as Error | undefined)?.name !== 'AbortError') {
        toast.add({
          color: 'error',
          title: t('common.error', 'Error'),
          description: error instanceof Error ? error.message : 'Remote download failed',
        });
      }
    } finally {
      uiStore.pendingRemoteDownloadRequest = null;
    }
  },
);

watch(
  () => uiStore.fileManagerUpdateCounter,
  async () => {
    if (skipNextUpdateReload.value) {
      skipNextUpdateReload.value = false;
      return;
    }
    // only reload the current view content, not the whole tree
    await loadFolderContent();

    if (!pendingScrollToEntryPath.value) return;

    requestAnimationFrame(() => {
      const container = rootContainer.value;
      if (!container || !pendingScrollToEntryPath.value) return;

      const targetNode = container.querySelector<HTMLElement>(
        `[data-entry-path="${CSS.escape(pendingScrollToEntryPath.value)}"]`,
      );
      if (!targetNode) return;

      targetNode.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
      targetNode.focus();
      pendingScrollToEntryPath.value = null;
    });
  },
);

interface ExtendedFsEntry extends FsEntry {
  size?: number;
  mimeType?: string;
  created?: number;
  objectUrl?: string;
}

const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];

async function supplementEntries(entries: FsEntry[]): Promise<ExtendedFsEntry[]> {
  const supplements = await Promise.all(
    entries.map(async (entry) => {
      if (entry.kind === 'file') {
        try {
          const file = await vfs.getFile(entry.path);
          if (!file) {
            return { ...entry, size: 0, mimeType: 'unknown' };
          }
          const objectUrl = await createPreviewUrl(entry.name, file);
          return {
            ...entry,
            size: file.size,
            mimeType: getMimeTypeFromFilename(entry.name),
            lastModified: file.lastModified,
            created: file.lastModified,
            objectUrl,
          };
        } catch {
          return { ...entry, size: 0, mimeType: 'unknown' };
        }
      }
      return { ...entry, size: 0, mimeType: 'folder' };
    }),
  );
  return supplements;
}

async function createPreviewUrl(name: string, file: File): Promise<string | undefined> {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext || !SUPPORTED_IMAGE_EXTS.includes(ext)) return undefined;
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
}


const sortedEntries = computed(() => {
  const arr = [...folderEntries.value] as ExtendedFsEntry[];

  // Separate folders and files
  const folders = arr.filter((e) => e.kind === 'directory');
  const files = arr.filter((e) => e.kind === 'file');

  const { field, order } = filesPageStore.sortOption;
  const modifier = order === 'asc' ? 1 : -1;

  const compare = (a: any, b: any) => {
    if (a === b) return 0;
    return a > b ? modifier : -modifier;
  };

  folders.sort((a, b) => compare(a.name.toLowerCase(), b.name.toLowerCase()));

  files.sort((a, b) => {
    switch (field) {
      case 'name':
        return compare(a.name.toLowerCase(), b.name.toLowerCase());
      case 'type':
        return compare(a.mimeType || '', b.mimeType || '');
      case 'size':
        return compare(a.size || 0, b.size || 0);
      case 'modified':
        return compare(a.lastModified || 0, b.lastModified || 0);
      case 'created':
        return compare(a.created || 0, b.created || 0);
      default:
        return 0;
    }
  });

  return [...folders, ...files];
});

const { thumbnails: videoThumbnails } = useFileManagerThumbnails(sortedEntries);

const stats = computed(() => {
  let totalSize = 0;
  let fileCount = 0;

  for (const entry of folderEntries.value as ExtendedFsEntry[]) {
    if (entry.kind === 'file') {
      totalSize += entry.size || 0;
      fileCount++;
    }
  }

  return {
    totalSize: formatBytes(totalSize),
    fileCount,
  };
});

function handleEntryClick(event: MouseEvent, entry: FsEntry) {
  if (isRemoteMode.value) {
    setSelectedFsEntry(entry);
    return;
  }

  const isL1 = isLayer1Active(event, workspaceStore.userSettings);
  const isL2 = isLayer2Active(event, workspaceStore.userSettings);

  if (isL2) {
    // Toggle selection
    const selected = selectionStore.selectedEntity;
    if (selected && selected.source === 'fileManager') {
      let currentEntries: FsEntry[] = [];
      if (selected.kind === 'multiple') {
        currentEntries = [...selected.entries];
      } else if (selected.kind === 'file' || selected.kind === 'directory') {
        currentEntries = [selected.entry];
      }

      const existingIndex = currentEntries.findIndex((e) => e.path === entry.path);
      if (existingIndex >= 0) {
        currentEntries.splice(existingIndex, 1);
        selectionStore.selectFsEntries(currentEntries);
      } else {
        selectionStore.selectFsEntries([...currentEntries, entry]);
      }
    } else {
      selectionStore.selectFsEntry(entry);
    }
  } else if (isL1) {
    // Range selection
    const selected = selectionStore.selectedEntity;
    if (selected && selected.source === 'fileManager') {
      const visibleEntries = sortedEntries.value;
      const targetIndex = visibleEntries.findIndex((e) => e.path === entry.path);

      let lastSelectedIndex = -1;
      if (selected.kind === 'multiple' && selected.entries.length > 0) {
        const lastSelected = selected.entries[selected.entries.length - 1];
        lastSelectedIndex = visibleEntries.findIndex((e) => e.path === lastSelected?.path);
      } else if ('path' in selected) {
        lastSelectedIndex = visibleEntries.findIndex((e) => e.path === selected.path);
      }

      if (lastSelectedIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(lastSelectedIndex, targetIndex);
        const end = Math.max(lastSelectedIndex, targetIndex);
        const range = visibleEntries.slice(start, end + 1);
        selectionStore.selectFsEntries(range);
      } else {
        selectionStore.selectFsEntry(entry);
      }
    } else {
      selectionStore.selectFsEntry(entry);
    }
  } else {
    // Normal single selection
    filesPageStore.selectFile(entry);
  }
}

function handleEntryDoubleClick(entry: FsEntry) {
  if (isRemoteMode.value) {
    if (entry.kind === 'directory' && isRemoteFsEntry(entry)) {
      remoteCurrentFolder.value = entry;
      void loadFolderContent();
      void loadParentFolders();
      setSelectedFsEntry(entry);
    }
    return;
  }

  if (entry.kind === 'directory') {
    filesPageStore.openFolder(entry);
  } else {
    if (entry.name.toLowerCase().endsWith('.otio')) {
      const entryPath = entry.path;
      if (!entryPath) return;
      void (async () => {
        await projectStore.openTimelineFile(entryPath);
        await timelineStore.loadTimeline();
        void timelineStore.loadTimelineMetadata();
      })();
    } else {
      if (!isOpenableProjectFileName(entry.name)) return;
      onFileAction('openAsProjectTab', entry);
    }
  }
}

function handleEntryEnter(entry: FsEntry) {
  if (!isRemoteMode.value) {
    filesPageStore.selectFile(entry);
  } else {
    setSelectedFsEntry(entry);
  }
  handleEntryDoubleClick(entry);
}

function handleSort(field: FileSortField) {
  if (filesPageStore.sortOption.field === field) {
    filesPageStore.sortOption = {
      field,
      order: filesPageStore.sortOption.order === 'asc' ? 'desc' : 'asc',
    };
  } else {
    filesPageStore.sortOption = { field, order: 'asc' };
  }
}

function navigateToFolder(index: number) {
  const targetFolder = parentFolders.value[index];
  if (targetFolder) {
    if (isRemoteMode.value && isRemoteFsEntry(targetFolder)) {
      remoteCurrentFolder.value = targetFolder;
      void loadFolderContent();
      void loadParentFolders();
      setSelectedFsEntry(targetFolder);
      return;
    }

    filesPageStore.selectFolder(targetFolder);
  }
}

function navigateBack() {
  if (parentFolders.value.length > 1) {
    const parentIndex = parentFolders.value.length - 2;
    if (isRemoteMode.value && isRemoteFsEntry(parentFolders.value[parentIndex])) {
      const target = parentFolders.value[parentIndex] as RemoteFsEntry;
      remoteCurrentFolder.value = target;
      void loadFolderContent();
      void loadParentFolders();
      setSelectedFsEntry(target);
      return;
    }

    filesPageStore.selectFolder(parentFolders.value[parentIndex] as FsEntry);
  } else {
    void navigateToRoot();
  }
}

function navigateUp() {
  if (parentFolders.value.length > 1) {
    const parentIndex = parentFolders.value.length - 2;
    if (isRemoteMode.value && isRemoteFsEntry(parentFolders.value[parentIndex])) {
      const target = parentFolders.value[parentIndex] as RemoteFsEntry;
      remoteCurrentFolder.value = target;
      void loadFolderContent();
      void loadParentFolders();
      setSelectedFsEntry(target);
      return;
    }

    filesPageStore.selectFolder(parentFolders.value[parentIndex] as FsEntry);
  } else if (parentFolders.value.length === 1) {
    void navigateToRoot();
  }
}

async function navigateToRoot() {
  if (isRemoteMode.value) {
    remoteCurrentFolder.value = buildRemoteDirectoryEntry('/');
    await loadFolderContent();
    await loadParentFolders();
    setSelectedFsEntry(remoteCurrentFolder.value);
    return;
  }

  const rootEntry: FsEntry = {
    kind: 'directory',
    name: projectStore.currentProjectName || '',
    path: '',
  };
  filesPageStore.selectFolder(rootEntry);
}

function onResizeStart(e: MouseEvent, column: string) {
  resizingColumn.value = column;
  resizeStartX.value = e.clientX;
  resizeStartWidth.value = filesPageStore.columnWidths[column] || 100;
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e: MouseEvent) {
  if (!resizingColumn.value) return;
  const diff = e.clientX - resizeStartX.value;
  const newWidth = Math.max(60, resizeStartWidth.value + diff);
  filesPageStore.setColumnWidth(resizingColumn.value, newWidth);
}

function onResizeEnd() {
  resizingColumn.value = null;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
}

// --- Drag-and-drop within the browser panel ---
// Logic moved to useFileBrowserDragAndDrop

async function onDirectoryUploadChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';

  const entry = directoryUploadTarget.value;
  if (!entry || entry.kind !== 'directory') return;
  if (files.length === 0) return;

  if (!entry.path) {
    await handleFiles(files);
  } else {
    await handleFiles(files, entry.path);
  }
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();
}

// Panel drop handled by useFileBrowserDragAndDrop

function openTranscriptionModal(entry: FsEntry) {
  sttTranscriptionLanguage.value = '';
  sttTranscriptionError.value = '';
  sttTranscriptionModalOpen.value = true;
  sttTranscriptionEntry.value = entry;
}

async function submitTranscription() {
  const entry = sttTranscriptionEntry.value;

  if (
    !entry ||
    entry.kind !== 'file' ||
    !workspaceStore.workspaceHandle ||
    !projectStore.currentProjectId
  ) {
    return;
  }

  sttTranscribing.value = true;
  sttTranscriptionError.value = '';

  try {
    const mediaType = getMediaTypeFromFilename(entry.name);
    const entryMimeType = (entry as ExtendedFsEntry).mimeType;
    const file = await projectStore.getFileByPath(entry.path);
    if (!file) throw new Error('Failed to access file');
    const result = await transcribeProjectAudioFile({
      file,
      filePath: entry.path,
      fileName: entry.name,
      fileType: typeof entryMimeType === 'string' ? entryMimeType : '',
      language: sttTranscriptionLanguage.value,
      granPublicadorBaseUrl:
        typeof runtimeConfig.public.gpanPublicadorBaseUrl === 'string'
          ? runtimeConfig.public.gpanPublicadorBaseUrl
          : '',
      projectId: projectStore.currentProjectId,
      userSettings: workspaceStore.userSettings,
      workspaceHandle: workspaceStore.workspaceHandle,
    });

    sttTranscriptionModalOpen.value = false;

    toast.add({
      title: result.cached ? 'Transcription loaded from cache' : 'Transcription completed',
      description: result.cached
        ? 'Cached transcription was loaded from vardata.'
        : mediaType === 'video'
          ? 'Video audio track was transcribed and saved to vardata cache.'
          : 'Transcription was saved to vardata cache.',
      color: 'success',
    });
  } catch (error: unknown) {
    sttTranscriptionError.value =
      error instanceof Error ? error.message : 'Failed to transcribe media';
  } finally {
    sttTranscribing.value = false;
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg relative overflow-hidden transition-colors duration-150"
    :class="{
      'bg-primary-500/5 outline-2 outline-primary-500/30 -outline-offset-2': isDragOverPanel,
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
        focusStore.isPanelFocused('filesBrowser'),
    }"
    @pointerdown.capture="focusBrowserPanel"
    @dragover.prevent="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop.prevent="onPanelDrop"
  >
    <!-- Navigation bar -->
    <FileBrowserBreadcrumbs
      v-if="
        (isRemoteMode && parentFolders.length > 0) ||
        (!isRemoteMode &&
          filesPageStore.selectedFolder &&
          filesPageStore.selectedFolder.path !== '')
      "
      :parent-folders="parentFolders"
      @navigate-back="navigateBack"
      @navigate-up="navigateUp"
      @navigate-to-folder="navigateToFolder"
    />

    <!-- Toolbar -->
    <FileBrowserToolbar
      :grid-sizes="GRID_SIZES"
      :current-grid-size-name="currentGridSizeName"
      :remote-available="isRemoteAvailable"
      @refresh="refreshFileTree"
      @open-remote="openRemoteExchangeModal"
    />

    <!-- Main Content -->
    <div
      ref="rootContainer"
      class="flex-1 overflow-auto p-4 content-scrollbar relative"
      tabindex="0"
      @click.self="handleContainerClick"
      @keydown="onContainerKeyDown"
      @pointerdown.capture="onMarqueePointerDown"
      @pointermove="onMarqueePointerMove"
      @pointerup="onMarqueePointerUp"
      @pointercancel="onMarqueePointerUp"
    >
      <div
        v-if="marqueeStyle"
        class="absolute border border-primary-400 bg-primary-400/15 rounded-sm pointer-events-none"
        :style="marqueeStyle"
      />
      <UContextMenu :items="emptySpaceContextMenuItems" class="min-h-full">
        <div class="min-h-full flex flex-col">
          <div
            v-if="!isRemoteMode && !filesPageStore.selectedFolder"
            class="flex flex-col items-center justify-center flex-1 text-ui-text-muted gap-2"
          >
            <UIcon name="i-heroicons-folder-open" class="w-12 h-12 opacity-20" />
            <span>{{
              t(
                'videoEditor.fileManager.selectFolderHint',
                'Select a folder in the sidebar to view its contents',
              )
            }}</span>
          </div>

          <div
            v-else-if="folderEntries.length === 0"
            class="flex flex-col items-center justify-center flex-1 text-ui-text-muted gap-2"
          >
            <UIcon name="i-heroicons-inbox" class="w-12 h-12 opacity-20" />
            <span>
              {{
                isRemoteMode
                  ? t('common.empty', 'Folder is empty')
                  : t('common.empty', 'Folder is empty')
              }}
            </span>
          </div>

          <!-- Grid View -->
          <FileBrowserViewGrid
            v-else-if="filesPageStore.viewMode === 'grid'"
            :entries="sortedEntries as ExtendedFsEntry[]"
            :is-root-drop-over="isRootDropOver"
            :drag-over-entry-path="dragOverEntryPath"
            :current-grid-size-name="currentGridSizeName"
            :editing-entry-path="editingEntryPath"
            :folder-entries-names="folderEntries.map((e) => e.name)"
            :get-context-menu-items="getContextMenuItems"
            :is-generating-proxy-in-directory="isGeneratingProxyInDirectory"
            :video-thumbnails="videoThumbnails"
            @root-drag-over="onBrowserRootDragOver"
            @root-drag-leave="onBrowserRootDragLeave"
            @root-drop="onBrowserRootDrop"
            @entry-drag-start="onBrowserEntryDragStart"
            @entry-drag-end="onBrowserEntryDragEnd"
            @entry-drag-over="onBrowserEntryDragOver"
            @entry-drag-leave="onBrowserEntryDragLeave"
            @entry-drop="onBrowserEntryDrop"
            @entry-click="handleEntryClick"
            @entry-double-click="handleEntryDoubleClick"
            @entry-enter="handleEntryEnter"
            @commit-rename="commitRename"
            @stop-rename="stopRename"
            @file-action="onFileAction"
          />

          <!-- List View -->
          <FileBrowserViewList
            v-else
            :entries="sortedEntries as ExtendedFsEntry[]"
            :is-root-drop-over="isRootDropOver"
            :drag-over-entry-path="dragOverEntryPath"
            :folder-sizes-loading="folderSizesLoading"
            :folder-sizes="folderSizes"
            :editing-entry-path="editingEntryPath"
            :folder-entries-names="folderEntries.map((e) => e.name)"
            :get-context-menu-items="getContextMenuItems"
            :is-generating-proxy-in-directory="isGeneratingProxyInDirectory"
            :video-thumbnails="videoThumbnails"
            @root-drag-over="onBrowserRootDragOver"
            @root-drag-leave="onBrowserRootDragLeave"
            @root-drop="onBrowserRootDrop"
            @entry-drag-start="onBrowserEntryDragStart"
            @entry-drag-end="onBrowserEntryDragEnd"
            @entry-drag-over="onBrowserEntryDragOver"
            @entry-drag-leave="onBrowserEntryDragLeave"
            @entry-drop="onBrowserEntryDrop"
            @entry-click="handleEntryClick"
            @entry-double-click="handleEntryDoubleClick"
            @entry-enter="handleEntryEnter"
            @commit-rename="commitRename"
            @stop-rename="stopRename"
            @file-action="onFileAction"
            @sort="handleSort"
            @resize-start="onResizeStart"
          />
        </div>
      </UContextMenu>
    </div>

    <!-- Bottom Panel -->
    <FileBrowserStatusBar :stats="stats" />

    <!-- Modals -->
    <UiConfirmModal
      v-model:open="isDeleteConfirmModalOpen"
      :title="t('common.delete', 'Delete')"
      :description="
        t(
          'common.confirmDelete',
          'Are you sure you want to delete this? This action cannot be undone.',
        )
      "
      color="error"
      icon="i-heroicons-exclamation-triangle"
      @confirm="handleDeleteConfirm"
    >
      <div>
        <div v-if="deleteTargets.length === 1" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTargets[0]?.name }}
        </div>
        <div v-else-if="deleteTargets.length > 1" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTargets.length }} {{ t('common.itemsSelected', 'items selected') }}
        </div>
        <div
          v-if="deleteTargets.length === 1 && deleteTargets[0]?.path"
          class="mt-1 text-xs text-ui-text-muted break-all"
        >
          {{
            deleteTargets[0].kind === 'directory'
              ? t('common.folder', 'Folder')
              : t('common.file', 'File')
          }}:
          {{ deleteTargets[0].path }}
        </div>
      </div>
    </UiConfirmModal>

    <input
      ref="directoryUploadInput"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryUploadChange"
    />

    <RemoteTransferProgressModal
      v-model:open="remoteTransferOpen"
      :title="t('videoEditor.fileManager.actions.downloadFiles', 'Download files')"
      :description="t('videoEditor.fileManager.actions.downloadFiles', 'Download files')"
      :progress="remoteTransferProgress"
      :phase="remoteTransferPhase"
      :file-name="remoteTransferFileName"
      @cancel="cancelRemoteTransfer"
    />

    <AppModal
      v-model:open="sttTranscriptionModalOpen"
      :title="t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
      :close-button="!sttTranscribing"
      :prevent-close="sttTranscribing"
      :ui="{ content: 'sm:max-w-lg', body: 'overflow-y-auto' }"
    >
      <div class="flex flex-col gap-4">
        <div class="text-sm text-ui-text-muted">
          {{
            t(
              'videoEditor.fileManager.audio.transcriptionHint',
              'Send the current audio file to the configured STT service. Language is optional.',
            )
          }}
        </div>

        <div v-if="sttTranscriptionEntry" class="text-xs text-ui-text-muted break-all">
          {{ sttTranscriptionEntry.name }}
        </div>

        <UFormField :label="t('videoEditor.fileManager.audio.transcriptionLanguage', 'Language')">
          <UInput v-model="sttTranscriptionLanguage" :disabled="sttTranscribing" placeholder="en" />
        </UFormField>

        <div v-if="sttTranscriptionError" class="text-sm text-error-400">
          {{ sttTranscriptionError }}
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="sttTranscribing"
            @click="sttTranscriptionModalOpen = false"
          >
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
          <UButton color="primary" :loading="sttTranscribing" @click="submitTranscription">
            {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
          </UButton>
        </div>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.content-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.content-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.content-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(var(--color-neutral-500), 0.1);
  border-radius: 3px;
}

.content-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--color-neutral-500), 0.2);
}
</style>
