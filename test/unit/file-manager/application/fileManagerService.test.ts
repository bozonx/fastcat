// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { FsEntry } from '../../../../src/types/fs';
import { createFileManagerService } from '../../../../src/file-manager/application/fileManagerService';
import { VIDEO_DIR_NAME } from '../../../../src/utils/constants';

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function createDirHandleMock(params?: {
  values?: any[];
  getDirectoryHandleImpl?: (name: string, opts?: any) => any;
}) {
  const handle: any = {
    kind: 'directory',
    name: 'root',
    values: params?.values ? () => createAsyncIterable(params.values!) : undefined,
    entries: undefined,
    getDirectoryHandle:
      params?.getDirectoryHandleImpl ?? vi.fn(async () => ({ kind: 'directory', name: 'child' })),
    getFileHandle: vi.fn(async () => ({ kind: 'file', name: 'file' })),
  };

  return handle as unknown as FileSystemDirectoryHandle;
}

function createFileHandleMock(params: { name: string; lastModified?: number; type?: string }) {
  return {
    kind: 'file',
    name: params.name,
    getFile: vi.fn(async () => {
      const file = new File(['x'], params.name, { type: params.type ?? 'text/plain' });
      Object.defineProperty(file, 'lastModified', {
        value: params.lastModified ?? 1,
        configurable: true,
      });
      return file;
    }),
    createWritable: vi.fn(async () => ({ write: vi.fn(), close: vi.fn() })),
  } as unknown as FileSystemFileHandle;
}

describe('fileManagerService', () => {
  it('readDirectory filters hidden files when showHiddenFiles=false and sorts directories first', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'modified'>('name');

    const dirA: any = { kind: 'directory', name: 'aaa' };
    const fileHidden: any = { kind: 'file', name: '.secret.txt', getFile: vi.fn() };
    const fileB: any = createFileHandleMock({ name: 'bbb.txt' });

    const dirHandle = createDirHandleMock({ values: [fileB, fileHidden, dirA] });

    const checkExistingProxies = vi.fn(async () => undefined);
    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => false,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      sanitizeHandle: (h) => h,
      sanitizeParentHandle: (h) => h,
      checkExistingProxies,
    });

    const entries = await service.readDirectory(dirHandle);

    expect(entries.map((e) => e.name)).toEqual(['aaa', 'bbb.txt']);
    expect(entries[0]!.kind).toBe('directory');
    expect(entries[1]!.kind).toBe('file');
    expect(checkExistingProxies).not.toHaveBeenCalled();
  });

  it('readDirectory includes hidden files when showHiddenFiles=true', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'modified'>('name');

    const fileHidden: any = { kind: 'file', name: '.secret.txt', getFile: vi.fn() };
    const fileVisible: any = createFileHandleMock({ name: 'a.txt' });
    const dirHandle = createDirHandleMock({ values: [fileHidden, fileVisible] });

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      sanitizeHandle: (h) => h,
      sanitizeParentHandle: (h) => h,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    const entries = await service.readDirectory(dirHandle);
    expect(new Set(entries.map((e) => e.name))).toEqual(new Set(['.secret.txt', 'a.txt']));
  });

  it('readDirectory calls checkExistingProxies for video files', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'modified'>('name');

    const video = createFileHandleMock({ name: 'a.mp4', type: 'video/mp4' });
    const dirHandle = createDirHandleMock({ values: [video] });

    const checkExistingProxies = vi.fn(async () => undefined);
    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      sanitizeHandle: (h) => h,
      sanitizeParentHandle: (h) => h,
      checkExistingProxies,
    });

    await service.readDirectory(dirHandle, VIDEO_DIR_NAME);

    expect(checkExistingProxies).toHaveBeenCalledWith([`${VIDEO_DIR_NAME}/a.mp4`]);
  });

  it('toggleDirectory updates rootEntries expanded state, persists path, and lazy-loads children', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'modified'>('name');

    const childFile = createFileHandleMock({ name: 'child.txt' });
    const childDirHandle = createDirHandleMock({ values: [childFile] });

    const setPathExpanded = vi.fn();

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded,
      getExpandedPaths: () => [],
      sanitizeHandle: (h) => h,
      sanitizeParentHandle: (h) => h,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    const entry: FsEntry = {
      name: 'folder',
      kind: 'directory',
      handle: childDirHandle,
      parentHandle: undefined,
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
    const sortMode = ref<'name' | 'modified'>('name');

    const onError = vi.fn();
    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded: vi.fn(),
      getExpandedPaths: () => [],
      sanitizeHandle: (h) => h,
      sanitizeParentHandle: (h) => h,
      checkExistingProxies: vi.fn(async () => undefined),
      onError,
    });

    const noIter: any = { kind: 'directory', name: 'root', values: undefined, entries: undefined };
    const result = await service.readDirectory(noIter as FileSystemDirectoryHandle);

    expect(result).toEqual([]);
    expect(onError).toHaveBeenCalledWith({
      title: 'File manager error',
      message: 'Failed to read directory: iteration is not available',
    });
  });

  it('loadProjectDirectory merges entries and auto-expands media dirs', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'modified'>('name');

    const sourcesDir: any = {
      kind: 'directory',
      name: 'sources',
      values: () => createAsyncIterable([]),
    };
    const videoDir: any = {
      kind: 'directory',
      name: VIDEO_DIR_NAME,
      values: () => createAsyncIterable([]),
    };

    const projectDir = createDirHandleMock({ values: [sourcesDir, videoDir] });

    const setPathExpanded = vi.fn();

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: () => false,
      setPathExpanded,
      getExpandedPaths: () => [],
      sanitizeHandle: (h) => h,
      sanitizeParentHandle: (h) => h,
      checkExistingProxies: vi.fn(async () => undefined),
    });

    await service.loadProjectDirectory(projectDir);

    const names = rootEntries.value.map((e) => e.name);
    expect(new Set(names)).toEqual(new Set(['sources', VIDEO_DIR_NAME]));

    const videoEntry = rootEntries.value.find((e) => e.name === VIDEO_DIR_NAME);
    expect(videoEntry?.expanded).toBe(true);
  });

  it('expandPersistedDirectories expands saved paths and loads children', async () => {
    const rootEntries = ref<FsEntry[]>([]);
    const sortMode = ref<'name' | 'modified'>('name');

    const childFile = createFileHandleMock({ name: 'child.txt' });
    const nestedDirHandle = createDirHandleMock({ values: [childFile] });

    const folderHandle = createDirHandleMock({
      values: [
        { kind: 'directory', name: 'nested', values: () => createAsyncIterable([childFile]) },
      ],
    });

    const getExpandedPaths = () => ['folder/nested'];
    const setPathExpanded = vi.fn();

    const service = createFileManagerService({
      rootEntries,
      sortMode,
      showHiddenFiles: () => true,
      isPathExpanded: (path) => path === 'folder/nested',
      setPathExpanded,
      getExpandedPaths,
      sanitizeHandle: (h) => {
        if ((h as any).name === 'nested') return nestedDirHandle as any;
        return h;
      },
      sanitizeParentHandle: (h) => h,
      checkExistingProxies: vi.fn(async () => undefined),
      getDirectoryIterator: (dir) => {
        const rawValues = (dir as any).values?.();
        return rawValues ?? null;
      },
    });

    rootEntries.value = [
      {
        name: 'folder',
        kind: 'directory',
        handle: folderHandle,
        parentHandle: undefined,
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
