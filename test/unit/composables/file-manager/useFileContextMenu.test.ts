/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileContextMenu } from '~/composables/file-manager/useFileContextMenu';
import type { FsEntry } from '~/types/fs';

vi.stubGlobal('useI18n', () => ({
  t: (_key: string, fallback?: string) => fallback ?? _key,
}));

function flattenLabels(items: any[][]): string[] {
  return items.flat().map((item) => item.label);
}

describe('useFileContextMenu', () => {
  const videoEntry: FsEntry = {
    kind: 'file',
    name: 'clip.mp4',
    path: 'clip.mp4',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides proxy actions for external multi-selection', () => {
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => true,
        isConvertibleMediaFile: () => true,
        isVideo: () => true,
        getEntryMeta: () => ({
          hasProxy: true,
          generatingProxy: false,
        }),
        getSelectedEntries: () => [videoEntry, { ...videoEntry, path: 'clip-2.mp4', name: 'clip-2.mp4' }],
        isExternal: true,
      },
      vi.fn(),
    );

    const labels = flattenLabels(getContextMenuItems(videoEntry));

    expect(labels).not.toContain('videoEditor.fileManager.actions.createProxy');
    expect(labels).not.toContain('videoEditor.fileManager.actions.deleteProxy');
    expect(labels).not.toContain('videoEditor.fileManager.actions.cancelProxyGeneration');
    expect(labels).toContain('videoEditor.fileManager.actions.extractAudio');
  });

  it('keeps proxy actions for project multi-selection', () => {
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => true,
        isConvertibleMediaFile: () => true,
        isVideo: () => true,
        getEntryMeta: () => ({
          hasProxy: true,
          generatingProxy: false,
        }),
        getSelectedEntries: () => [videoEntry, { ...videoEntry, path: 'clip-2.mp4', name: 'clip-2.mp4' }],
      },
      vi.fn(),
    );

    const labels = flattenLabels(getContextMenuItems(videoEntry));

    expect(labels).toContain('videoEditor.fileManager.actions.createProxy');
    expect(labels).toContain('videoEditor.fileManager.actions.deleteProxy');
  });

  it('keeps open as project tab in files page context menu', () => {
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => true,
        isConvertibleMediaFile: () => false,
        isVideo: () => false,
        getEntryMeta: () => ({
          hasProxy: false,
          generatingProxy: false,
        }),
        isFilesPage: true,
      },
      vi.fn(),
    );

    const labels = flattenLabels(
      getContextMenuItems({
        kind: 'file',
        name: 'notes.txt',
        path: 'docs/notes.txt',
      }),
    );

    expect(labels).toContain('videoEditor.fileManager.actions.openAsProjectTab');
  });

  it('shows only workspace-root actions for external root directory', () => {
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => false,
        isConvertibleMediaFile: () => false,
        isVideo: () => false,
        getEntryMeta: () => ({
          hasProxy: false,
          generatingProxy: false,
        }),
        isExternal: true,
        hasClipboardItems: true,
      },
      vi.fn(),
    );

    const labels = flattenLabels(
      getContextMenuItems({
        kind: 'directory',
        name: 'Workspace',
        path: '',
      }),
    );

    expect(labels).toEqual([
      'videoEditor.fileManager.actions.createFolder',
      'videoEditor.fileManager.actions.createMarkdown',
      'common.paste',
    ]);
  });

  it('hides actions for remote root', () => {
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => false,
        isConvertibleMediaFile: () => false,
        isVideo: () => false,
        getEntryMeta: () => ({
          hasProxy: false,
          generatingProxy: false,
        }),
        isBloggerDogVirtualFolder: (e: FsEntry) => e.path === '/remote',
      },
      vi.fn(),
    );

    expect(
      getContextMenuItems({
        kind: 'directory',
        name: 'Remote',
        path: '/remote',
        source: 'remote',
      }),
    ).toEqual([]);
  });

  it('shows paste only for BloggerDog content items and not for roots or groups', () => {
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => false,
        isConvertibleMediaFile: () => false,
        isVideo: () => false,
        getEntryMeta: () => ({
          hasProxy: false,
          generatingProxy: false,
        }),
        hasClipboardItems: true,
        isBloggerDogVirtualFolder: (entry: FsEntry) =>
          entry.source === 'remote' && entry.adapterPayload === 'virtual-folder',
        isBloggerDogGroup: (entry: FsEntry) =>
          entry.source === 'remote' && entry.adapterPayload === 'collection',
        isBloggerDogContentItem: (entry: FsEntry) =>
          entry.source === 'remote' && entry.adapterPayload === 'content-item',
      },
      vi.fn(),
    );

    const rootLabels = flattenLabels(
      getContextMenuItems({
        kind: 'directory',
        name: 'Personal',
        path: '/personal',
        source: 'remote',
        adapterPayload: 'virtual-folder' as any,
      }),
    );
    const groupLabels = flattenLabels(
      getContextMenuItems({
        kind: 'directory',
        name: 'Group',
        path: '/personal/group-1',
        source: 'remote',
        adapterPayload: 'collection' as any,
      }),
    );
    const contentItemLabels = flattenLabels(
      getContextMenuItems({
        kind: 'directory',
        name: 'Item',
        path: '/personal/item-1',
        source: 'remote',
        adapterPayload: 'content-item' as any,
      }),
    );

    expect(rootLabels).not.toContain('common.paste');
    expect(groupLabels).not.toContain('common.paste');
    expect(contentItemLabels).toContain('common.paste');
  });

  it('hides copy and cut for BloggerDog groups in multi-selection menu', () => {
    const groupEntry: FsEntry = {
      kind: 'directory',
      name: 'Group',
      path: '/personal/group-1',
      source: 'remote',
      adapterPayload: {
        type: 'collection',
        remoteData: { id: 'group-1' },
      },
    };
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => false,
        isConvertibleMediaFile: () => false,
        isVideo: () => false,
        getEntryMeta: () => ({
          hasProxy: false,
          generatingProxy: false,
        }),
        hasClipboardItems: true,
        getSelectedEntries: () => [
          groupEntry,
          {
            ...groupEntry,
            path: '/personal/group-2',
            adapterPayload: {
              type: 'collection',
              remoteData: { id: 'group-2' },
            },
          },
        ],
        isBloggerDogGroup: (entry: FsEntry) =>
          entry.source === 'remote' && entry.adapterPayload === 'collection',
      },
      vi.fn(),
    );

    const labels = flattenLabels(getContextMenuItems(groupEntry));

    expect(labels).not.toContain('common.copy');
    expect(labels).not.toContain('common.cut');
  });

  it('shows only copy for BloggerDog virtual text wrapper', () => {
    const entry: FsEntry = {
      kind: 'file',
      name: 'Item.txt',
      path: '/personal/item-1/Item.txt',
      source: 'remote',
      adapterPayload: {
        type: 'media',
        remoteData: { id: 'item-1' },
      } as any,
    };
    const { getContextMenuItems } = useFileContextMenu(
      {
        isGeneratingProxyInDirectory: () => false,
        folderHasVideos: () => false,
        isOpenableMediaFile: () => false,
        isConvertibleMediaFile: () => false,
        isVideo: () => false,
        getEntryMeta: () => ({
          hasProxy: false,
          generatingProxy: false,
        }),
        isBloggerDogTextWrapper: (candidate: FsEntry) =>
          candidate.path === '/personal/item-1/Item.txt',
      },
      vi.fn(),
    );

    const labels = flattenLabels(getContextMenuItems(entry));

    expect(labels).toContain('common.copy');
    expect(labels).not.toContain('common.cut');
    expect(labels).not.toContain('common.rename');
    expect(labels).not.toContain('common.delete');
  });
});
