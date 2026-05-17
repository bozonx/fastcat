// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUiStore } from '~/stores/ui.store';

const mockProjectStore = {
  currentProjectId: 'p',
  projectSettings: {
    ui: {
      fileTreeExpandedPaths: [] as string[],
    },
  },
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

describe('ui.store file tree expanded paths', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    mockProjectStore.currentProjectId = 'p';
    mockProjectStore.projectSettings.ui.fileTreeExpandedPaths = [];
    vi.useFakeTimers();
  });

  it('removes descendants when collapsing a path', async () => {
    const ui = useUiStore();
    ui.restoreFileTreeStateOnce(); // Initialize context for 'p' (from mock)

    ui.setFileTreePathExpanded('a', true);
    ui.setFileTreePathExpanded('a/b', true);
    ui.setFileTreePathExpanded('a/b/c', true);
    ui.setFileTreePathExpanded('x', true);

    ui.setFileTreePathExpanded('a', false);

    expect(Object.keys(ui.fileTreeExpandedPaths)).toEqual(['x']);

    await vi.runAllTimersAsync();

    expect(new Set(mockProjectStore.projectSettings.ui.fileTreeExpandedPaths)).toEqual(
      new Set(['x']),
    );
  });

  it('isolates state between projects', async () => {
    const ui = useUiStore();

    // Project A
    mockProjectStore.currentProjectId = 'project-a';
    ui.restoreFileTreeStateOnce(); // Initialize context for Project A
    ui.setFileTreePathExpanded('folder-a', true);
    await vi.runAllTimersAsync();

    expect(mockProjectStore.projectSettings.ui.fileTreeExpandedPaths).toEqual(['folder-a']);

    // Project B
    mockProjectStore.currentProjectId = 'project-b';
    mockProjectStore.projectSettings.ui.fileTreeExpandedPaths = [];
    ui.restoreFileTreeStateOnce(); // Emulate context switch, should clear memory state

    expect(ui.fileTreeExpandedPaths).toEqual({});
    ui.setFileTreePathExpanded('folder-b', true);
    await vi.runAllTimersAsync();

    expect(mockProjectStore.projectSettings.ui.fileTreeExpandedPaths).toEqual(['folder-b']);
  });
});
