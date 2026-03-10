// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { FsEntry } from '../../../../src/types/fs';
import { createFileManagerService } from '../../../../src/file-manager/application/fileManagerService';
import { VIDEO_DIR_NAME } from '../../../../src/utils/constants';

describe('fileManagerService', () => {
  it('readDirectory filters hidden files when showHiddenFiles=false and sorts directories first', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async () => [
        { kind: 'file', name: 'bbb.txt', path: 'bbb.txt', parentPath: '' },
        { kind: 'file', name: '.secret.txt', path: '.secret.txt', parentPath: '' },
        { kind: 'directory', name: 'aaa', path: 'aaa', parentPath: '' },
      ]),
    } as any;

    const checkExistingProxies = vi.fn(async () => undefined);
    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => false,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      vfs,
      checkExistingProxies,
    });

    const entries = await service.readDirectory('');

    expect(entries.map((e) => e.name)).toEqual(['aaa', 'bbb.txt']);
    expect(entries[0]!.kind).toBe('directory');
    expect(entries[1]!.kind).toBe('file');
    expect(checkExistingProxies).not.toHaveBeenCalled();
  });

  it('readDirectory includes hidden files when showHiddenFiles=true', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async () => [
        { kind: 'file', name: '.secret.txt', path: '.secret.txt', parentPath: '' },
        { kind: 'file', name: 'a.txt', path: 'a.txt', parentPath: '' },
      ]),
    } as any;

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      vfs,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    const entries = await service.readDirectory('');
    expect(new Set(entries.map((e) => e.name))).toEqual(new Set(['.secret.txt', 'a.txt']));
  });

  it('readDirectory calls checkExistingProxies for video files', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async () => [
        {
          kind: 'file',
          name: 'a.mp4',
          path: `${VIDEO_DIR_NAME}/a.mp4`,
          parentPath: VIDEO_DIR_NAME,
        },
      ]),
    } as any;

    const checkExistingProxies = vi.fn(async () => undefined);
    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      vfs,
      checkExistingProxies,
    });

    await service.readDirectory(VIDEO_DIR_NAME);

    expect(checkExistingProxies).toHaveBeenCalledWith([`${VIDEO_DIR_NAME}/a.mp4`]);
  });

  it('toggleDirectory updates rootEntries expanded state, persists path, and lazy-loads children', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async (path?: string) => {
        if (path === 'folder') {
          return [
            { kind: 'file', name: 'child.txt', path: 'folder/child.txt', parentPath: 'folder' },
          ];
        }
        return [];
      }),
    } as any;

    const setPathExpanded = vi.fn();

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      hasPersistedFileTreeState: () => false,
      isPathExpanded: () => false,
      setPathExpanded,
      getExpandedPaths: () => [],
      vfs,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    const entry: FsEntry = {
      name: 'folder',
      kind: 'directory',
      path: 'folder',
      expanded: false,
      children: undefined,
    };

    rootEntries.value = [entry];

    await service.toggleDirectory(entry);

    const updated = rootEntries.value[0];
    expect(updated?.expanded).toBe(true);
    expect(setPathExpanded).toHaveBeenCalledWith('folder', true);
    expect(updated?.children?.map((e) => e.name)).toEqual(['child.txt']);
  });

  it('readDirectory reports error via onError when iteration is not available', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async () => {
        throw new Error('iteration is not available');
      }),
    } as any;

    const onError = vi.fn();
    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      vfs,
      checkExistingProxies: vi.fn(async () => undefined),
      onError,
    });

    const result = await service.readDirectory('');

    expect(result).toEqual([]);
    expect(onError).toHaveBeenCalledWith({
      title: 'File manager error',
      message: 'Failed to read directory',
      error: expect.any(Error),
    });
  });

  it('loadProjectDirectory merges entries and auto-expands media dirs', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async (path?: string) => {
        if (!path) {
          return [
            { kind: 'directory', name: 'sources', path: 'sources', parentPath: '' },
            { kind: 'directory', name: VIDEO_DIR_NAME, path: VIDEO_DIR_NAME, parentPath: '' },
          ];
        }

        if (path === VIDEO_DIR_NAME) {
          return [];
        }

        return [];
      }),
    } as any;

    const setPathExpanded = vi.fn();

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded,
      getExpandedPaths: () => [],
      vfs,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    await service.loadProjectDirectory('');

    const names = rootEntries.value.map((e) => e.name);
    expect(new Set(names)).toEqual(new Set(['sources', VIDEO_DIR_NAME]));

    const videoEntry = rootEntries.value.find((e) => e.name === VIDEO_DIR_NAME);
    expect(videoEntry?.expanded).toBe(true);
  });

  it('loadProjectDirectory does not auto-expand media dirs when persisted tree state exists', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async (path?: string) => {
        if (!path) {
          return [
            { kind: 'directory', name: VIDEO_DIR_NAME, path: VIDEO_DIR_NAME, parentPath: '' },
          ];
        }

        return [];
      }),
    } as any;

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      hasPersistedFileTreeState: () => true,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      vfs,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    await service.loadProjectDirectory('');

    const videoEntry = rootEntries.value.find((e) => e.name === VIDEO_DIR_NAME);
    expect(videoEntry?.expanded).toBe(false);
  });

  it('expandPersistedDirectories expands saved paths and loads children', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'type'>('name');

    const vfs = {
      readDirectory: vi.fn(async (path?: string) => {
        if (path === 'folder') {
          return [
            { kind: 'directory', name: 'nested', path: 'folder/nested', parentPath: 'folder' },
          ];
        }
        if (path === 'folder/nested') {
          return [
            {
              kind: 'file',
              name: 'child.txt',
              path: 'folder/nested/child.txt',
              parentPath: 'folder/nested',
            },
          ];
        }
        return [];
      }),
    } as any;

    const getExpandedPaths = () => ['folder/nested'];
    const setPathExpanded = vi.fn();

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: (path) => path === 'folder/nested',
      setPathExpanded,
      getExpandedPaths,
      vfs,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    rootEntries.value = [
      {
        name: 'folder',
        kind: 'directory',
        path: 'folder',
        expanded: false,
        children: undefined,
      },
    ];

    await service.expandPersistedDirectories();

    const folder = rootEntries.value[0]!;
    expect(folder.expanded).toBe(true);
    expect(setPathExpanded).toHaveBeenCalledWith('folder', true);
  });
});
