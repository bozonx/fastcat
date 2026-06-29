/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  folderHasVideos,
  generateUniqueFsEntryName,
  getWorkspaceFileHandle,
  isGeneratingProxyInDirectory,
} from '~/utils/fs';

const mockWorkspaceStore = {
  workspaceHandle: null as FileSystemDirectoryHandle | null,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

const createMockVfs = () => ({
  exists: vi.fn().mockResolvedValue(false),
});

describe('generateUniqueFsEntryName', () => {
  it('finds first unique name using existingNames', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: createMockVfs() as any,
      dirPath: '',
      baseName: 'test',
      extension: '.mp4',
      existingNames: ['test001.mp4'],
    });
    expect(result).toBe('test002.mp4');
  });

  it('returns first candidate when no conflicts', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: createMockVfs() as any,
      dirPath: '',
      baseName: 'clip',
      extension: '.mov',
      existingNames: [],
    });
    expect(result).toBe('clip001.mov');
  });

  it('respects custom startIndex and padWidth', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: createMockVfs() as any,
      dirPath: '',
      baseName: 'file',
      extension: '.txt',
      existingNames: ['file05.txt', 'file06.txt'],
      startIndex: 5,
      padWidth: 2,
    });
    expect(result).toBe('file07.txt');
  });

  it('does not fill gaps in existingNames', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: createMockVfs() as any,
      dirPath: '',
      baseName: 'item',
      extension: '.json',
      existingNames: ['item001.json', 'item003.json'],
    });
    expect(result).toBe('item004.json');
  });
});

describe('getWorkspaceFileHandle', () => {
  beforeEach(() => {
    mockWorkspaceStore.workspaceHandle = null;
  });

  it('returns null when workspace handle is unavailable', async () => {
    const result = await getWorkspaceFileHandle('/some/path.txt');
    expect(result).toBeNull();
  });

  it('resolves a file handle from the workspace root', async () => {
    const mockFileHandle = { kind: 'file' } as unknown as FileSystemFileHandle;
    const rootDir = {
      kind: 'directory',
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      getDirectoryHandle: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    mockWorkspaceStore.workspaceHandle = rootDir;

    const result = await getWorkspaceFileHandle('video.mp4');

    expect(result).toBe(mockFileHandle);
    expect(rootDir.getFileHandle).toHaveBeenCalledWith('video.mp4', { create: false });
  });

  it('traverses nested directories', async () => {
    const mockFileHandle = { kind: 'file' } as unknown as FileSystemFileHandle;
    const nestedDir = {
      kind: 'directory',
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      getDirectoryHandle: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    const rootDir = {
      kind: 'directory',
      getDirectoryHandle: vi.fn().mockResolvedValue(nestedDir),
    } as unknown as FileSystemDirectoryHandle;

    mockWorkspaceStore.workspaceHandle = rootDir;

    const result = await getWorkspaceFileHandle('projects/video.mp4');

    expect(rootDir.getDirectoryHandle).toHaveBeenCalledWith('projects', { create: false });
    expect(nestedDir.getFileHandle).toHaveBeenCalledWith('video.mp4', { create: false });
    expect(result).toBe(mockFileHandle);
  });

  it('creates directories and file when create option is true', async () => {
    const mockFileHandle = { kind: 'file' } as unknown as FileSystemFileHandle;
    const nestedDir = {
      kind: 'directory',
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      getDirectoryHandle: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    const rootDir = {
      kind: 'directory',
      getDirectoryHandle: vi.fn().mockResolvedValue(nestedDir),
    } as unknown as FileSystemDirectoryHandle;

    mockWorkspaceStore.workspaceHandle = rootDir;

    await getWorkspaceFileHandle('projects/video.mp4', { create: true });

    expect(rootDir.getDirectoryHandle).toHaveBeenCalledWith('projects', { create: true });
    expect(nestedDir.getFileHandle).toHaveBeenCalledWith('video.mp4', { create: true });
  });

  it('returns null when a directory in the path is missing', async () => {
    const rootDir = {
      kind: 'directory',
      getDirectoryHandle: vi.fn().mockRejectedValue(new Error('Not found')),
    } as unknown as FileSystemDirectoryHandle;

    mockWorkspaceStore.workspaceHandle = rootDir;

    const result = await getWorkspaceFileHandle('missing/file.txt');

    expect(result).toBeNull();
  });
});

describe('isGeneratingProxyInDirectory', () => {
  it('returns false for non-directory entries', () => {
    expect(isGeneratingProxyInDirectory({ kind: 'file', name: 'a.mp4', path: '/a.mp4' }, [])).toBe(
      false,
    );
  });

  it('returns true when proxy is in root directory', () => {
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'root', path: '' }, ['file.mp4']),
    ).toBe(true);
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'root', path: '' }, ['sub/file.mp4']),
    ).toBe(false);
  });

  it('returns true when proxy is direct child', () => {
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'media', path: '/media' }, [
        '/media/file.mp4',
      ]),
    ).toBe(true);
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'media', path: '/media' }, [
        '/media/sub/file.mp4',
      ]),
    ).toBe(false);
  });

  it('returns false when no proxies match', () => {
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'media', path: '/media' }, [
        '/other/file.mp4',
      ]),
    ).toBe(false);
  });
});

describe('folderHasVideos', () => {
  it('returns false for non-directory entries', () => {
    expect(folderHasVideos({ kind: 'file', name: 'a.mp4', path: '/a.mp4' })).toBe(false);
  });

  it('returns true when a direct child is a video', () => {
    expect(
      folderHasVideos({
        kind: 'directory',
        name: 'media',
        path: '/media',
        children: [
          { kind: 'file', name: 'clip.mp4', path: '/media/clip.mp4' },
          { kind: 'file', name: 'photo.jpg', path: '/media/photo.jpg' },
        ],
      }),
    ).toBe(true);
  });

  it('returns false when no video children', () => {
    expect(
      folderHasVideos({
        kind: 'directory',
        name: 'media',
        path: '/media',
        children: [
          { kind: 'file', name: 'photo.jpg', path: '/media/photo.jpg' },
          { kind: 'file', name: 'track.mp3', path: '/media/track.mp3' },
        ],
      }),
    ).toBe(false);
  });

  it('returns false for empty directory', () => {
    expect(
      folderHasVideos({ kind: 'directory', name: 'empty', path: '/empty', children: [] }),
    ).toBe(false);
  });
});
