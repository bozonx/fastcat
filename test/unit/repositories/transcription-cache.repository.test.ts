// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTranscriptionCacheRepository } from '../../../src/repositories/transcription-cache.repository';

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
  const files = new Map<string, any>();
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
      const next = createFileHandleMock({ text: '' });
      files.set(name, next);
      return next;
    },
  };
}

describe('transcription-cache.repository', () => {
  it('returns null when cache record is missing', async () => {
    const workspaceDir = createDirMock();
    const repo = createTranscriptionCacheRepository({
      workspaceDir: workspaceDir as any,
      projectId: 'project-1',
    });

    expect(await repo.load('missing')).toBeNull();
  });

  it('saves and loads transcription cache record', async () => {
    const workspaceDir = createDirMock();
    const repo = createTranscriptionCacheRepository({
      workspaceDir: workspaceDir as any,
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
});
