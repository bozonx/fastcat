import { describe, it, expect, beforeEach } from 'vitest';
import {
  useProjectTabs,
  registerProjectTab,
  unregisterProjectTab,
  isFileTab,
  type AnyProjectTab,
} from '../../../../src/composables/project/useProjectTabs';
import { defineComponent } from 'vue';

const DummyComponent = defineComponent({ template: '<div>Dummy</div>' });

describe('useProjectTabs', () => {
  beforeEach(() => {
    // Clear tabs before each test
    const { tabs } = useProjectTabs();
    tabs.value.forEach((t: AnyProjectTab) => {
      if (!isFileTab(t)) {
        unregisterProjectTab(t.id);
      }
    });
    localStorage.clear();
  });

  it('registers and retrieves static tabs', () => {
    registerProjectTab({
      id: 'test-tab',
      label: 'Test',
      component: DummyComponent as any,
    });

    const { tabs } = useProjectTabs();
    expect(tabs.value.length).toBe(1);
    expect(tabs.value[0]?.id).toBe('test-tab');
  });

  it('adds and removes file tabs', () => {
    const { tabs, addFileTab, removeFileTab } = useProjectTabs();

    const tabId = addFileTab({ filePath: '/test.mp4', fileName: 'test.mp4' });
    expect(tabs.value.length).toBe(1);
    expect(isFileTab(tabs.value[0]!)).toBe(true);
    if (isFileTab(tabs.value[0]!)) {
      expect(tabs.value[0]?.filePath).toBe('/test.mp4');
      expect(tabs.value[0]?.mediaType).toBe('video');
    }

    removeFileTab(tabId);
    expect(tabs.value.length).toBe(0);
  });
});
