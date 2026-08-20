/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { createProjectFsModule } from '~/stores/project/project-fs';

vi.mock('~/utils/workspace-common', () => ({
  isWorkspaceCommonPath: vi.fn((p: string) => p.startsWith('@common/')),
  normalizeWorkspaceFilePath: vi.fn((p: string) => p.replace(/^\.?\//, '')),
  stripWorkspaceCommonPathPrefix: vi.fn((p: string) => p.replace(/^@common\//, '')),
  toWorkspaceCommonPath: vi.fn((p: string) => p),
}));

vi.mock('~/utils/storage-roots', () => ({
  getWorkspaceStorageTopology: () => ({
    commonDirName: 'common',
    tempRootDirName: 'temp',
    tempProjectsDirName: 'projects',
    proxiesRootDirName: 'proxies',
  }),
}));

vi.mock('~/utils/io/io-governor', () => ({
  withFileIoSlot: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('~/file-manager/core/vfs/errors', () => ({
  VfsNotFoundError: class VfsNotFoundError extends Error {},
}));

function makeVfs() {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteEntry: vi.fn(),
    listEntryNames: vi.fn(),
    exists: vi.fn(),
    getMetadata: vi.fn(),
    readDirectory: vi.fn(),
    moveEntry: vi.fn(),
    copyDirectory: vi.fn(),
  };
}

describe('createProjectFsModule', () => {
  it('toProjectRelativePath normalizes paths', () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    expect(mod.toProjectRelativePath('/test/file.txt')).toBe('test/file.txt');
  });

  it('getProjectDirHandle returns currentProjectDirHandle when set', async () => {
    const vfs = makeVfs();
    const dirHandle = { name: 'proj' } as any;
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(dirHandle),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.getProjectDirHandle();
    expect(result).toStrictEqual(dirHandle);
  });

  it('getProjectDirHandle returns null when no project name', async () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    const result = await mod.getProjectDirHandle();
    expect(result).toBeNull();
  });

  it('readTextByPath returns null for empty path', async () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    const result = await mod.readTextByPath('');
    expect(result).toBeNull();
    expect(vfs.readFile).not.toHaveBeenCalled();
  });

  it('readTextByPath reads from VFS', async () => {
    const vfs = makeVfs();
    vfs.readFile.mockResolvedValue(new Blob(['hello world']));
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.readTextByPath('test.txt');
    expect(result).toBe('hello world');
  });

  it('readTextByPath returns null for whitespace-only content', async () => {
    const vfs = makeVfs();
    vfs.readFile.mockResolvedValue(new Blob(['   \n\t  ']));
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.readTextByPath('test.txt');
    expect(result).toBeNull();
  });

  it('writeTextByPath writes to VFS', async () => {
    const vfs = makeVfs();
    vfs.writeFile.mockResolvedValue(undefined);
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    await mod.writeTextByPath('test.txt', 'content');
    expect(vfs.writeFile).toHaveBeenCalledWith('test.txt', 'content');
  });

  it('writeTextByPath throws for empty path', async () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    await expect(mod.writeTextByPath('', 'content')).rejects.toThrow();
  });

  it('writeFileByPath writes binary data to VFS', async () => {
    const vfs = makeVfs();
    vfs.writeFile.mockResolvedValue(undefined);
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const data = new Uint8Array([1, 2, 3]);
    await mod.writeFileByPath('data.bin', data);
    expect(vfs.writeFile).toHaveBeenCalledWith('data.bin', data);
  });

  it('deleteByPath calls VFS deleteEntry', async () => {
    const vfs = makeVfs();
    vfs.deleteEntry.mockResolvedValue(undefined);
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    await mod.deleteByPath('test.txt', { recursive: true });
    expect(vfs.deleteEntry).toHaveBeenCalledWith('test.txt', true);
  });

  it('deleteByPath does nothing for empty path', async () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    await mod.deleteByPath('');
    expect(vfs.deleteEntry).not.toHaveBeenCalled();
  });

  it('listEntryNames returns entries from VFS', async () => {
    const vfs = makeVfs();
    vfs.listEntryNames.mockResolvedValue(['a.txt', 'b.txt']);
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.listEntryNames('dir');
    expect(result).toEqual(['a.txt', 'b.txt']);
  });

  it('listEntryNames returns [] for empty path', async () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    const result = await mod.listEntryNames('');
    expect(result).toEqual([]);
  });

  it('listEntryNames returns [] on VFS error', async () => {
    const vfs = makeVfs();
    vfs.listEntryNames.mockRejectedValue(new Error('VFS error'));
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.listEntryNames('dir');
    expect(result).toEqual([]);
  });

  it('pathExists checks VFS exists', async () => {
    const vfs = makeVfs();
    vfs.exists.mockResolvedValue(true);
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.pathExists('test.txt');
    expect(result).toBe(true);
    expect(vfs.exists).toHaveBeenCalledWith('test.txt');
  });

  it('pathExists returns false for empty path', async () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    const result = await mod.pathExists('');
    expect(result).toBe(false);
  });

  it('getFileMetadata returns metadata for files', async () => {
    const vfs = makeVfs();
    vfs.getMetadata.mockResolvedValue({
      kind: 'file',
      lastModified: 1234567890,
      size: 1024,
    });
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.getFileMetadata('test.txt');
    expect(result).toEqual({ lastModified: 1234567890, size: 1024 });
  });

  it('getFileMetadata returns null for directories', async () => {
    const vfs = makeVfs();
    vfs.getMetadata.mockResolvedValue({ kind: 'directory' });
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref('proj'),
      getVfs: () => vfs as any,
    });
    const result = await mod.getFileMetadata('dir');
    expect(result).toBeNull();
  });

  it('getFileMetadata returns null for empty path', async () => {
    const vfs = makeVfs();
    const mod = createProjectFsModule({
      workspaceHandle: ref(null),
      projectsHandle: ref(null),
      currentProjectDirHandle: ref(null),
      currentProjectName: ref(null),
      getVfs: () => vfs as any,
    });
    const result = await mod.getFileMetadata('');
    expect(result).toBeNull();
  });
});
