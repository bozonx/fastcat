// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTranscriptionCacheRepository } from '../../../src/repositories/transcription-cache.repository';
import type { ResolvedStorageTopology } from '../../../src/utils/storage-topology';

interface FileHandleWithMeta {
  kind: 'file';
  name: string;
  getFile: () => Promise<{ text: () => Promise<string> }>;
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

function createFileHandleMock(input: { text: string }) {
  let text = input.text;
  return {
    async getFile() {
      return {
        async text() {
          return text;
        },
      };
    },
    async createWritable() {
      return {
        async write(data: string) {
          text = data;
        },
        async close() {
          // no-op
        },
      };
    },
  };
}

function createDirMock() {
  const files = new Map<string, FileHandleWithMeta>();
  const dirs = new Map<string, any>();

  return {
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      if (dirs.has(name)) return dirs.get(name);
      if (!options?.create) {
        const err = new Error('NotFound') as Error & { name: string };
        err.name = 'NotFoundError';
        throw err;
      }
      const next = createDirMock();
      dirs.set(name, next);
      return next;
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (files.has(name)) return files.get(name);
      if (!options?.create) {
        const err = new Error('NotFound') as Error & { name: string };
        err.name = 'NotFoundError';
        throw err;
      }
      const next = {
        kind: 'file' as const,
        name,
        ...createFileHandleMock({ text: '' }),
      };
      files.set(name, next);
      return next;
    },
    async *values() {
      for (const handle of files.values()) {
        yield handle;
      }
    },
  };
}

const topology: ResolvedStorageTopology = {
  projectsRoot: 'projects',
  commonRoot: 'common',
  dataRoot: 'data',
  tempRoot: 'temp',
  proxiesRoot: 'proxies',
  ephemeralTmpRoot: 'tmp',
};

describe('transcription-cache.repository', () => {
  it('returns null when cache record is missing', async () => {
    const workspaceDir = createDirMock();
    const repo = createTranscriptionCacheRepository({
      workspaceDir: workspaceDir as any,
      topology,
      projectId: 'project-1',
    });

    expect(await repo.load('missing')).toBeNull();
  });

  it('saves and loads transcription cache record', async () => {
    const workspaceDir = createDirMock();
    const repo = createTranscriptionCacheRepository({
      workspaceDir: workspaceDir as any,
      topology,
      projectId: 'project-1',
    });

    await repo.save({
      key: 'cache-key',
      createdAt: '2026-03-07T00:00:00.000Z',
      sourcePath: 'audio/voice.mp3',
      sourceName: 'voice.mp3',
      sourceSize: 123,
      sourceLastModified: 456,
      language: 'en',
      provider: 'assemblyai',
      models: ['universal-3-pro'],
      response: { text: 'hello world' },
    });

    await expect(repo.load('cache-key')).resolves.toEqual({
      key: 'cache-key',
      createdAt: '2026-03-07T00:00:00.000Z',
      sourcePath: 'audio/voice.mp3',
      sourceName: 'voice.mp3',
      sourceSize: 123,
      sourceLastModified: 456,
      language: 'en',
      provider: 'assemblyai',
      models: ['universal-3-pro'],
      response: { text: 'hello world' },
    });
  });

  it('lists saved transcription cache records ordered by createdAt desc', async () => {
    const workspaceDir = createDirMock();
    const repo = createTranscriptionCacheRepository({
      workspaceDir: workspaceDir as any,
      topology,
      projectId: 'project-1',
    });

    await repo.save({
      key: 'first',
      createdAt: '2026-03-07T00:00:00.000Z',
      sourcePath: 'audio/first.mp3',
      sourceName: 'first.mp3',
      sourceSize: 1,
      sourceLastModified: 1,
      language: 'en',
      provider: 'assemblyai',
      models: [],
      response: { text: 'first' },
    });
    await repo.save({
      key: 'second',
      createdAt: '2026-03-08T00:00:00.000Z',
      sourcePath: 'audio/second.mp3',
      sourceName: 'second.mp3',
      sourceSize: 2,
      sourceLastModified: 2,
      language: 'ru',
      provider: 'assemblyai',
      models: [],
      response: { text: 'second' },
    });

    await expect(repo.list()).resolves.toMatchObject([
      { key: 'second', sourceName: 'second.mp3' },
      { key: 'first', sourceName: 'first.mp3' },
    ]);
  });
});
