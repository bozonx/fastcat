import type { FsEntry } from '~/types/fs';
import { WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import {
  canCopyCutBloggerDogEntry,
  canPasteIntoBloggerDogEntry,
} from '~/utils/bloggerdog-file-manager';

export type FileAction =
  | 'createFolder'
  | 'rename'
  | 'delete'
  | 'createProxy'
  | 'cancelProxy'
  | 'deleteProxy'
  | 'upload'
  | 'createProxyForFolder'
  | 'cancelProxyForFolder'
  | 'createOtioVersion'
  | 'createMarkdown'
  | 'createTimeline'
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab'
  | 'convertFile'
  | 'transcribe'
  | 'extractAudio'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'createSubgroup'
  | 'createContentItem';

interface ContextMenuDeps {
  isGeneratingProxyInDirectory: (entry: FsEntry) => boolean;
  folderHasVideos: (entry: FsEntry) => boolean;
  isOpenableMediaFile: (entry: FsEntry) => boolean;
  isConvertibleMediaFile: (entry: FsEntry) => boolean;
  isTranscribableMediaFile?: (entry: FsEntry) => boolean;
  isVideo: (entry: FsEntry) => boolean;
  hasAudioTrack?: (entry: FsEntry) => boolean;
  getEntryMeta: (entry: FsEntry) => {
    hasProxy: boolean;
    generatingProxy: boolean;
  };
  isFilesPage?: boolean;
  getSelectedEntries?: () => FsEntry[];
  hasClipboardItems?: boolean;
  isRemoteAvailable?: boolean;
  isBloggerDogProject?: (entry: FsEntry) => boolean;
  isBloggerDogGroup?: (entry: FsEntry) => boolean;
  isBloggerDogContentItem?: (entry: FsEntry) => boolean;
  isBloggerDogVirtualFolder?: (entry: FsEntry) => boolean;
  isBloggerDogMedia?: (entry: FsEntry) => boolean;
  isBloggerDogTextWrapper?: (entry: FsEntry) => boolean;
  instanceId?: string;
  isExternal?: boolean;
}

type ContextMenuItem = {
  label: string;
  icon: string;
  onSelect: () => void;
  color?: string;
  disabled?: boolean;
};

export function useFileContextMenu(
  deps: ContextMenuDeps,
  onAction: (action: FileAction, entry: FsEntry | FsEntry[]) => void,
) {
  const { t } = useI18n();

  function buildManagementItems(entry: FsEntry): ContextMenuItem[] {
    const isProjectRoot = entry.kind === 'directory' && (entry.path === '' || entry.path === '/');
    const isCommonRoot =
      entry.kind === 'directory' &&
      (entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
        (entry.name.toLowerCase() === 'common' && (entry.path === 'common' || entry.path === '')));

    const isBdProject = deps.isBloggerDogProject?.(entry);
    const isBdVirtual = deps.isBloggerDogVirtualFolder?.(entry);
    const isBdGroup = deps.isBloggerDogGroup?.(entry);
    const isBdContentItem = deps.isBloggerDogContentItem?.(entry);
    const isBdMedia = deps.isBloggerDogMedia?.(entry);
    const items: ContextMenuItem[] = [];

    // Copy/Cut: forbidden for virtual folders, projects, groups and content items.
    const canCopyCut =
      !isProjectRoot &&
      !isCommonRoot &&
      !isBdVirtual &&
      !isBdProject &&
      !isBdGroup &&
      !isBdContentItem;

    if (canCopyCut) {
      items.push(
        {
          label: t('common.copy'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('copy', entry),
        },
        {
          label: t('common.cut'),
          icon: 'i-heroicons-scissors',
          onSelect: () => onAction('cut', entry),
        },
      );
    }

    // Paste: only for Content Item (can paste media into it) or Project Folders (not BD).
    const canPaste =
      (entry.kind === 'directory' && !isBdGroup && !isBdVirtual && !isBdProject) || isBdContentItem;

    if (canPaste) {
      items.push({
        label: t('common.paste'),
        icon: 'i-heroicons-clipboard',
        disabled: !deps.hasClipboardItems,
        onSelect: () => onAction('paste', entry),
      });
    }

    if (!isProjectRoot && !isCommonRoot && !isBdVirtual && !isBdProject) {
      items.push(
        {
          label: t('common.rename'),
          icon: 'i-heroicons-pencil',
          onSelect: () => onAction('rename', entry),
        },
        {
          label: t('common.delete'),
          icon: 'i-heroicons-trash',
          color: 'error',
          onSelect: () => onAction('delete', entry),
        },
      );
    }

    return items;
  }

  function buildRemoteItems(entry: FsEntry): ContextMenuItem[][] {
    const isBdVirtual = deps.isBloggerDogVirtualFolder?.(entry);
    const isBdProject = deps.isBloggerDogProject?.(entry);
    const isBdGroup = deps.isBloggerDogGroup?.(entry);
    const isBdContentItem = deps.isBloggerDogContentItem?.(entry);
    const isBdMedia = deps.isBloggerDogMedia?.(entry);

    const items: ContextMenuItem[][] = [];

    if (entry.kind === 'directory' && !isBdContentItem) {
      const dirActions: ContextMenuItem[] = [];

      if (!isBdVirtual) {
        dirActions.push(
          {
            label: t('videoEditor.fileManager.actions.createFolder'),
            icon: 'i-heroicons-folder-plus',
            onSelect: () => onAction('createFolder', entry),
          },
          {
            label: t('videoEditor.fileManager.actions.createMarkdown'),
            icon: 'i-heroicons-document-text',
            onSelect: () => onAction('createMarkdown', entry),
          },
        );
      }

      if (dirActions.length > 0) {
        items.push(dirActions);
      }

      const bdActions: ContextMenuItem[] = [];
      // Personal root, Project root, or Group can have sub-groups and items.
      const canCreateSubgroup =
        isBdProject || isBdGroup || (isBdVirtual && entry.remoteId === 'personal');
      const canCreateItem =
        isBdProject ||
        isBdGroup ||
        (isBdVirtual && (entry.remoteId === 'personal' || entry.remoteId === 'virtual-all'));

      if (canCreateSubgroup) {
        bdActions.push({
          label: t('fastcat.bloggerDog.actions.createSubgroup'),
          icon: 'i-heroicons-folder-plus',
          onSelect: () => onAction('createSubgroup', entry),
        });
      }

      if (canCreateItem) {
        bdActions.push({
          label: t('fastcat.bloggerDog.actions.createItem'),
          icon: 'i-heroicons-document-plus',
          onSelect: () => onAction('createContentItem', entry),
        });
      }

      if (bdActions.length > 0) {
        items.push(bdActions);
      }
    }

    if (entry.kind === 'file' || isBdMedia) {
      // BD Media files should only have Management Items (Delete, Rename, Copy, Cut).
      // We skip expensive media actions for them unless they are explicitly allowed.
      if (!isBdMedia) {
        const mediaType = getMediaTypeFromFilename(entry.name);
        const isOtioFile = entry.name.toLowerCase().endsWith('.otio');

        if (deps.isConvertibleMediaFile(entry)) {
          items.push([
            {
              label: t('videoEditor.fileManager.actions.convertFile'),
              icon: 'i-heroicons-arrow-path',
              onSelect: () => onAction('convertFile', entry),
            },
          ]);
        }

        if (mediaType === 'audio' || mediaType === 'video') {
          items.push([
            {
              label: t('videoEditor.fileManager.actions.transcribe'),
              icon: 'i-heroicons-microphone',
              disabled: !deps.isTranscribableMediaFile?.(entry),
              onSelect: () => onAction('transcribe', entry),
            },
          ]);
        }

        if (deps.isVideo(entry) && (!deps.hasAudioTrack || deps.hasAudioTrack(entry))) {
          items.push([
            {
              label: t('videoEditor.fileManager.actions.extractAudio'),
              icon: 'i-heroicons-musical-note',
              onSelect: () => onAction('extractAudio', entry),
            },
          ]);
        }

        if (isOtioFile) {
          items.push([
            {
              label: t('fastcat.timeline.createVersion'),
              icon: 'i-heroicons-document-duplicate',
              onSelect: () => onAction('createOtioVersion', entry),
            },
          ]);
        }
      }
    }

    const managementItems = buildManagementItems(entry);
    if (managementItems.length > 0) {
      items.push(managementItems);
    }

    return items;
  }

  function buildMultiSelectionItems(entry: FsEntry, selectedEntries: FsEntry[]): ContextMenuItem[][] {
    const items: ContextMenuItem[][] = [];
    const isComputer = deps.isExternal || deps.instanceId === 'computer' || deps.instanceId === 'sidebar';
    const hasVideo = selectedEntries.some((selectedEntry) => selectedEntry.kind === 'file' && deps.isVideo(selectedEntry));
    const hasProxy = selectedEntries.some(
      (selectedEntry) => selectedEntry.kind === 'file' && deps.getEntryMeta(selectedEntry).hasProxy,
    );
    const generatingProxy = selectedEntries.some(
      (selectedEntry) =>
        selectedEntry.kind === 'file' && deps.getEntryMeta(selectedEntry).generatingProxy,
    );

    if (hasVideo && !isComputer) {
      if (!generatingProxy) {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.createProxy'),
            icon: 'i-heroicons-film',
            onSelect: () => onAction('createProxy', selectedEntries),
          },
        ]);
      }
      if (generatingProxy) {
        items.push([
          {
            label: t(
              'videoEditor.fileManager.actions.cancelProxyGeneration',
              'Cancel proxy generation',
            ),
            icon: 'i-heroicons-x-circle',
            color: 'error',
            onSelect: () => onAction('cancelProxy', selectedEntries),
          },
        ]);
      }
      if (hasProxy) {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.deleteProxy'),
            icon: 'i-heroicons-trash',
            color: 'error',
            onSelect: () => onAction('deleteProxy', selectedEntries),
          },
        ]);
      }
    }

    if (hasVideo && (!deps.hasAudioTrack || selectedEntries.some((e) => deps.hasAudioTrack?.(e)))) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.extractAudio'),
          icon: 'i-heroicons-musical-note',
          onSelect: () => onAction('extractAudio', selectedEntries),
        },
      ]);
    }

    const managementItems: ContextMenuItem[] = [];
    if (selectedEntries.every((selectedEntry) => canCopyCutBloggerDogEntry(selectedEntry))) {
      managementItems.push(
        {
          label: t('common.copy'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('copy', selectedEntries),
        },
        {
          label: t('common.cut'),
          icon: 'i-heroicons-scissors',
          onSelect: () => onAction('cut', selectedEntries),
        },
      );
    }

    const canPaste = entry.source === 'remote' ? canPasteIntoBloggerDogEntry(entry) : true;
    if (canPaste) {
      managementItems.push({
        label: t('common.paste'),
        icon: 'i-heroicons-clipboard',
        disabled: !deps.hasClipboardItems,
        onSelect: () => onAction('paste', entry),
      });
    }

    if (managementItems.length > 0) {
      items.push(managementItems);
    }

    items.push([
      {
        label: t('common.delete'),
        icon: 'i-heroicons-trash',
        color: 'error',
        onSelect: () => onAction('delete', selectedEntries),
      },
    ]);

    return items;
  }

  function getContextMenuItems(entry: FsEntry) {
    const selectedEntries = deps.getSelectedEntries ? deps.getSelectedEntries() : [];
    const isMultiSelected = selectedEntries.length > 1;
    const isComputer = deps.isExternal || deps.instanceId === 'computer' || deps.instanceId === 'sidebar';
    const isProjectRoot = entry.kind === 'directory' && (entry.path === '' || entry.path === '/');

    if (isMultiSelected && selectedEntries.some((selectedEntry) => selectedEntry.source === 'remote')) {
      const allRemote = selectedEntries.every((selectedEntry) => selectedEntry.source === 'remote');
      if (!allRemote) return [];
      return buildMultiSelectionItems(entry, selectedEntries);
    }

    if (entry.source === 'remote') {
      return buildRemoteItems(entry);
    }

    if (isMultiSelected) {
      return buildMultiSelectionItems(entry, selectedEntries);
    }

    const items: ContextMenuItem[][] = [];

    if (entry.kind === 'directory') {
      const dirItems: ContextMenuItem[] = [
        {
          label: t('videoEditor.fileManager.actions.createFolder'),
          icon: 'i-heroicons-folder-plus',
          onSelect: () => onAction('createFolder', entry),
        },
      ];

      if (!isComputer) {
        dirItems.push(
          {
            label: t('videoEditor.fileManager.actions.uploadFiles'),
            icon: 'i-heroicons-arrow-up-tray',
            onSelect: () => onAction('upload', entry),
          },
          {
            label: t('videoEditor.fileManager.actions.createTimeline'),
            icon: 'i-heroicons-document-plus',
            onSelect: () => onAction('createTimeline', entry),
          },
        );
      }

      dirItems.push({
        label: t('videoEditor.fileManager.actions.createMarkdown'),
        icon: 'i-heroicons-document-text',
        onSelect: () => onAction('createMarkdown', entry),
      });

      items.push(dirItems);

      if (deps.folderHasVideos(entry) && !isComputer) {
        items.push([
          deps.isGeneratingProxyInDirectory(entry)
            ? {
                label: t(
                  'videoEditor.fileManager.actions.cancelProxyGeneration',
                  'Cancel proxy generation',
                ),
                icon: 'i-heroicons-x-circle',
                color: 'error',
                onSelect: () => onAction('cancelProxyForFolder', entry),
              }
            : {
                label: t(
                  'videoEditor.fileManager.actions.createProxyForAll',
                  'Create proxy for all videos',
                ),
                icon: 'i-heroicons-film',
                onSelect: () => onAction('createProxyForFolder', entry),
              },
        ]);
      }
    }

    if (deps.isOpenableMediaFile(entry) && !isComputer) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.openAsPanelCut'),
          icon: 'i-heroicons-window',
          onSelect: () => onAction('openAsPanelCut', entry),
        },
        {
          label: t('videoEditor.fileManager.actions.openAsPanelSound'),
          icon: 'i-heroicons-window',
          onSelect: () => onAction('openAsPanelSound', entry),
        },
        {
          label: t('videoEditor.fileManager.actions.openAsProjectTab'),
          icon: 'i-heroicons-squares-plus',
          onSelect: () => onAction('openAsProjectTab', entry),
        },
      ]);
    }

    if (deps.isConvertibleMediaFile(entry)) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.convertFile'),
          icon: 'i-heroicons-arrow-path',
          onSelect: () => onAction('convertFile', entry),
        },
      ]);
    }

    const mediaType = entry.kind === 'file' ? getMediaTypeFromFilename(entry.name) : null;
    if (mediaType === 'audio' || mediaType === 'video') {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.transcribe'),
          icon: 'i-heroicons-microphone',
          disabled: !deps.isTranscribableMediaFile?.(entry),
          onSelect: () => onAction('transcribe', entry),
        },
      ]);
    }

    if (deps.isVideo(entry) && !isComputer) {
      const meta = deps.getEntryMeta(entry);
      if (!meta.generatingProxy) {
        items.push([
          {
            label: meta.hasProxy
              ? t('videoEditor.fileManager.actions.regenerateProxy')
              : t('videoEditor.fileManager.actions.createProxy'),
            icon: 'i-heroicons-film',
            onSelect: () => onAction('createProxy', entry),
          },
        ]);
      }
      if (meta.generatingProxy) {
        items.push([
          {
            label: t(
              'videoEditor.fileManager.actions.cancelProxyGeneration',
              'Cancel proxy generation',
            ),
            icon: 'i-heroicons-x-circle',
            color: 'error',
            onSelect: () => onAction('cancelProxy', entry),
          },
        ]);
      }
      if (meta.hasProxy) {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.deleteProxy'),
            icon: 'i-heroicons-trash',
            color: 'error',
            onSelect: () => onAction('deleteProxy', entry),
          },
        ]);
      }
    }

    if (deps.isVideo(entry) && (!deps.hasAudioTrack || deps.hasAudioTrack(entry))) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.extractAudio'),
          icon: 'i-heroicons-musical-note',
          onSelect: () => onAction('extractAudio', entry),
        },
      ]);
    }

    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.otio') && !isComputer) {
      items.push([
        {
          label: t('fastcat.timeline.createVersion'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('createOtioVersion', entry),
        },
      ]);
    }

    const managementItems = buildManagementItems(entry);
    if (managementItems.length > 0 || isProjectRoot) {
      items.push(managementItems);
    }

    return items;
  }

  return {
    getContextMenuItems,
  };
}
