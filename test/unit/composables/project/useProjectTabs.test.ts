import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectTabs } from '../../../../src/composables/project/useProjectTabs';
import {
  isFileTab,
  type AnyProjectTab,
  useProjectTabsStore,
} from '../../../../src/stores/tabs.store';
import { defineComponent } from 'vue';

const DummyComponent = defineComponent({ template: '<div>Dummy</div>' });

describe('useProjectTabs', () => {
  beforeEach(() => {
    // Clear tabs before each test
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
});
