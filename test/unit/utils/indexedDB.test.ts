import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as indexedDb from '~/utils/indexed-db';
import * as repository from '~/repositories/workspace-handle.repository';

vi.mock('~/repositories/workspace-handle.repository', () => ({
  createIndexedDbWorkspaceHandleStorage: vi.fn(),
}));

describe('indexed-db', () => {
  const mockStorage = {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (repository.createIndexedDbWorkspaceHandleStorage as any).mockReturnValue(mockStorage);
    // Mock window.indexedDB
    if (!global.window) {
      (global as any).window = {};
    }
    global.window.indexedDB = {} as IDBFactory;
  });

  describe('saveWorkspaceHandleToIndexedDB', () => {
    it('saves handle using storage', async () => {
      const mockHandle = {} as FileSystemDirectoryHandle;
      await indexedDb.saveWorkspaceHandleToIndexedDB(mockHandle);

      expect(repository.createIndexedDbWorkspaceHandleStorage).toHaveBeenCalledWith({
        indexedDB: global.window.indexedDB,
      });
      expect(mockStorage.set).toHaveBeenCalledWith(mockHandle);
    });
  });

  describe('getWorkspaceHandleFromIndexedDB', () => {
    it('gets handle using storage', async () => {
      const mockHandle = {} as FileSystemDirectoryHandle;
      mockStorage.get.mockResolvedValueOnce(mockHandle);

      const result = await indexedDb.getWorkspaceHandleFromIndexedDB();

      expect(repository.createIndexedDbWorkspaceHandleStorage).toHaveBeenCalledWith({
        indexedDB: global.window.indexedDB,
      });
      expect(mockStorage.get).toHaveBeenCalled();
      expect(result).toBe(mockHandle);
    });
  });

  describe('clearWorkspaceHandleFromIndexedDB', () => {
    it('clears handle using storage', async () => {
      await indexedDb.clearWorkspaceHandleFromIndexedDB();

      expect(repository.createIndexedDbWorkspaceHandleStorage).toHaveBeenCalledWith({
        indexedDB: global.window.indexedDB,
      });
      expect(mockStorage.clear).toHaveBeenCalled();
    });
  });
});
