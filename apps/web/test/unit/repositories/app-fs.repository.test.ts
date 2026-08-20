// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createAppFsJsonStore } from '~/repositories/app-fs.repository';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

describe('app-fs.repository (AppFsJsonStore)', () => {
  it('readJson returns null when the file is missing', async () => {
    const store = createAppFsJsonStore(new InMemoryFileSystemAdapter());
    expect(await store.readJson('missing.json')).toBeNull();
  });

  it('readJson returns null on empty/whitespace content', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    await vfs.writeFile('empty.json', '   ');
    const store = createAppFsJsonStore(vfs);
    expect(await store.readJson('empty.json')).toBeNull();
  });

  it('writeJson + readJson round-trips an object', async () => {
    const store = createAppFsJsonStore(new InMemoryFileSystemAdapter());
    await store.writeJson('a.json', { a: 1 });
    expect(await store.readJson('a.json')).toEqual({ a: 1 });
  });

  it('round-trips large JSON payloads', async () => {
    const store = createAppFsJsonStore(new InMemoryFileSystemAdapter());
    await store.writeJson('big.json', { value: 'x'.repeat(600_000) });
    const value = await store.readJson<{ value: string }>('big.json');
    expect(value?.value).toHaveLength(600_000);
  });

  it('refuses to write undefined', async () => {
    const store = createAppFsJsonStore(new InMemoryFileSystemAdapter());
    await expect(store.writeJson('x.json', undefined)).rejects.toThrow();
  });
});
