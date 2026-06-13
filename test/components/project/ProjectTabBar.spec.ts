import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import ProjectTabBar from '~/components/project/ProjectTabBar.vue';
import { markRaw, defineComponent } from 'vue';

const MockComponent = defineComponent({
  template: '<div>Mock Component</div>',
});

describe('ProjectTabBar.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders static tabs and active state', async () => {
    const component = await mountWithNuxt(ProjectTabBar, {
      initialState: {
        projectTabs: {
          activeTabId: 'files',
          fileTabs: [],
          staticTabsOrder: ['files', 'history'],
          tabOrder: [],
          hiddenStaticTabs: [],
        },
      },
    });

    const store = useProjectTabsStore();
    store.registerProjectTab({
      id: 'files',
      label: 'Files',
      icon: 'i-heroicons-folder',
      component: markRaw(MockComponent),
    });
    store.registerProjectTab({
      id: 'history',
      label: 'History',
      icon: 'i-heroicons-clock',
      component: markRaw(MockComponent),
    });

    await component.vm.$nextTick();

    const staticTabElements = component.findAll('[data-tab-id]');
    // Should render two static tabs
    expect(staticTabElements).toHaveLength(2);
    expect(staticTabElements[0].text()).toContain('Files');
    expect(staticTabElements[1].text()).toContain('History');

    // First tab (files) should have active styling (selection-accent)
    expect(staticTabElements[0].classes()).toContain('text-selection-accent-400');
    expect(staticTabElements[1].classes()).not.toContain('text-selection-accent-400');
  });

  it('calls activateProjectTab on tab click', async () => {
    const component = await mountWithNuxt(ProjectTabBar, {
      initialState: {
        projectTabs: {
          activeTabId: 'files',
          fileTabs: [],
          staticTabsOrder: ['files', 'history'],
          tabOrder: [],
          hiddenStaticTabs: [],
        },
      },
    });

    const store = useProjectTabsStore();
    store.registerProjectTab({
      id: 'files',
      label: 'Files',
      icon: 'i-heroicons-folder',
      component: markRaw(MockComponent),
    });
    store.registerProjectTab({
      id: 'history',
      label: 'History',
      icon: 'i-heroicons-clock',
      component: markRaw(MockComponent),
    });

    await component.vm.$nextTick();

    const historyTab = component.findAll('[data-tab-id]')[1];

    // Click on history tab
    await historyTab.trigger('click');
    expect(store.activeTabId).toBe('history');
  });

  it('renders file tabs with close button', async () => {
    const component = await mountWithNuxt(ProjectTabBar, {
      initialState: {
        projectTabs: {
          activeTabId: 'file-tab-1',
          fileTabs: [
            {
              id: 'file-tab-1',
              filePath: 'media/video.mp4',
              fileName: 'video.mp4',
              mediaType: 'video',
              icon: 'i-heroicons-film',
            },
          ],
          staticTabsOrder: ['files'],
          tabOrder: [],
          hiddenStaticTabs: [],
        },
      },
    });

    const store = useProjectTabsStore();
    store.registerProjectTab({
      id: 'files',
      label: 'Files',
      icon: 'i-heroicons-folder',
      component: markRaw(MockComponent),
    });

    await component.vm.$nextTick();

    // Renders static files tab + file-tab-1
    const tabs = component.findAll('[data-tab-id]');
    expect(tabs).toHaveLength(2);
    expect(tabs[1].text()).toContain('video.mp4');

    // Locate the close button for the file tab
    const closeBtn = tabs[1].find('button');
    expect(closeBtn.exists()).toBe(true);

    // Click close button
    await closeBtn.trigger('click');
    expect(store.fileTabs).toHaveLength(0);
  });

  it('renders mixed tab order when tabOrder is provided', async () => {
    const component = await mountWithNuxt(ProjectTabBar, {
      initialState: {
        projectTabs: {
          activeTabId: 'history',
          fileTabs: [
            {
              id: 'file-tab-1',
              filePath: 'media/video.mp4',
              fileName: 'video.mp4',
              mediaType: 'video',
              icon: 'i-heroicons-film',
            },
          ],
          staticTabsOrder: ['files', 'history'],
          tabOrder: ['files', 'file-tab-1', 'history'],
          hiddenStaticTabs: [],
        },
      },
    });

    const store = useProjectTabsStore();
    store.registerProjectTab({
      id: 'files',
      label: 'Files',
      icon: 'i-heroicons-folder',
      component: markRaw(MockComponent),
    });
    store.registerProjectTab({
      id: 'history',
      label: 'History',
      icon: 'i-heroicons-clock',
      component: markRaw(MockComponent),
    });

    await component.vm.$nextTick();

    const tabs = component.findAll('[data-tab-id]');
    expect(tabs).toHaveLength(3);
    expect(tabs[0].attributes('data-tab-id')).toBe('files');
    expect(tabs[1].attributes('data-tab-id')).toBe('file-tab-1');
    expect(tabs[2].attributes('data-tab-id')).toBe('history');
  });

  it('hides detached static tabs from the bar', async () => {
    const component = await mountWithNuxt(ProjectTabBar, {
      initialState: {
        projectTabs: {
          activeTabId: 'files',
          fileTabs: [],
          staticTabsOrder: ['files', 'history'],
          tabOrder: [],
          hiddenStaticTabs: ['history'],
        },
      },
    });

    const store = useProjectTabsStore();
    store.registerProjectTab({
      id: 'files',
      label: 'Files',
      icon: 'i-heroicons-folder',
      component: markRaw(MockComponent),
    });
    store.registerProjectTab({
      id: 'history',
      label: 'History',
      icon: 'i-heroicons-clock',
      component: markRaw(MockComponent),
    });

    await component.vm.$nextTick();

    const tabs = component.findAll('[data-tab-id]');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].attributes('data-tab-id')).toBe('files');

    // Restoring the tab should bring it back
    store.showStaticTab('history');
    await component.vm.$nextTick();
    const restoredTabs = component.findAll('[data-tab-id]');
    expect(restoredTabs).toHaveLength(2);
    expect(restoredTabs[1].attributes('data-tab-id')).toBe('history');
  });

  it('sets draggable false on tabs when experimentalFeatures is off', async () => {
    const component = await mountWithNuxt(ProjectTabBar, {
      initialState: {
        projectTabs: {
          activeTabId: 'files',
          fileTabs: [],
          staticTabsOrder: ['files', 'history'],
          tabOrder: [],
          hiddenStaticTabs: [],
        },
      },
    });

    const store = useProjectTabsStore();
    store.registerProjectTab({
      id: 'files',
      label: 'Files',
      icon: 'i-heroicons-folder',
      component: markRaw(MockComponent),
    });
    store.registerProjectTab({
      id: 'history',
      label: 'History',
      icon: 'i-heroicons-clock',
      component: markRaw(MockComponent),
    });

    await component.vm.$nextTick();

    const tabs = component.findAll('[data-tab-id]');
    expect(tabs[0].attributes('draggable')).toBe('false');
    expect(tabs[1].attributes('draggable')).toBe('false');
  });

});
