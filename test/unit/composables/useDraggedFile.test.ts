import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { nextTick } from 'vue';

describe('useDraggedFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { clearDraggedFile } = useDraggedFile({ enableUiEffects: false });
    clearDraggedFile();
  });

  it('should initialize with null', () => {
    const { draggedFile } = useDraggedFile({ enableUiEffects: false });
    expect(draggedFile.value).toBeNull();
  });

  it('should set dragged file data', () => {
    const { draggedFile, setDraggedFile } = useDraggedFile({ enableUiEffects: false });
    const mockData = { name: 'test.mp4', path: '/test.mp4', kind: 'file' as const };

    setDraggedFile(mockData);
    expect(draggedFile.value).toEqual(mockData);
  });

  it('should clear dragged file data', () => {
    const { draggedFile, setDraggedFile, clearDraggedFile } = useDraggedFile({ enableUiEffects: false });
    const mockData = { name: 'test.mp4', path: '/test.mp4', kind: 'file' as const };

    setDraggedFile(mockData);
    expect(draggedFile.value).toEqual(mockData);

    clearDraggedFile();
    expect(draggedFile.value).toBeNull();
  });
});
