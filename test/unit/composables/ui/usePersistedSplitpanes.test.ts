/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';

describe('usePersistedSplitpanes', () => {
  it('initializes with default sizes when storage is empty', () => {
    const storage = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const projectId = ref<string | null>('proj-1');
    const { sizes } = usePersistedSplitpanes('files', projectId, [50, 50], storage);
    expect(sizes.value).toEqual([50, 50]);
  });

  it('loads stored sizes when available', () => {
    const storage = {
      get: vi.fn(() => [30, 70]),
      set: vi.fn(),
    };
    const projectId = ref<string | null>('proj-1');
    const { sizes } = usePersistedSplitpanes('files', projectId, [50, 50], storage);
    expect(sizes.value).toEqual([30, 70]);
  });

  it('falls back to defaults when stored sizes length mismatch', () => {
    const storage = {
      get: vi.fn(() => [30, 40, 30]),
      set: vi.fn(),
    };
    const projectId = ref<string | null>('proj-1');
    const { sizes } = usePersistedSplitpanes('files', projectId, [50, 50], storage);
    expect(sizes.value).toEqual([50, 50]);
  });

  it('onResized updates sizes and persists to storage', () => {
    const storage = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const projectId = ref<string | null>('proj-1');
    const { onResized } = usePersistedSplitpanes('files', projectId, [50, 50], storage);
    onResized({ panes: [{ size: 60 }, { size: 40 }] });
    expect(storage.set).toHaveBeenCalledWith(
      expect.stringContaining('files'),
      [60, 40],
    );
  });

  it('onResized ignores invalid event', () => {
    const storage = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const projectId = ref<string | null>('proj-1');
    const { onResized } = usePersistedSplitpanes('files', projectId, [50, 50], storage);
    onResized({} as { panes: { size: number }[] });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('reset restores default sizes and persists', () => {
    const storage = {
      get: vi.fn(() => [30, 70]),
      set: vi.fn(),
    };
    const projectId = ref<string | null>('proj-1');
    const { sizes, reset } = usePersistedSplitpanes('files', projectId, [50, 50], storage);
    expect(sizes.value).toEqual([30, 70]);
    reset();
    expect(sizes.value).toEqual([50, 50]);
    expect(storage.set).toHaveBeenCalledWith(
      expect.stringContaining('files'),
      [50, 50],
    );
  });

  it('accepts Ref for pageKey', () => {
    const storage = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const pageKey = ref('files');
    const projectId = ref<string | null>('proj-1');
    const { sizes } = usePersistedSplitpanes(pageKey, projectId, [50, 50], storage);
    expect(sizes.value).toEqual([50, 50]);
  });

  it('accepts Ref for defaultSizes', () => {
    const storage = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const projectId = ref<string | null>('proj-1');
    const defaults = ref([40, 60]);
    const { sizes } = usePersistedSplitpanes('files', projectId, defaults, storage);
    expect(sizes.value).toEqual([40, 60]);
  });
});
