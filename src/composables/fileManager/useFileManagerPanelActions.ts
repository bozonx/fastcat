import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useUiStore } from '~/stores/ui.store';
import { createTimelineCommand } from '~/file-manager/application/fileManagerCommands';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import type { FileAction as FileActionBase } from '~/composables/fileManager/useFileManagerActions';

export interface FileManagerPanelActionsOptions {
  vfs: {
    readFile: (path: string) => Promise<Blob>;
  };
  loadProjectDirectory: (opts?: any) => Promise<void>;
  findEntryByPath: (path: string) => FsEntry | null;
  onFileActionBase: (
    action: FileActionBase,
    entry: FsEntry | FsEntry[],
    getExistingNames?: () => string[],
  ) => void | Promise<void>;
  openConversionModal: (entry: FsEntry) => void;
  openTranscriptionModal: (entry: FsEntry) => void;
  extractAudio: (entry: FsEntry) => Promise<void>;
  addFileTab: (opts: { filePath: string; fileName: string }) => string;
  setActiveTab: (id: string) => void;
  onSelect: (entry: FsEntry) => void;
}

export type PanelFileAction =
  | FileActionBase
  | 'refresh'
  | 'createMarkdown'
  | 'createTimeline'
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab'
  | 'uploadRemote'
  | 'transcribe'
  | 'extractAudio';

export function useFileManagerPanelActions({
  vfs,
  loadProjectDirectory,
  findEntryByPath,
  onFileActionBase,
  openConversionModal,
  openTranscriptionModal,
  extractAudio,
  addFileTab,
  setActiveTab,
  onSelect,
}: FileManagerPanelActionsOptions) {
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();
  const proxyStore = useProxyStore();
  const uiStore = useUiStore();

  async function createTimelineInDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    const toast = useToast();
    try {
      const createdPath = await createTimelineCommand({
        vfs: vfs as any,
        timelinesDirName: entry.path || undefined,
      });

      await loadProjectDirectory();

      const createdEntry = createdPath ? findEntryByPath(createdPath) : null;
      if (createdEntry) {
        uiStore.selectedFsEntry = {
          kind: createdEntry.kind,
          name: createdEntry.name,
          path: createdEntry.path,
        };
        selectionStore.selectFsEntry(createdEntry);
        onSelect(createdEntry);
      }

      if (createdPath) {
        await projectStore.openTimelineFile(createdPath);
        await timelineStore.loadTimeline();
        void timelineStore.loadTimelineMetadata();
      }
    } catch (e: unknown) {
      console.error('[FileManagerPanel] Failed to create timeline', e);
      toast.add({
        color: 'red',
        title: 'Timeline error',
        description: e instanceof Error ? e.message : 'Failed to create timeline',
      });
    }
  }

  async function handleFileAction(action: string, entry: FsEntry | FsEntry[]) {
    if (Array.isArray(entry)) {
      if (action === 'delete') {
        onFileActionBase('delete', entry);
        return;
      }
      if (['createProxy', 'cancelProxy', 'deleteProxy'].includes(action)) {
        onFileActionBase(action as FileActionBase, entry);
        return;
      }
      if (action === 'extractAudio') {
        for (const e of entry) {
          if (e.kind === 'file') void extractAudio(e);
        }
        return;
      }
      return;
    }

    if (action === 'refresh') {
      void loadProjectDirectory({ fullRefresh: true });
    } else if (action === 'createFolder') {
      const target: FsEntry = entry ?? {
        kind: 'directory',
        name: projectStore.currentProjectName ?? '',
        path: '',
      };
      if (target.path) {
        uiStore.setFileTreePathExpanded(target.path, true);
      }
      onFileActionBase('createFolder', target, () =>
        (target.children ?? []).map((child) => child.name),
      );
    } else if (action === 'createTimeline') {
      if (entry.kind === 'directory') {
        if (entry.path) {
          uiStore.setFileTreePathExpanded(entry.path, true);
        }
        await createTimelineInDirectory(entry);
      }
    } else if (action === 'createMarkdown') {
      if (entry.kind === 'directory') {
        if (entry.path) {
          uiStore.setFileTreePathExpanded(entry.path, true);
        }
        onFileActionBase('createMarkdown', entry);
      }
    } else if (action === 'openAsPanelCut' || action === 'openAsPanelSound') {
      if (entry.kind !== 'file' || !isOpenableProjectFileName(entry.name)) return;
      const view = action === 'openAsPanelCut' ? 'cut' : 'sound';
      if (view === 'cut') {
        projectStore.goToCut();
      } else {
        projectStore.goToSound();
      }
      const mediaType = getMediaTypeFromFilename(entry.name);
      if (mediaType === 'text') {
        try {
          const blob = await vfs.readFile(entry.path);
          const content = await blob.text();
          projectStore.addTextPanel(entry.path, content, entry.name, undefined, undefined, view);
        } catch {
          projectStore.addTextPanel(entry.path, '', entry.name, undefined, undefined, view);
        }
      } else if (['video', 'audio', 'image'].includes(mediaType)) {
        projectStore.addMediaPanel(entry, mediaType as any, entry.name, undefined, undefined, view);
      }
    } else if (action === 'openAsProjectTab') {
      if (entry.kind !== 'file' || !entry.path || !isOpenableProjectFileName(entry.name)) return;
      const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
      setActiveTab(tabId);
    } else if (action === 'createOtioVersion') {
      onFileActionBase('createOtioVersion', entry);
    } else if (action === 'createProxyForFolder') {
      if (entry.kind === 'directory' && entry.path !== undefined) {
        const dirHandle = await projectStore.getDirectoryHandleByPath(entry.path);
        if (!dirHandle) return;
        void proxyStore.generateProxiesForFolder({ dirHandle, dirPath: entry.path });
      }
    } else if (action === 'cancelProxyForFolder') {
      if (entry.kind === 'directory' && entry.path !== undefined) {
        for (const p of proxyStore.generatingProxies) {
          if (p.startsWith(`${entry.path}/`)) {
            const rel = p.slice(entry.path.length + 1);
            if (!rel.includes('/')) void proxyStore.cancelProxyGeneration(p);
          }
        }
      }
    } else if (action === 'convertFile') {
      if (entry.kind === 'file') openConversionModal(entry);
    } else if (action === 'uploadRemote') {
      if (entry.kind === 'file' && entry.source !== 'remote') {
        uiStore.remoteExchangeLocalEntry = entry;
        uiStore.remoteExchangeModalOpen = true;
      }
    } else if (action === 'transcribe') {
      openTranscriptionModal(entry);
    } else if (action === 'extractAudio') {
      if (entry.kind === 'file') void extractAudio(entry);
    } else {
      onFileActionBase(action as FileActionBase, entry);
    }
  }

  return { handleFileAction, createTimelineInDirectory };
}
