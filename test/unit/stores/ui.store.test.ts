// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUiStore } from '~/stores/ui.store';

const mockProjectStore = {
  currentProjectId: 'p',
  projectSettings: {
    ui: {},
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
    vi.useFakeTimers();
  });

  it('removes descendants when collapsing a path', () => {
    const ui = useUiStore();
    ui.restoreFileTreeStateOnce();

    ui.setFileTreePathExpanded('a', true);
    ui.setFileTreePathExpanded('a/b', true);
    ui.setFileTreePathExpanded('a/b/c', true);
    ui.setFileTreePathExpanded('x', true);

    ui.setFileTreePathExpanded('a', false);

    expect(Object.keys(ui.fileTreeExpandedPaths)).toEqual(['x']);
  });

  it('isolates in-memory state between projects', () => {
    const ui = useUiStore();

    mockProjectStore.currentProjectId = 'project-a';
    ui.restoreFileTreeStateOnce();
    ui.setFileTreePathExpanded('folder-a', true);
    expect(Object.keys(ui.fileTreeExpandedPaths)).toEqual(['folder-a']);

    mockProjectStore.currentProjectId = 'project-b';
    ui.restoreFileTreeStateOnce();
    expect(ui.fileTreeExpandedPaths).toEqual({});

    ui.setFileTreePathExpanded('folder-b', true);
    expect(Object.keys(ui.fileTreeExpandedPaths)).toEqual(['folder-b']);
  });
});
