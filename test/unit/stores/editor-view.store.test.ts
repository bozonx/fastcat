// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import {
  buildDefaultCutPanelsForOrientation,
  createEditorViewModule,
} from '~/stores/editor-view.store';
import { writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';

// Mock localStorage utils — path must use tilde alias so Vitest resolves to the same
// absolute path that the store resolves when it imports './ui/uiLocalStorage'.
vi.mock('~/stores/ui/uiLocalStorage', () => ({
  getPlatformSuffix: vi.fn(() => ''),
  readLocalStorageJson: vi.fn().mockReturnValue(null),
  writeLocalStorageJson: vi.fn(),
}));

describe('EditorViewStore Helper', () => {
  it('puts monitor as the central column in landscape (3-column layout)', () => {
    const cols = buildDefaultCutPanelsForOrientation('landscape');
    expect(cols).toHaveLength(3);
    expect(cols[0]?.panels.map((p) => p.type)).toEqual(['fileManager']);
    expect(cols[1]?.panels.map((p) => p.type)).toEqual(['monitor']);
    expect(cols[2]?.panels.map((p) => p.type)).toEqual(['properties']);
  });

  it('puts monitor in the right column in portrait', () => {
    const cols = buildDefaultCutPanelsForOrientation('portrait');
    expect(cols.length).toBe(2);
    expect(cols[1]?.panels[0]?.type).toBe('monitor');
    expect(cols[0]?.panels.map((p) => p.type)).toEqual(['fileManager', 'properties']);
  });
});

describe('useEditorViewStore module', () => {
  let mockProjectId: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockProjectId = ref('test-project');
    vi.clearAllMocks();
  });

  it('initializes with default cut view', () => {
    const store = createEditorViewModule(mockProjectId);
    expect(store.currentView.value).toBe('cut');
    expect(store.cutPanels.value.length).toBeGreaterThan(0);
  });

  it('resets timeline height to default', () => {
    const store = createEditorViewModule(mockProjectId);
    store.timelineHeight.value = 50;
    store.resetTimelineHeight();
    // default cut height is 40
    expect(store.timelineHeight.value).toBe(40);
  });

  it('switches views', () => {
    const store = createEditorViewModule(mockProjectId);
    store.setView('sound');
    expect(store.currentView.value).toBe('sound');
    store.goToFiles();
    expect(store.currentView.value).toBe('files');
    store.goToCut();
    expect(store.currentView.value).toBe('cut');
    store.goToExport();
    expect(store.currentView.value).toBe('export');
  });

  it('inserts a panel at the middle if no target provided', () => {
    const store = createEditorViewModule(mockProjectId);
    const originalCols = store.cutPanels.value.length;
    store.insertPanelAt({ id: 'new-panel', type: 'text' });
    expect(store.cutPanels.value.length).toBe(originalCols + 1);
    expect(store.cutPanels.value.some((col) => col.panels.some((p) => p.id === 'new-panel'))).toBe(
      true,
    );
  });

  it('removes a panel by id', () => {
    const store = createEditorViewModule(mockProjectId);
    // Ensure fileManager exists
    expect(
      store.cutPanels.value.some((col) => col.panels.some((p) => p.id === 'fileManager')),
    ).toBe(true);
    store.removePanel('fileManager');
    expect(
      store.cutPanels.value.some((col) => col.panels.some((p) => p.id === 'fileManager')),
    ).toBe(false);
  });

  it('repositions a panel to the left of another (column count unchanged)', () => {
    const store = createEditorViewModule(mockProjectId);
    // For landscape: col-1=[fileManager], col-2=[monitor], col-3=[properties]
    // Moving properties to the left of fileManager: source col removed, new col prepended
    const originalCols = store.cutPanels.value.length;
    store.movePanel('properties', 'fileManager', 'left');
    // count stays the same: source col (was col-3) removed, new col-0 added
    expect(store.cutPanels.value.length).toBe(originalCols);
    expect(store.cutPanels.value[0]?.panels[0]?.id).toBe('properties');
  });

  it('merges a panel into another column on top', () => {
    const store = createEditorViewModule(mockProjectId);
    // Move monitor into fileManager's column at top position
    store.movePanel('monitor', 'fileManager', 'top');
    // Source col (monitor) is removed; monitor is prepended into fileManager's col
    const col = store.cutPanels.value.find((c) => c.panels.some((p) => p.id === 'fileManager'));
    expect(col?.panels.map((p) => p.id)).toEqual(['monitor', 'fileManager']);
  });

  it('increases column count when extracting from a shared column', () => {
    const store = createEditorViewModule(mockProjectId);
    // First merge monitor into fileManager's column → 2 columns
    store.movePanel('monitor', 'fileManager', 'bottom');
    const colsAfterMerge = store.cutPanels.value.length;
    expect(colsAfterMerge).toBe(2);
    // Now extract monitor to a new column on the right of properties
    store.movePanel('monitor', 'properties', 'right');
    expect(store.cutPanels.value.length).toBe(colsAfterMerge + 1);
    const lastCol = store.cutPanels.value[store.cutPanels.value.length - 1];
    expect(lastCol?.panels[0]?.id).toBe('monitor');
  });

  it('handles fullscreen transition', () => {
    const store = createEditorViewModule(mockProjectId);
    store.setView('cut');
    store.goToFullscreen();
    expect(store.currentView.value).toBe('fullscreen');
    expect(store.lastViewBeforeFullscreen.value).toBe('cut');
  });

  it('saves cut panels synchronously after movePanel (flush: sync)', () => {
    vi.useFakeTimers();
    const store = createEditorViewModule(mockProjectId);
    // Advance past the 50ms internalLoadCount reset so the save guard is cleared
    vi.runAllTimers();
    vi.clearAllMocks();
    // Move monitor into fileManager's column — triggers cutPanels mutation
    store.movePanel('monitor', 'fileManager', 'bottom');
    // With flush:'sync' the save watch runs in the same call stack as the mutation
    expect(writeLocalStorageJson).toHaveBeenCalledWith(
      expect.stringContaining('test-project'),
      expect.any(Array),
    );
    vi.useRealTimers();
  });
});
