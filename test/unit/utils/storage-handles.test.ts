/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  ensureDirectoryChain,
  resolveStorageRootHandle,
  ensureProjectStorageDir,
  ensureResolvedProjectTempDir,
  ensureResolvedProjectThumbnailsDir,
  ensureResolvedProjectProxiesDir,
} from '~/utils/storage-handles';
import type { DirectoryHandleLike } from '~/repositories/app-fs.repository';

function makeHandle(getDirectoryHandle?: ReturnType<typeof vi.fn>): DirectoryHandleLike {
  const fn =
    getDirectoryHandle ?? vi.fn(async (name: string): Promise<DirectoryHandleLike> => makeHandle());
  return {
    name: 'root',
    kind: 'directory',
    getDirectoryHandle: fn,
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(),
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
  } as unknown as DirectoryHandleLike;
}

describe('storage-handles', () => {
  describe('ensureDirectoryChain', () => {
    it('traverses segments calling getDirectoryHandle', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const base = makeHandle(fn);
      const result = await ensureDirectoryChain({
        baseDir: base,
        segments: ['a', 'b', 'c'],
      });
      expect(fn).toHaveBeenCalledTimes(3);
      expect(fn).toHaveBeenNthCalledWith(1, 'a', { create: undefined });
      expect(fn).toHaveBeenNthCalledWith(2, 'b', { create: undefined });
      expect(fn).toHaveBeenNthCalledWith(3, 'c', { create: undefined });
      expect(result).toBeDefined();
    });

    it('returns baseDir when segments is empty', async () => {
      const base = makeHandle();
      const result = await ensureDirectoryChain({
        baseDir: base,
        segments: [],
      });
      expect(result).toBe(base);
    });

    it('passes create option', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const base = makeHandle(fn);
      await ensureDirectoryChain({
        baseDir: base,
        segments: ['dir'],
        create: true,
      });
      expect(fn).toHaveBeenCalledWith('dir', { create: true });
    });
  });

  describe('resolveStorageRootHandle', () => {
    it('returns workspaceHandle when rootPath is empty', async () => {
      const ws = makeHandle();
      const result = await resolveStorageRootHandle({
        workspaceHandle: ws,
        rootPath: '',
      });
      expect(result).toBe(ws);
    });

    it('returns workspaceHandle when rootPath is whitespace', async () => {
      const ws = makeHandle();
      const result = await resolveStorageRootHandle({
        workspaceHandle: ws,
        rootPath: '   ',
      });
      expect(result).toBe(ws);
    });

    it('traverses relative path segments', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await resolveStorageRootHandle({
        workspaceHandle: ws,
        rootPath: 'temp/projects',
      });
      expect(fn).toHaveBeenCalledWith('temp', { create: undefined });
      expect(fn).toHaveBeenCalledWith('projects', { create: undefined });
    });
  });

  describe('ensureProjectStorageDir', () => {
    it('creates projects/projectId/leaf chain', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await ensureProjectStorageDir({
        workspaceHandle: ws,
        rootPath: '',
        projectId: 'proj-1',
        leafSegments: ['thumbnails'],
        create: true,
      });
      // segments: projects, proj-1, thumbnails
      expect(fn).toHaveBeenCalledWith('projects', { create: true });
      expect(fn).toHaveBeenCalledWith('proj-1', { create: true });
      expect(fn).toHaveBeenCalledWith('thumbnails', { create: true });
    });
  });

  describe('ensureResolvedProjectTempDir', () => {
    it('delegates to ensureProjectStorageDir with tempRoot', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await ensureResolvedProjectTempDir({
        workspaceHandle: ws,
        topology: { tempRoot: 'temp', proxiesRoot: '' } as any,
        projectId: 'proj-1',
        leafSegments: ['cache'],
        create: true,
      });
      // First traverses temp, then projects, proj-1, cache
      expect(fn).toHaveBeenCalledWith('temp', { create: true });
      expect(fn).toHaveBeenCalledWith('projects', { create: true });
      expect(fn).toHaveBeenCalledWith('proj-1', { create: true });
      expect(fn).toHaveBeenCalledWith('cache', { create: true });
    });

    it('uses empty leafSegments by default', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await ensureResolvedProjectTempDir({
        workspaceHandle: ws,
        topology: { tempRoot: '', proxiesRoot: '' } as any,
        projectId: 'proj-1',
        create: false,
      });
      // segments: projects, proj-1
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('ensureResolvedProjectThumbnailsDir', () => {
    it('creates thumbnails subdirectory', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await ensureResolvedProjectThumbnailsDir({
        workspaceHandle: ws,
        topology: { tempRoot: '', proxiesRoot: '' } as any,
        projectId: 'proj-1',
        create: true,
      });
      // segments: projects, proj-1, thumbnails
      expect(fn).toHaveBeenCalledWith('thumbnails', { create: true });
    });

    it('creates subDir under thumbnails when provided', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await ensureResolvedProjectThumbnailsDir({
        workspaceHandle: ws,
        topology: { tempRoot: '', proxiesRoot: '' } as any,
        projectId: 'proj-1',
        subDir: 'video',
        create: true,
      });
      // segments: projects, proj-1, thumbnails, video
      expect(fn).toHaveBeenCalledWith('thumbnails', { create: true });
      expect(fn).toHaveBeenCalledWith('video', { create: true });
    });
  });

  describe('ensureResolvedProjectProxiesDir', () => {
    it('falls back to tempDir/proxies when proxiesRoot is empty', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await ensureResolvedProjectProxiesDir({
        workspaceHandle: ws,
        topology: { tempRoot: '', proxiesRoot: '' } as any,
        projectId: 'proj-1',
        create: true,
      });
      // segments: projects, proj-1, proxies
      expect(fn).toHaveBeenCalledWith('proxies', { create: true });
    });

    it('uses proxiesRoot when set', async () => {
      const fn = vi.fn(async (name: string) => makeHandle(fn));
      const ws = makeHandle(fn);
      await ensureResolvedProjectProxiesDir({
        workspaceHandle: ws,
        topology: { tempRoot: '', proxiesRoot: 'proxies' } as any,
        projectId: 'proj-1',
        create: true,
      });
      // segments: proxies, projects, proj-1
      expect(fn).toHaveBeenCalledWith('proxies', { create: true });
      expect(fn).toHaveBeenCalledWith('projects', { create: true });
      expect(fn).toHaveBeenCalledWith('proj-1', { create: true });
    });
  });
});
