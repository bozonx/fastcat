/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createUiFileTreePersistenceModule } from '~/stores/ui/uiFileTreePersistence';

describe('createUiFileTreePersistenceModule', () => {
  it('initializes with empty expanded paths', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    expect(mod.fileTreeExpandedPaths.value).toEqual({});
  });

  it('isFileTreePathExpanded returns false for unknown path', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    expect(mod.isFileTreePathExpanded('/unknown')).toBe(false);
  });

  it('isFileTreePathExpanded returns true for known path', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({ '/known': true });
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    expect(mod.isFileTreePathExpanded('/known')).toBe(true);
  });

  it('setFileTreePathExpanded adds path when expanded', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    mod.setFileTreePathExpanded('proj-1', '/path', true);
    expect(mod.fileTreeExpandedPaths.value['/path']).toBe(true);
  });

  it('setFileTreePathExpanded does nothing for empty path', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    mod.setFileTreePathExpanded('proj-1', '', true);
    expect(mod.fileTreeExpandedPaths.value).toEqual({});
  });

  it('setFileTreePathExpanded removes path and children when collapsed', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({
      '/parent': true,
      '/parent/child': true,
      '/parent/child/grandchild': true,
      '/other': true,
    });
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    mod.setFileTreePathExpanded('proj-1', '/parent', false);
    expect(mod.fileTreeExpandedPaths.value).not.toHaveProperty('/parent');
    expect(mod.fileTreeExpandedPaths.value).not.toHaveProperty('/parent/child');
    expect(mod.fileTreeExpandedPaths.value).not.toHaveProperty('/parent/child/grandchild');
    expect(mod.fileTreeExpandedPaths.value).toHaveProperty('/other');
  });

  it('setFileTreePathExpanded does nothing when collapsing already-collapsed path', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    mod.setFileTreePathExpanded('proj-1', '/path', false);
    expect(mod.fileTreeExpandedPaths.value).toEqual({});
  });

  it('setFileTreePathExpanded does nothing when expanding already-expanded path', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({ '/path': true });
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    mod.setFileTreePathExpanded('proj-1', '/path', true);
    // Should still have the path, no duplicates
    expect(mod.fileTreeExpandedPaths.value).toEqual({ '/path': true });
  });

  it('hasPersistedFileTreeState returns false when no state', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const mod = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
    expect(mod.hasPersistedFileTreeState('proj-1')).toBe(false);
  });

  it('hasPersistedFileTreeState returns true when loadExpandedPaths returns data', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const loadExpandedPaths = vi.fn(() => ['/path']);
    const mod = createUiFileTreePersistenceModule({
      fileTreeExpandedPaths,
      loadExpandedPaths,
    });
    expect(mod.hasPersistedFileTreeState('proj-1')).toBe(true);
  });

  it('restoreFileTreeStateOnce loads paths from loadExpandedPaths', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const loadExpandedPaths = vi.fn(() => ['/path1', '/path2']);
    const mod = createUiFileTreePersistenceModule({
      fileTreeExpandedPaths,
      loadExpandedPaths,
    });
    mod.restoreFileTreeStateOnce('proj-1');
    expect(fileTreeExpandedPaths.value).toEqual({ '/path1': true, '/path2': true });
  });

  it('restoreFileTreeStateOnce does not reload for same project', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const loadExpandedPaths = vi.fn(() => ['/path1']);
    const mod = createUiFileTreePersistenceModule({
      fileTreeExpandedPaths,
      loadExpandedPaths,
    });
    mod.restoreFileTreeStateOnce('proj-1');
    mod.restoreFileTreeStateOnce('proj-1');
    expect(loadExpandedPaths).toHaveBeenCalledTimes(1);
  });

  it('restoreFileTreeStateOnce filters empty/whitespace paths', () => {
    const fileTreeExpandedPaths = ref<Record<string, true>>({});
    const loadExpandedPaths = vi.fn(() => ['/path1', '', '  ', '/path2']);
    const mod = createUiFileTreePersistenceModule({
      fileTreeExpandedPaths,
      loadExpandedPaths,
    });
    mod.restoreFileTreeStateOnce('proj-1');
    expect(fileTreeExpandedPaths.value).toEqual({ '/path1': true, '/path2': true });
  });
});
