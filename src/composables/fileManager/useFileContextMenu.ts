import type { FsEntry } from '~/types/fs';

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
  | 'openAsPanel'
  | 'openAsProjectTab'
  | 'convertFile';

interface ContextMenuDeps {
  isGeneratingProxyInDirectory: (entry: FsEntry) => boolean;
  folderHasVideos: (entry: FsEntry) => boolean;
  isOpenableMediaFile: (entry: FsEntry) => boolean;
  isConvertibleMediaFile: (entry: FsEntry) => boolean;
  isVideo: (entry: FsEntry) => boolean;
  getEntryMeta: (entry: FsEntry) => {
    hasProxy: boolean;
    generatingProxy: boolean;
  };
  isFilesPage?: boolean;
  getSelectedEntries?: () => FsEntry[];
}

export function useFileContextMenu(
  deps: ContextMenuDeps,
  onAction: (action: FileAction, entry: FsEntry | FsEntry[]) => void,
) {
  const { t } = useI18n();

  function getContextMenuItems(entry: FsEntry) {
    const selectedEntries = deps.getSelectedEntries ? deps.getSelectedEntries() : [];
    const isMultiSelected = selectedEntries.length > 1;

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

    if (deps.isOpenableMediaFile(entry) && !deps.isFilesPage) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.openAsPanel', 'Open as panel'),
          icon: 'i-heroicons-window',
          onSelect: () => onAction('openAsPanel', entry),
        },
        {
          label: t('videoEditor.fileManager.actions.openAsProjectTab', 'Open as project tab'),
          icon: 'i-heroicons-squares-plus',
          onSelect: () => onAction('openAsProjectTab', entry),
        },
      ]);
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

    const isOtioFile = entry.kind === 'file' && entry.name.toLowerCase().endsWith('.otio');
    if (isOtioFile) {
      items.push([
        {
          label: t('granVideoEditor.timeline.createVersion', 'Create version'),
          icon: 'i-heroicons-document-duplicate',
          onSelect: () => onAction('createOtioVersion', entry),
        },
      ]);
    }

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

  return {
    getContextMenuItems,
  };
}
