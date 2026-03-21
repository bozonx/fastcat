import type { FsEntry } from '~/types/fs';
import { isWorkspaceCommonPath } from '~/utils/workspace-common';

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
  | 'uploadRemote'
  | 'transcribe'
  | 'extractAudio'
  | 'copy'
  | 'cut'
  | 'paste';

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
      return [];
    }

    if (entry.source === 'remote') {
      return [];
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

      items.push([
        {
          label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
          icon: 'i-heroicons-folder-plus',
          onSelect: () => onAction('createFolder', entry),
        },
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
        {
          label: t('videoEditor.fileManager.actions.createMarkdown', 'Create Markdown document'),
          icon: 'i-heroicons-document-text',
          onSelect: () => onAction('createMarkdown', entry),
        },
      ]);

      if (deps.hasClipboardItems) {
        items.push([
          {
            label: t('common.paste', 'Paste'),
            icon: 'i-heroicons-clipboard',
            onSelect: () => onAction('paste', entry),
          },
        ]);
      }

      if (hasVideos) {
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

    if (deps.isOpenableMediaFile(entry)) {
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

    if (entry.kind === 'file') {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.uploadRemote', 'Upload to remote'),
          icon: 'i-heroicons-cloud-arrow-up',
          onSelect: () => onAction('uploadRemote', entry),
        },
      ]);
    }

    if (deps.isTranscribableMediaFile?.(entry)) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.transcribe', 'Transcribe'),
          icon: 'i-heroicons-microphone',
          onSelect: () => onAction('transcribe', entry),
        },
      ]);
    }

    if (deps.isVideo(entry)) {
      const meta = deps.getEntryMeta(entry);
      const hasProxy = meta.hasProxy;
      const generatingProxy = meta.generatingProxy;

      if (!generatingProxy) {
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

      if (generatingProxy) {
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

      if (hasProxy) {
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
    if (isOtioFile) {
      items.push([
        {
          label: t('fastcat.timeline.createVersion', 'Create version'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('createOtioVersion', entry),
        },
      ]);
    }

    const isCommon =
      entry.kind === 'directory' &&
      entry.name.toLowerCase() === 'common' &&
      (entry.path === 'common' || entry.path === '');
    const isProjectRoot = entry.kind === 'directory' && entry.path === '';
    const isCommonPath = isWorkspaceCommonPath(entry.path);

    if (!isCommon && !isProjectRoot && !isCommonPath) {
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
    }

    return items;
  }

  return {
    getContextMenuItems,
  };
}
