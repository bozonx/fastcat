// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createProjectMetaRepository } from '../../../src/repositories/project-meta.repository';

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

    await projectDir.getDirectoryHandle('.gran', { create: true });
    const granDir = await projectDir.getDirectoryHandle('.gran', { create: true });
    const metaFile = await granDir.getFileHandle('project.meta.json', { create: true });
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
    expect(await repo.load()).toEqual({ id: 'abc' });
  });
});
