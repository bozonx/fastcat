/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createDefaultWorkspaceState, normalizeWorkspaceState } from '~/utils/workspace-state';

describe('workspace-state', () => {
  it('creates default state', () => {
    const state = createDefaultWorkspaceState();
    expect(state.presets.custom).toEqual([]);
    expect(state.ui.recentSearchQueries).toEqual([]);
    expect(state.fileBrowser.activeTab).toBe('computer');
  });

  it('returns defaults for null input', () => {
    const state = normalizeWorkspaceState(null);
    expect(state.presets.custom).toEqual([]);
    expect(state.fileBrowser.activeTab).toBe('computer');
  });

  it('preserves partial valid data', () => {
    const state = normalizeWorkspaceState({
      ui: { recentProjects: [{ projectName: 'p1', projectId: 'id1', updatedAt: '2024-01-01' }] },
      fileBrowser: { activeTab: 'bloggerdog' },
    });
    expect(state.ui.recentProjects).toHaveLength(1);
    expect(state.fileBrowser.activeTab).toBe('bloggerdog');
  });

  it('migrates legacy global showHiddenFiles to per-instance defaults', () => {
    const state = normalizeWorkspaceState({
      ui: { showHiddenFiles: true },
      fileBrowser: {
        instances: {
          main: { viewMode: 'list' },
        },
      },
    });
    // Legacy global flag is propagated to instances that lack their own value.
    expect(state.fileBrowser.instances.main.showHiddenFiles).toBe(true);
  });

  it('normalizes file browser instances', () => {
    const state = normalizeWorkspaceState({
      fileBrowser: {
        instances: {
          main: { viewMode: 'list', gridCardSize: 100, columnWidths: { name: 300 } },
        },
      },
    });
    expect(state.fileBrowser.instances.main.viewMode).toBe('list');
    expect(state.fileBrowser.instances.main.gridCardSize).toBe(100);
  });
});
