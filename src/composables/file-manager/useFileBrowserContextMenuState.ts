import { computed } from 'vue';
import type { Ref } from 'vue';
import { useFileContextMenu } from '~/composables/file-manager/useFileContextMenu';
import type { FileAction as ContextMenuFileAction } from '~/composables/file-manager/useFileContextMenu';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import type { FsEntry } from '~/types/fs';
import { getBdPayload } from '~/types/bloggerdog';
import { resolveMediaMetadata } from '~/stores/media.store';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import {
  isGeneratingProxyInDirectory as hasGeneratingProxyInDirectory,
  folderHasVideos,
} from '~/utils/fs';

interface SelectedFileManagerEntity {
  source?: string;
  kind?: string;
  entry?: FsEntry;
  entries?: FsEntry[];
}

interface FileBrowserContextMenuStateParams {
  isRemoteMode: Ref<boolean>;
  selectedFolder: () => FsEntry | null;
  selectedEntity: () => SelectedFileManagerEntity | null;
  fileCompatibility: Ref<Record<string, FileCompatibility>>;
  mediaMetadata: Record<string, { audio?: unknown } | undefined>;
  generatingProxies: Set<string>;
  hasProxy: (path: string) => boolean;
  hasClipboardItems: () => boolean;
  isTranscribableMediaFile: (entry: FsEntry) => boolean;
  onFileAction: (action: ContextMenuFileAction, entry: FsEntry | FsEntry[]) => void;
  isFilesPage?: boolean;
  instanceId: string;
  isExternal: boolean;
  inDevelopmentFeaturesEnabled?: boolean;
}

export function useFileBrowserContextMenuState(params: FileBrowserContextMenuStateParams) {
  function getSelectedEntries(): FsEntry[] {
    const selected = params.selectedEntity();
    if (selected?.source !== 'fileManager') return [];
    if (selected.kind === 'multiple') return selected.entries ?? [];
    return selected.entry ? [selected.entry] : [];
  }

  function getFileStatus(entry: FsEntry) {
    if (entry.kind !== 'file' || !entry.path) return 'ok';
    return params.fileCompatibility.value[entry.path]?.status ?? 'ok';
  }

  function canUseFile(entry: FsEntry): boolean {
    const status = getFileStatus(entry);
    return status !== 'checking' && status !== 'fully_unsupported' && status !== 'corrupt';
  }

  function isVideo(entry: FsEntry): boolean {
    return (
      entry.kind === 'file' && canUseFile(entry) && getMediaTypeFromFilename(entry.name) === 'video'
    );
  }

  function isDirectoryGeneratingProxy(entry: FsEntry): boolean {
    return hasGeneratingProxyInDirectory(entry, params.generatingProxies);
  }

  const { getContextMenuItems } = useFileContextMenu(
    {
      isGeneratingProxyInDirectory: isDirectoryGeneratingProxy,
      folderHasVideos,
      isOpenableMediaFile: (entry: FsEntry) => {
        if (entry.kind !== 'file' || !entry.path) return false;
        if (!canUseFile(entry)) return false;
        return isOpenableProjectFileName(entry.name);
      },
      isConvertibleMediaFile: (entry: FsEntry) => {
        if (entry.kind !== 'file' || !entry.path) return false;
        if (!canUseFile(entry)) return false;
        const type = getMediaTypeFromFilename(entry.name);
        return type === 'video' || type === 'audio' || type === 'image';
      },
      isTranscribableMediaFile: params.isTranscribableMediaFile,
      canUseFile,
      isVideo,
      hasAudioTrack: (entry) => {
        if (entry.kind !== 'file' || !entry.path) return false;
        const meta = resolveMediaMetadata(params.mediaMetadata, entry.path);
        return !!meta?.audio;
      },
      getEntryMeta: (entry: FsEntry) => ({
        hasProxy: entry.path ? params.hasProxy(entry.path) : false,
        generatingProxy: entry.path ? params.generatingProxies.has(entry.path) : false,
      }),
      isFilesPage: params.isFilesPage,
      instanceId: params.instanceId,
      isExternal: params.isExternal,
      inDevelopmentFeaturesEnabled: params.inDevelopmentFeaturesEnabled,
      isBloggerDogProject: (entry: FsEntry) => getBdPayload(entry)?.type === 'project',
      isBloggerDogGroup: (entry: FsEntry) => getBdPayload(entry)?.type === 'collection',
      isBloggerDogContentItem: (entry: FsEntry) => getBdPayload(entry)?.type === 'content-item',
      isBloggerDogVirtualFolder: (entry: FsEntry) => getBdPayload(entry)?.type === 'virtual-folder',
      isBloggerDogMedia: (entry: FsEntry) => {
        const payload = getBdPayload(entry);
        return payload?.type === 'media' && !!payload?.mediaId;
      },
      isBloggerDogTextWrapper: (entry: FsEntry) => {
        const payload = getBdPayload(entry);
        return payload?.type === 'media' && !payload?.mediaId;
      },
      getSelectedEntries,
      get hasClipboardItems() {
        return params.hasClipboardItems();
      },
    },
    (action: ContextMenuFileAction, entry: FsEntry | FsEntry[]) => {
      params.onFileAction(action, entry);
    },
  );

  const emptySpaceContextMenuItems = computed(() => {
    if (params.isRemoteMode.value) return [];
    const selected = params.selectedEntity();
    if (
      selected?.source === 'fileManager' &&
      selected.kind === 'multiple' &&
      (selected.entries?.length ?? 0) > 1
    ) {
      const first = selected.entries?.[0];
      if (!first) return [];
      return getContextMenuItems(first);
    }
    const selectedFolder = params.selectedFolder();
    if (!selectedFolder) return [];
    return getContextMenuItems(selectedFolder);
  });

  return {
    canUseFile,
    isDirectoryGeneratingProxy,
    getContextMenuItems,
    emptySpaceContextMenuItems,
  };
}
