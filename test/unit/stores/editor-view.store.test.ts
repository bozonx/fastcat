// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { 
    buildDefaultCutPanelsForOrientation, 
    createEditorViewModule,
} from '~/stores/editor-view.store';

// Mock localStorage utils
vi.mock('./ui/uiLocalStorage', () => ({
  readLocalStorageJson: vi.fn().mockReturnValue(null),
  writeLocalStorageJson: vi.fn(),
}));

describe('EditorViewStore Helper', () => {
    it('puts monitor below properties on the right stack in landscape', () => {
        const cols = buildDefaultCutPanelsForOrientation('landscape');
        const withMonitor = cols.find((c) => c.panels.some((p) => p.type === 'monitor'));
        expect(withMonitor?.panels.map((p) => p.type)).toEqual(['properties', 'monitor']);
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
        expect(store.cutPanels.value.some(col => col.panels.some(p => p.id === 'new-panel'))).toBe(true);
    });

    it('removes a panel by id', () => {
        const store = createEditorViewModule(mockProjectId);
        // Ensure fileManager exists
        expect(store.cutPanels.value.some(col => col.panels.some(p => p.id === 'fileManager'))).toBe(true);
        store.removePanel('fileManager');
        expect(store.cutPanels.value.some(col => col.panels.some(p => p.id === 'fileManager'))).toBe(false);
    });

    it('moves a panel within columns', () => {
        const store = createEditorViewModule(mockProjectId);
        // For landscape: col-1=[fileManager], col-2=[properties, monitor]
        // Move monitor above properties
        store.movePanel('monitor', 'properties', 'top');
        const col2 = store.cutPanels.value.find(c => c.panels.some(p => p.id === 'monitor'));
        expect(col2?.panels.map(p => p.id)).toEqual(['monitor', 'properties']);
    });

    it('moves a panel to a new column on the left', () => {
        const store = createEditorViewModule(mockProjectId);
        const originalCols = store.cutPanels.value.length;
        store.movePanel('monitor', 'fileManager', 'left');
        expect(store.cutPanels.value.length).toBe(originalCols + 1);
        expect(store.cutPanels.value[0]?.panels[0]?.id).toBe('monitor');
    });

    it('handles fullscreen transition', () => {
        const store = createEditorViewModule(mockProjectId);
        store.setView('cut');
        store.goToFullscreen();
        expect(store.currentView.value).toBe('fullscreen');
        expect(store.lastViewBeforeFullscreen.value).toBe('cut');
    });
});
