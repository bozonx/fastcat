// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createProjectMetaRepository } from '~/repositories/project-meta.repository';

function createFileHandleMock(input: { text: string }) {
  let bytes = new TextEncoder().encode(input.text);

  return {
    async getFile() {
      return {
        async text() {
          return new TextDecoder().decode(bytes);
        },
      };
    },
    async createWritable() {
      return {
        // The repository writes JSON in chunks: a `{ type: 'write', position, data }`
        // payload per chunk followed by a `truncate`. Accept both shapes.
        async write(data: string | { type: 'write'; position?: number; data: Uint8Array }) {
          if (typeof data === 'string') {
            bytes = new TextEncoder().encode(data);
            return;
          }
          const position = data.position ?? bytes.length;
          const nextLength = Math.max(bytes.length, position + data.data.length);
          const nextBytes = new Uint8Array(nextLength);
          nextBytes.set(bytes);
          nextBytes.set(data.data, position);
          bytes = nextBytes;
        },
        async truncate(size: number) {
          bytes = bytes.slice(0, size);
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
        const err: any = new Error('NotFound');
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
        const err: any = new Error('NotFound');
        err.name = 'NotFoundError';
        throw err;
      }
      const next = createFileHandleMock({ text: '' });
      files.set(name, next);
      return next;
    },
  };
}

describe('project-meta.repository', () => {
  it('returns null on missing file', async () => {
    const projectDir = createDirMock();
    const repo = createProjectMetaRepository({ projectDir: projectDir as any });

    expect(await repo.load()).toBeNull();
  });

  it('returns null on invalid data', async () => {
    const projectDir: any = createDirMock();

    await projectDir.getDirectoryHandle('.fastcat', { create: true });
    const fastcatDir = await projectDir.getDirectoryHandle('.fastcat', { create: true });
    const metaFile = await fastcatDir.getFileHandle('project.meta.json', { create: true });
    const writable = await metaFile.createWritable();
    await writable.write('{"id": 123}');
    await writable.close();

    const repo = createProjectMetaRepository({ projectDir });
    expect(await repo.load()).toBeNull();
  });

  it('saves and loads meta', async () => {
    const projectDir = createDirMock();
    const repo = createProjectMetaRepository({ projectDir: projectDir as any });

    await repo.save({ id: 'abc' });
    await expect(repo.load()).resolves.toEqual({
      id: 'abc',
      version: 1,
      title: '',
      description: '',
      author: '',
      tags: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      lastOpenedTimelinePath: undefined,
    });
  });
});
