// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUiStore } from '~/stores/ui.store';

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    currentProjectId: 'p',
  }),
}));

describe('ui.store file tree expanded paths', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('removes descendants when collapsing a path', async () => {
    const ui = useUiStore();

    ui.setFileTreePathExpanded('a', true);
    ui.setFileTreePathExpanded('a/b', true);
    ui.setFileTreePathExpanded('a/b/c', true);
    ui.setFileTreePathExpanded('x', true);

    ui.setFileTreePathExpanded('a', false);

    expect(Object.keys(ui.fileTreeExpandedPaths)).toEqual(['x']);

    vi.runAllTimers();

    const raw = localStorage.getItem('fastcat:ui:file-tree:p');
    expect(raw).toBeTypeOf('string');
    const parsed = JSON.parse(raw!);
    expect(new Set(parsed.expandedPaths)).toEqual(new Set(['x']));
  });
});
