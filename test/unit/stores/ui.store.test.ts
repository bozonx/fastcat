// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUiStore } from '~/stores/ui.store';

const mockProjectStore = {
  currentProjectId: 'p',
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

describe('ui.store file tree expanded paths', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
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

    const raw = localStorage.getItem('fastcat:ui:file-tree:p');
    expect(raw).toBeTypeOf('string');
    const parsed = JSON.parse(raw!);
    expect(new Set(parsed.expandedPaths)).toEqual(new Set(['x']));
  });

  it('isolates state between projects', async () => {
    const ui = useUiStore();

    // Project A
    mockProjectStore.currentProjectId = 'project-a';
    ui.restoreFileTreeStateOnce(); // Initialize context for Project A
    ui.setFileTreePathExpanded('folder-a', true);
    await vi.runAllTimersAsync();
    
    const rawA = localStorage.getItem('fastcat:ui:file-tree:project-a');
    expect(rawA).not.toBeNull();
    expect(rawA).toContain('folder-a');

    // Project B
    mockProjectStore.currentProjectId = 'project-b';
    ui.restoreFileTreeStateOnce(); // Emulate context switch, should clear memory state
    
    expect(ui.fileTreeExpandedPaths).toEqual({});
    ui.setFileTreePathExpanded('folder-b', true);
    await vi.runAllTimersAsync();
    
    const rawB = localStorage.getItem('fastcat:ui:file-tree:project-b');
    expect(rawB).not.toBeNull();
    expect(rawB).toContain('folder-b');
    
    const rawA_final = localStorage.getItem('fastcat:ui:file-tree:project-a');
    expect(rawA_final).toContain('folder-a');
    expect(rawA_final).not.toContain('folder-b');
  });
});
