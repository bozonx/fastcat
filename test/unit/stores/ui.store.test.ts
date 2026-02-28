// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUiStore } from '../../../src/stores/ui.store';

describe('ui.store file tree expanded paths', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('removes descendants when collapsing a path', async () => {
    const ui = useUiStore();

    ui.setFileTreePathExpanded('p', 'a', true);
    ui.setFileTreePathExpanded('p', 'a/b', true);
    ui.setFileTreePathExpanded('p', 'a/b/c', true);
    ui.setFileTreePathExpanded('p', 'x', true);

    ui.setFileTreePathExpanded('p', 'a', false);

    expect(Object.keys(ui.fileTreeExpandedPaths)).toEqual(['x']);

    vi.runAllTimers();

    const raw = localStorage.getItem('gran-video-editor:file-tree:p');
    expect(raw).toBeTypeOf('string');
    const parsed = JSON.parse(raw!);
    expect(new Set(parsed.expandedPaths)).toEqual(new Set(['x']));
  });
});
