// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { getWorkspaceFileHandle } from '~/utils/workspace-fs';

const mockWorkspaceStore = {
  workspaceHandle: null as FileSystemDirectoryHandle | null,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

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

  it('creatates directories and file when create option is true', async () => {
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
