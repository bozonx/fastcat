import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { isFileTab, type AnyProjectTab, useProjectTabsStore } from '~/stores/tabs.store';
import { defineComponent } from 'vue';

const DummyComponent = defineComponent({ template: '<div>Dummy</div>' });

const mockProjectStore = {
  insertPanelAt: vi.fn(),
  setView: vi.fn(),
  currentView: 'cut',
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => ({
    setPanelFocus: vi.fn(),
  }),
}));

vi.mock('~/composables/fileManager/useFileManager', () => ({
  useFileManager: () => ({
    findEntryByPath: vi.fn(),
    vfs: {},
  }),
}));

describe('useProjectTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { tabsStore } = useProjectTabs();
    const { unregisterProjectTab } = tabsStore;
    tabsStore.tabs.forEach((t: AnyProjectTab) => {
      if (!isFileTab(t)) {
        unregisterProjectTab(t.id);
      }
    });
    localStorage.clear();
  });

  it('registers and retrieves static tabs', () => {
    const { tabsStore } = useProjectTabs();
    const { registerProjectTab } = tabsStore;

    registerProjectTab({
      id: 'test-tab',
      label: 'Test',
      component: DummyComponent as any,
    });

    expect(tabsStore.tabs.length).toBe(1);
    expect(tabsStore.tabs[0]?.id).toBe('test-tab');
  });

  it('adds and removes file tabs', () => {
    const { tabsStore } = useProjectTabs();
    const { addFileTab, removeFileTab } = tabsStore;

    const tabId = addFileTab({ filePath: '/test.mp4', fileName: 'test.mp4' });
    expect(tabsStore.tabs.length).toBe(1);
    expect(isFileTab(tabsStore.tabs[0]!)).toBe(true);
    if (isFileTab(tabsStore.tabs[0]!)) {
      expect((tabsStore.tabs[0] as any).filePath).toBe('/test.mp4');
      expect((tabsStore.tabs[0] as any).mediaType).toBe('video');
    }

    removeFileTab(tabId);
    expect(tabsStore.tabs.length).toBe(0);
  });

  describe('getStaticTabContextMenuItems', () => {
    it('returns disabled detach item for files tab', () => {
      const { getStaticTabContextMenuItems } = useProjectTabs({ enableUiEffects: false });
      const items = getStaticTabContextMenuItems('files');

      expect(items).toHaveLength(1);
      expect(items[0]).toHaveLength(1);
      expect(items[0]![0]!.label).toBe('Detach');
      expect(items[0]![0]!.disabled).toBe(true);
    });

    it('returns enabled detach item for non-files tab', () => {
      const { getStaticTabContextMenuItems } = useProjectTabs({ enableUiEffects: false });
      const items = getStaticTabContextMenuItems('history');

      expect(items).toHaveLength(1);
      expect(items[0]).toHaveLength(1);
      expect(items[0]![0]!.label).toBe('Detach');
      expect(items[0]![0]!.disabled).toBe(false);
    });
  });

  describe('detachStaticTab', () => {
    it('does nothing for files tab', () => {
      const { detachStaticTab } = useProjectTabs({ enableUiEffects: false });

      detachStaticTab('files');

      expect(mockProjectStore.insertPanelAt).not.toHaveBeenCalled();
    });

    it('creates panel and hides tab for detachable tab', () => {
      const { tabsStore, detachStaticTab } = useProjectTabs({ enableUiEffects: false });
      const { registerProjectTab } = tabsStore;

      registerProjectTab({
        id: 'history',
        label: 'History',
        component: DummyComponent as any,
      });

      const tabsBeforeDetach = tabsStore.tabs;
      expect(tabsBeforeDetach.some((t: AnyProjectTab) => t.id === 'history')).toBe(true);

      detachStaticTab('history');

      expect(mockProjectStore.insertPanelAt).toHaveBeenCalledTimes(1);
      expect(mockProjectStore.insertPanelAt).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'history',
          title: 'History',
        }),
        undefined,
        undefined,
        'cut',
      );

      const tabsAfterDetach = tabsStore.tabs;
      expect(tabsAfterDetach.some((t: AnyProjectTab) => t.id === 'history')).toBe(false);
    });
  });
});
