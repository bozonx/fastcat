/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterFileSystemAdapter } from '~/file-manager/core/vfs/router.adapter';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

const mocks = vi.hoisted(() => ({
  addTask: vi.fn(() => 'copy-task'),
  updateTaskProgress: vi.fn(),
  updateTaskStatus: vi.fn(),
  notifyFileManagerUpdate: vi.fn(),
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => ({
    addTask: mocks.addTask,
    updateTaskProgress: mocks.updateTaskProgress,
    updateTaskStatus: mocks.updateTaskStatus,
  }),
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({
    notifyFileManagerUpdate: mocks.notifyFileManagerUpdate,
  }),
}));

function createAdapter(overrides: Partial<IFileSystemAdapter>): IFileSystemAdapter {
  return {
    id: 'adapter',
    init: vi.fn(),
    readDirectory: vi.fn(),
    createDirectory: vi.fn(),
    listEntryNames: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteEntry: vi.fn(),
    moveEntry: vi.fn(),
    copyFile: vi.fn(),
    copyDirectory: vi.fn(),
    exists: vi.fn(),
    getMetadata: vi.fn(),
    getObjectUrl: vi.fn(),
    getFile: vi.fn(),
    readStream: vi.fn(),
    writeStream: vi.fn(),
    writeJson: vi.fn(),
    readJson: vi.fn(),
    getParentPath: vi.fn(),
    getName: vi.fn(),
    joinPath: vi.fn(),
    normalizePath: vi.fn(),
    ...overrides,
  } as IFileSystemAdapter;
}

describe('RouterFileSystemAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers cancellable background tasks for large cross-adapter copies', async () => {
    const source = createAdapter({
      getMetadata: vi.fn(async () => ({
        size: 11 * 1024 * 1024,
        lastModified: 1,
        kind: 'file',
      })),
      readStream: vi.fn(
        async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              controller.close();
            },
          }),
      ),
    });
    const target = createAdapter({
      writeStream: vi.fn(
        async () =>
          new WritableStream<Uint8Array>({
            write: vi.fn(),
          }),
      ),
    });
    const router = new RouterFileSystemAdapter(source, [
      {
        prefix: '/target',
        adapter: target,
        stripPrefix: (path) => path.replace(/^\/target\/?/, ''),
      },
    ]);

    const controller = new AbortController();
    controller.abort();

    await expect(
      router.copyFile('/source.mp4', '/target/source.mp4', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        cancel: expect.any(Function),
      }),
    );
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      'copy-task',
      'cancelled',
      expect.any(String),
    );
  });

  it('matches routes by full path segment boundaries', async () => {
    const defaultAdapter = createAdapter({
      exists: vi.fn(async () => true),
    });
    const routedAdapter = createAdapter({
      id: 'routed',
      exists: vi.fn(async () => false),
    });
    const router = new RouterFileSystemAdapter(defaultAdapter, [
      {
        prefix: '@common',
        adapter: routedAdapter,
        stripPrefix: (path) => path.replace(/^@common\/?/, ''),
      },
    ]);

    await expect(router.exists('@common/file.txt')).resolves.toBe(false);
    await expect(router.exists('@common2/file.txt')).resolves.toBe(true);
    expect(routedAdapter.exists).toHaveBeenCalledWith('file.txt');
    expect(defaultAdapter.exists).toHaveBeenCalledWith('@common2/file.txt');
  });
});
