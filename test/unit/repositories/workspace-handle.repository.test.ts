// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  createInMemoryWorkspaceHandleStorage,
} from '../../../src/repositories/workspace-handle.repository';

describe('workspace-handle.repository', () => {
  it('in memory storage: set/get/clear', async () => {
    const storage = createInMemoryWorkspaceHandleStorage<any>();

    expect(await storage.get()).toBeNull();

    await storage.set({ foo: 1 });
    expect(await storage.get()).toEqual({ foo: 1 });

    await storage.clear();
    expect(await storage.get()).toBeNull();
  });
});
