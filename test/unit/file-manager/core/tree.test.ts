import { describe, expect, it } from 'vitest';
import type { FsEntry } from '../../../../src/types/fs';
import { findEntryByPath, mergeEntries } from '../../../../src/file-manager/core/tree';

function createDir(params: { name: string; path: string; expanded?: boolean; children?: FsEntry[] }): FsEntry {
  return {
    name: params.name,
    kind: 'directory',
    handle: {} as unknown as FileSystemDirectoryHandle,
    path: params.path,
    expanded: params.expanded ?? false,
    children: params.children,
  };
}

function createFile(params: { name: string; path: string; lastModified?: number }): FsEntry {
  return {
    name: params.name,
    kind: 'file',
    handle: {} as unknown as FileSystemFileHandle,
    path: params.path,
    lastModified: params.lastModified,
  };
}

describe('file-manager core tree', () => {
  it('findEntryByPath should find nested entry and normalize path', () => {
    const entries: FsEntry[] = [
      createDir({
        name: 'sources',
        path: 'sources',
        expanded: true,
        children: [createFile({ name: 'a.mp4', path: 'sources/video/a.mp4' })],
      }),
    ];

    expect(findEntryByPath(entries, ' sources/video/a.mp4 ')).toMatchObject({
      name: 'a.mp4',
      kind: 'file',
      path: 'sources/video/a.mp4',
    });
  });

  it('mergeEntries should preserve in-memory expanded state and children', () => {
    const prevChild = createFile({ name: 'a.mp4', path: 'sources/video/a.mp4' });
    const prev: FsEntry[] = [
      createDir({
        name: 'video',
        path: 'sources/video',
        expanded: true,
        children: [prevChild],
      }),
    ];

    const next: FsEntry[] = [
      createDir({
        name: 'video',
        path: 'sources/video',
        expanded: false,
        children: undefined,
      }),
    ];

    const merged = mergeEntries(prev, next, {
      isPathExpanded: () => false,
    });

    expect(merged[0]?.expanded).toBe(true);
    expect(merged[0]?.children).toEqual([prevChild]);
  });

  it('mergeEntries should apply persisted expanded state for new directories', () => {
    const prev: FsEntry[] = [];
    const next: FsEntry[] = [createDir({ name: 'video', path: 'sources/video', expanded: false })];

    const merged = mergeEntries(prev, next, {
      isPathExpanded: (path) => path === 'sources/video',
    });

    expect(merged[0]?.expanded).toBe(true);
  });
});
