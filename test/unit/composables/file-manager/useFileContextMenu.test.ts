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

    expect(labels).not.toContain('Create Proxy');
    expect(labels).not.toContain('Delete Proxy');
    expect(labels).not.toContain('Cancel proxy generation');
    expect(labels).toContain('Extract Audio');
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

    expect(labels).toContain('Create Proxy');
    expect(labels).toContain('Delete Proxy');
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

    expect(labels).toContain('Open as project tab');
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

    expect(labels).toEqual(['Create Folder', 'Create Markdown document', 'Paste']);
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
});
