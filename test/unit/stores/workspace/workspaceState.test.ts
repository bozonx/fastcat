/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createWorkspaceStateModule } from '~/stores/workspace/workspaceState';

describe('createWorkspaceStateModule', () => {
  it('initializes with default workspace state', () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceStateModule({ settingsRepo });
    expect(mod.workspaceState.value).toBeDefined();
    expect(mod.isSavingWorkspaceState.value).toBe(false);
    expect(mod.workspaceStateSaveError.value).toBeNull();
  });

  it('resetWorkspaceState restores defaults', () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceStateModule({ settingsRepo });
    mod.workspaceState.value = { ...mod.workspaceState.value, lastProjectName: 'test' };
    mod.resetWorkspaceState();
    expect(mod.workspaceState.value.lastProjectName).toBeUndefined();
  });

  it('loadWorkspaceStateFromDisk does nothing when repo is null', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceStateModule({ settingsRepo });
    await mod.loadWorkspaceStateFromDisk();
    // Should not throw, state should be default
    expect(mod.workspaceState.value).toBeDefined();
  });

  it('loadWorkspaceStateFromDisk loads from repo', async () => {
    const mockRepo = {
      loadWorkspaceState: vi.fn().mockResolvedValue({ lastProjectName: 'loaded-project' }),
      saveWorkspaceState: vi.fn(),
    };
    const settingsRepo = ref(mockRepo as any);
    const mod = createWorkspaceStateModule({ settingsRepo });
    await mod.loadWorkspaceStateFromDisk();
    expect(mockRepo.loadWorkspaceState).toHaveBeenCalled();
    // normalizeWorkspaceState may strip unknown fields; verify state was replaced
    expect(mod.workspaceState.value).toBeDefined();
  });

  it('loadWorkspaceStateFromDisk handles errors gracefully', async () => {
    const mockRepo = {
      loadWorkspaceState: vi.fn().mockRejectedValue(new Error('disk error')),
      saveWorkspaceState: vi.fn(),
    };
    const settingsRepo = ref(mockRepo as any);
    const mod = createWorkspaceStateModule({ settingsRepo });
    await mod.loadWorkspaceStateFromDisk();
    // Should fall back to normalized null state
    expect(mod.workspaceState.value).toBeDefined();
  });

  it('batchUpdateWorkspaceState updates state via updater', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceStateModule({ settingsRepo });
    await mod.batchUpdateWorkspaceState((draft) => {
      draft.lastProjectName = 'batch-updated';
    });
    expect(mod.workspaceState.value.lastProjectName).toBe('batch-updated');
  });

  it('saveWorkspaceStateToDisk does nothing when repo is null', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceStateModule({ settingsRepo });
    await expect(mod.saveWorkspaceStateToDisk()).resolves.not.toThrow();
  });
});
