// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createProjectMetaRepository } from '~/repositories/project-meta.repository';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

describe('project-meta.repository', () => {
  it('returns null on missing file', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    const repo = createProjectMetaRepository({ vfs });

    expect(await repo.load()).toBeNull();
  });

  it('returns null on invalid data', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    await vfs.writeFile('.fastcat/project.meta.json', '{"id": 123}');

    const repo = createProjectMetaRepository({ vfs });
    expect(await repo.load()).toBeNull();
  });

  it('saves and loads meta', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    const repo = createProjectMetaRepository({ vfs });

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
