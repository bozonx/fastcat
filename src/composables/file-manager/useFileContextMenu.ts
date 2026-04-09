import type { FsEntry } from '~/types/fs';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { getMediaTypeFromFilename } from '~/utils/media-types';

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
  instanceId?: string;
  isExternal?: boolean;
}

export function useFileContextMenu(
  deps: ContextMenuDeps,
  onAction: (action: FileAction, entry: FsEntry | FsEntry[]) => void,
) {
  const { t } = useI18n();

  function getContextMenuItems(entry: FsEntry) {
    const selectedEntries = deps.getSelectedEntries ? deps.getSelectedEntries() : [];
    const isMultiSelected = selectedEntries.length > 1;

    if (
      isMultiSelected &&
      selectedEntries.some((selectedEntry) => selectedEntry.source === 'remote')
    ) {
      const allRemote = selectedEntries.every((e) => e.source === 'remote');
      if (!allRemote) return [];

      return [
        [
          {
            label: t('common.copy', 'Copy'),
            icon: 'i-heroicons-document-duplicate',
            onSelect: () => onAction('copy', selectedEntries),
          },
          {
            label: t('common.cut', 'Cut'),
            icon: 'i-heroicons-scissors',
            onSelect: () => onAction('cut', selectedEntries),
          },
        ],
        [
          {
            label: t('common.rename', 'Rename'),
            icon: 'i-heroicons-pencil',
            onSelect: () => onAction('rename', selectedEntries[0]!),
            disabled: selectedEntries.length > 1,
          },
          {
            label: t('common.delete', 'Delete'),
            icon: 'i-heroicons-trash',
            color: 'error',
            onSelect: () => onAction('delete', selectedEntries),
          },
        ],
      ];
    }

    const isComputer = deps.isExternal || deps.instanceId === 'computer' || deps.instanceId === 'sidebar';

    if (entry.source === 'remote') {
      const items: any[][] = [];
      const isGroup = deps.isBloggerDogGroup?.(entry);

      if (isGroup) {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
            icon: 'i-heroicons-folder-plus',
            onSelect: () => onAction('createSubgroup', entry),
          },
          {
            label: t('fastcat.bloggerDog.actions.createItem', 'Создать элемент контента'),
            icon: 'i-heroicons-document-plus',
            onSelect: () => onAction('createContentItem', entry),
          },
        ]);
      }

      items.push([
        {
          label: t('common.copy', 'Copy'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('copy', entry),
        },
        {
          label: t('common.cut', 'Cut'),
          icon: 'i-heroicons-scissors',
          onSelect: () => onAction('cut', entry),
        },
      ]);

      items.push([
        {
          label: t('common.rename', 'Rename'),
          icon: 'i-heroicons-pencil',
          onSelect: () => onAction('rename', entry),
        },
        {
          label: t('common.delete', 'Delete'),
          icon: 'i-heroicons-trash',
          color: 'error',
          onSelect: () => onAction('delete', entry),
        },
      ]);

      return items;
    }

    if (isMultiSelected) {
      const items = [];
      const hasVideo = selectedEntries.some((e) => e.kind === 'file' && deps.isVideo(e));
      const hasProxy = selectedEntries.some(
        (e) => e.kind === 'file' && deps.getEntryMeta(e).hasProxy,
      );
      const generatingProxy = selectedEntries.some(
        (e) => e.kind === 'file' && deps.getEntryMeta(e).generatingProxy,
      );

      if (hasVideo) {
        if (!generatingProxy) {
          items.push([
            {
              label: t('videoEditor.fileManager.actions.createProxy', 'Create Proxy'),
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
              label: t('videoEditor.fileManager.actions.deleteProxy', 'Delete Proxy'),
              icon: 'i-heroicons-trash',
              color: 'error',
              onSelect: () => onAction('deleteProxy', selectedEntries),
            },
          ]);
        }
      }

      if (hasVideo) {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.extractAudio', 'Extract Audio'),
            icon: 'i-heroicons-musical-note',
            onSelect: () => onAction('extractAudio', selectedEntries),
          },
        ]);
      }

      items.push([
        {
          label: t('common.copy', 'Copy'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('copy', selectedEntries),
        },
        {
          label: t('common.cut', 'Cut'),
          icon: 'i-heroicons-scissors',
          onSelect: () => onAction('cut', selectedEntries),
        },
        {
          label: t('common.paste', 'Paste'),
          icon: 'i-heroicons-clipboard',
          disabled: !deps.hasClipboardItems,
          onSelect: () => onAction('paste', entry),
        },
      ]);

      items.push([
        {
          label: t('common.delete', 'Delete'),
          icon: 'i-heroicons-trash',
          color: 'error',
          onSelect: () => onAction('delete', selectedEntries),
        },
      ]);

      return items;
    }

    const items = [];

    if (entry.kind === 'directory') {
      const hasVideos = deps.folderHasVideos(entry);

      const dirItems = [
        {
          label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
          icon: 'i-heroicons-folder-plus',
          onSelect: () => onAction('createFolder', entry),
        },
      ];

      if (!isComputer) {
        dirItems.push(
          {
            label: t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
            icon: 'i-heroicons-arrow-up-tray',
            onSelect: () => onAction('upload', entry),
          },
          {
            label: t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline'),
            icon: 'i-heroicons-document-plus',
            onSelect: () => onAction('createTimeline', entry),
          },
        );
      }

      dirItems.push({
        label: t('videoEditor.fileManager.actions.createMarkdown', 'Create Markdown document'),
        icon: 'i-heroicons-document-text',
        onSelect: () => onAction('createMarkdown', entry),
      });

      items.push(dirItems);

      if (hasVideos && !isComputer) {
        if (deps.isGeneratingProxyInDirectory(entry)) {
          items.push([
            {
              label: t(
                'videoEditor.fileManager.actions.cancelProxyGeneration',
                'Cancel proxy generation',
              ),
              icon: 'i-heroicons-x-circle',
              color: 'error',
              onSelect: () => onAction('cancelProxyForFolder', entry),
            },
          ]);
        } else {
          items.push([
            {
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
    }

    if (deps.isOpenableMediaFile(entry) && !isComputer) {
      if (!deps.isFilesPage) {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.openAsPanelCut', 'Open as panel (Editor)'),
            icon: 'i-heroicons-window',
            onSelect: () => onAction('openAsPanelCut', entry),
          },
          {
            label: t('videoEditor.fileManager.actions.openAsPanelSound', 'Open as panel (Sound)'),
            icon: 'i-heroicons-window',
            onSelect: () => onAction('openAsPanelSound', entry),
          },
          {
            label: t('videoEditor.fileManager.actions.openAsProjectTab', 'Open as project tab'),
            icon: 'i-heroicons-squares-plus',
            onSelect: () => onAction('openAsProjectTab', entry),
          },
        ]);
      } else {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.openAsPanelCut', 'Open as panel (Editor)'),
            icon: 'i-heroicons-window',
            onSelect: () => onAction('openAsPanelCut', entry),
          },
          {
            label: t('videoEditor.fileManager.actions.openAsPanelSound', 'Open as panel (Sound)'),
            icon: 'i-heroicons-window',
            onSelect: () => onAction('openAsPanelSound', entry),
          },
        ]);
      }
    }

    if (deps.isConvertibleMediaFile(entry)) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.convertFile', 'Convert File'),
          icon: 'i-heroicons-arrow-path',
          onSelect: () => onAction('convertFile', entry),
        },
      ]);
    }

    const mediaType = entry.kind === 'file' ? getMediaTypeFromFilename(entry.name) : null;
    const isTranscribableType = mediaType === 'audio' || mediaType === 'video';

    if (isTranscribableType) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.transcribe', 'Transcribe'),
          icon: 'i-heroicons-microphone',
          disabled: !deps.isTranscribableMediaFile?.(entry),
          onSelect: () => onAction('transcribe', entry),
        },
      ]);
    }

    if (deps.isVideo(entry)) {
      const meta = deps.getEntryMeta(entry);
      const hasProxy = meta.hasProxy;
      const generatingProxy = meta.generatingProxy;

      if (!generatingProxy && !isComputer) {
        items.push([
          {
            label: hasProxy
              ? t('videoEditor.fileManager.actions.regenerateProxy', 'Regenerate Proxy')
              : t('videoEditor.fileManager.actions.createProxy', 'Create Proxy'),
            icon: 'i-heroicons-film',
            onSelect: () => onAction('createProxy', entry),
          },
        ]);
      }

      if (generatingProxy && !isComputer) {
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

      if (hasProxy && !isComputer) {
        items.push([
          {
            label: t('videoEditor.fileManager.actions.deleteProxy', 'Delete Proxy'),
            icon: 'i-heroicons-trash',
            color: 'error',
            onSelect: () => onAction('deleteProxy', entry),
          },
        ]);
      }
    }

    if (deps.isVideo(entry)) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.extractAudio', 'Extract Audio'),
          icon: 'i-heroicons-musical-note',
          onSelect: () => onAction('extractAudio', entry),
        },
      ]);
    }

    const isOtioFile = entry.kind === 'file' && entry.name.toLowerCase().endsWith('.otio');
    if (isOtioFile && !isComputer) {
      items.push([
        {
          label: t('fastcat.timeline.createVersion', 'Create version'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('createOtioVersion', entry),
        },
      ]);
    }

    const isCommonRoot =
      entry.kind === 'directory' &&
      (entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
        (entry.name.toLowerCase() === 'common' && (entry.path === 'common' || entry.path === '')));
    const isProjectRoot = entry.kind === 'directory' && (entry.path === '' || entry.path === '/');

    const managementItems = [];
    if (!isCommonRoot && !isProjectRoot) {
      managementItems.push(
        {
          label: t('common.copy', 'Copy'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('copy', entry),
        },
        {
          label: t('common.cut', 'Cut'),
          icon: 'i-heroicons-scissors',
          onSelect: () => onAction('cut', entry),
        },
      );
    }

    if (entry.kind === 'directory') {
      managementItems.push({
        label: t('common.paste', 'Paste'),
        icon: 'i-heroicons-clipboard',
        disabled: !deps.hasClipboardItems,
        onSelect: () => onAction('paste', entry),
      });
    }

    if (!isCommonRoot && !isProjectRoot) {
      managementItems.push(
        {
          label: t('common.rename', 'Rename'),
          icon: 'i-heroicons-pencil',
          onSelect: () => onAction('rename', entry),
        },
        {
          label: t('common.delete', 'Delete'),
          icon: 'i-heroicons-trash',
          color: 'error',
          onSelect: () => onAction('delete', entry),
        },
      );
    }

    if (managementItems.length > 0) {
      items.push(managementItems);
    }

    return items;
  }

  return {
    getContextMenuItems,
  };
}
