import type { Ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectTabsStore } from '~/stores/tabs.store';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import type { FileAction as ContextMenuFileAction } from '~/composables/file-manager/useFileContextMenu';
import type { FileAction as FmFileAction } from '~/composables/file-manager/useFileManagerActions';

export function useFileBrowserFileActions({
  folderEntries,
  loadFolderContent,
  onFileActionBase,
  conversionStore,
  openTranscriptionModal,
  vfs,
}: {
  folderEntries: Ref<FsEntry[]>;
  loadFolderContent: () => Promise<void>;
  onFileActionBase: (
    action: FmFileAction,
    entry: FsEntry | FsEntry[],
    getExistingNames?: () => string[],
  ) => Promise<void>;
  conversionStore: { openConversionModal: (entry: FsEntry) => void };
  openTranscriptionModal: (entry: FsEntry) => void;
  vfs: IFileSystemAdapter;
}) {
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const proxyStore = useProxyStore();
  const { addFileTab, setActiveTab } = useProjectTabsStore();
  const { extractAudio } = useAudioExtraction();

  function handleBatchAction(action: string, entries: FsEntry[]): boolean {
    const delegated: FmFileAction[] = [
      'delete',
      'createProxy',
      'cancelProxy',
      'deleteProxy',
      'copy',
      'cut',
    ];
    if (delegated.includes(action as FmFileAction)) {
      void onFileActionBase(action as FmFileAction, entries);
      return true;
    }
    if (action === 'extractAudio') {
      for (const e of entries) {
        if (e.kind === 'file') void extractAudio(e);
      }
      return true;
    }
    return false;
  }

  async function handleSingleFileAction(action: string, entry: FsEntry): Promise<void> {
    if (action === 'createProxyForFolder') {
      if (entry.kind !== 'directory' || entry.path === undefined) return;
      const dirHandle = await projectStore.getDirectoryHandleByPath(entry.path);
      if (!dirHandle) return;
      void proxyStore.generateProxiesForFolder({ dirHandle, dirPath: entry.path });
      return;
    }

    if (action === 'cancelProxyForFolder') {
      if (entry.kind !== 'directory' || entry.path === undefined) return;
      for (const p of proxyStore.generatingProxies) {
        if (p.startsWith(`${entry.path}/`)) {
          const rel = p.slice(entry.path.length + 1);
          if (!rel.includes('/')) void proxyStore.cancelProxyGeneration(p);
        }
      }
      return;
    }

    if (action === 'openAsPanelCut' || action === 'openAsPanelSound') {
      if (entry.kind !== 'file' || !isOpenableProjectFileName(entry.name)) return;
      const panelTarget = action === 'openAsPanelCut' ? 'cut' : 'sound';
      if (action === 'openAsPanelCut') projectStore.goToCut();
      else projectStore.goToSound();

      const type = getMediaTypeFromFilename(entry.name);
      if (type === 'text') {
        projectStore.addTextPanel(entry.path || '', entry.name, undefined, undefined, panelTarget);
      } else if (type === 'video' || type === 'audio' || type === 'image') {
        projectStore.addMediaPanel(entry, type, entry.name, undefined, undefined, panelTarget);
      }
      return;
    }

    if (action === 'openAsProjectTab') {
      if (entry.kind !== 'file' || !entry.path || !isOpenableProjectFileName(entry.name)) return;
      const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
      setActiveTab(tabId);
      return;
    }

    if (action === 'createFolder') {
      const existingNames = folderEntries.value.map((e) => e.name);
      await onFileActionBase('createFolder', entry, () => existingNames);
      await loadFolderContent();
      return;
    }

    if (action === 'createTimeline') {
      if (entry.kind === 'directory') uiStore.pendingFsEntryCreateTimeline = entry;
      return;
    }

    if (action === 'createMarkdown') {
      if (entry.kind === 'directory') uiStore.pendingFsEntryCreateMarkdown = entry;
      return;
    }

    if (action === 'convertFile') {
      if (entry.kind === 'file') conversionStore.openConversionModal(entry);
      return;
    }

    if (action === 'uploadRemote') {
      if (entry.kind === 'file' && entry.source !== 'remote') {
        uiStore.remoteExchangeLocalEntry = entry;
        uiStore.remoteExchangeModalOpen = true;
      }
      return;
    }

    if (action === 'transcribe') {
      openTranscriptionModal(entry);
      return;
    }

    if (action === 'extractAudio') {
      if (entry.kind === 'file') void extractAudio(entry);
      return;
    }

    if (action === 'paste') {
      void onFileActionBase('paste', entry);
      return;
    }

    const delegated: FmFileAction[] = [
      'delete',
      'rename',
      'createProxy',
      'cancelProxy',
      'deleteProxy',
      'upload',
      'copy',
      'cut',
    ];
    if (delegated.includes(action as FmFileAction)) {
      void onFileActionBase(action as FmFileAction, entry);
    }
  }

  async function onFileAction(
    action: ContextMenuFileAction | string,
    entry: FsEntry | FsEntry[],
  ): Promise<void> {
    if (Array.isArray(entry)) {
      handleBatchAction(action, entry);
      return;
    }
    await handleSingleFileAction(action, entry);
  }

  return { onFileAction };
}
