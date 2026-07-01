/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectTabsStore, isFileTab } from '~/stores/project-tabs.store';

describe('ProjectTabsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('registers and unregisters static tabs', () => {
    const store = useProjectTabsStore();
    const tab = { id: 'cut', label: 'Cut', component: {} as any };

    store.registerProjectTab(tab);
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].id).toBe('cut');

    store.unregisterProjectTab('cut');
    expect(store.tabs).toHaveLength(0);
  });

  it('does not duplicate registered tabs', () => {
    const store = useProjectTabsStore();
    const tab = { id: 'cut', label: 'Cut', component: {} as any };

    store.registerProjectTab(tab);
    store.registerProjectTab(tab);
    expect(store.tabs).toHaveLength(1);
  });

  it('sorts static tabs according to staticTabsOrder', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'sound', label: 'Sound', component: {} as any });
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });
    store.registerProjectTab({ id: 'export', label: 'Export', component: {} as any });

    store.staticTabsOrder = ['export', 'cut'];

    const ids = store.tabs.map((t) => t.id);
    expect(ids).toEqual(['export', 'cut', 'sound']);
  });

  it('hides static tabs listed in hiddenStaticTabs', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });
    store.registerProjectTab({ id: 'sound', label: 'Sound', component: {} as any });

    store.hideStaticTab('cut');
    expect(store.tabs.map((t) => t.id)).toEqual(['sound']);

    store.showStaticTab('cut');
    expect(store.tabs.map((t) => t.id)).toEqual(['cut', 'sound']);
  });

  it('adds a file tab and sets it active', () => {
    const store = useProjectTabsStore();
    const id = store.addFileTab({ filePath: 'video/a.mp4', fileName: 'a.mp4' });

    expect(store.fileTabs).toHaveLength(1);
    expect(store.fileTabs[0].filePath).toBe('video/a.mp4');
    expect(store.activeTabId).toBe(id);
    expect(isFileTab(store.tabs[0]!)).toBe(true);
  });

  it('activates existing file tab instead of duplicating', () => {
    const store = useProjectTabsStore();
    const id1 = store.addFileTab({ filePath: 'video/a.mp4', fileName: 'a.mp4' });
    store.activeTabId = null;

    const id2 = store.addFileTab({ filePath: 'video/a.mp4', fileName: 'a.mp4' });

    expect(id1).toBe(id2);
    expect(store.fileTabs).toHaveLength(1);
    expect(store.activeTabId).toBe(id1);
  });

  it('removes a file tab and switches active to the next tab', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });
    const id = store.addFileTab({ filePath: 'video/a.mp4', fileName: 'a.mp4' });

    store.removeFileTab(id);

    expect(store.fileTabs).toHaveLength(0);
    expect(store.activeTabId).toBe('cut');
  });

  it('removes file tab and sets active to null when no tabs remain', () => {
    const store = useProjectTabsStore();
    const id = store.addFileTab({ filePath: 'video/a.mp4', fileName: 'a.mp4' });

    store.removeFileTab(id);

    expect(store.fileTabs).toHaveLength(0);
    expect(store.activeTabId).toBeNull();
  });

  it('removes file tab by path', () => {
    const store = useProjectTabsStore();
    store.addFileTab({ filePath: 'video/a.mp4', fileName: 'a.mp4' });

    store.removeFileTabByPath('video/a.mp4');
    expect(store.fileTabs).toHaveLength(0);
  });

  it('keeps only the requested file tab via removeOtherFileTabs', () => {
    const store = useProjectTabsStore();
    const id1 = store.addFileTab({ filePath: 'a.mp4', fileName: 'a.mp4' });
    store.addFileTab({ filePath: 'b.mp4', fileName: 'b.mp4' });

    store.removeOtherFileTabs(id1);

    expect(store.fileTabs).toHaveLength(1);
    expect(store.fileTabs[0].filePath).toBe('a.mp4');
    expect(store.activeTabId).toBe(id1);
  });

  it('removes all file tabs and falls back to a static tab', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });
    store.addFileTab({ filePath: 'a.mp4', fileName: 'a.mp4' });

    store.removeAllFileTabs();

    expect(store.fileTabs).toHaveLength(0);
    expect(store.activeTabId).toBe('cut');
  });

  it('initializes default active tab when unset', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });

    store.initDefaultTab();
    expect(store.activeTabId).toBe('cut');
  });

  it('initializes default active tab when persisted active tab is missing', () => {
    const store = useProjectTabsStore();
    store.setTabsState({ activeTabId: 'file-tab-missing' });
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });

    store.initDefaultTab();
    expect(store.activeTabId).toBe('cut');
  });

  it('setActiveTab only works for existing tabs', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });

    store.setActiveTab('missing');
    expect(store.activeTabId).toBeNull();

    store.setActiveTab('cut');
    expect(store.activeTabId).toBe('cut');
  });

  it('reorders tabs via reorderTabs', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });
    store.registerProjectTab({ id: 'sound', label: 'Sound', component: {} as any });
    store.addFileTab({ filePath: 'a.mp4', fileName: 'a.mp4' });

    const newOrder = [...store.tabs].reverse();
    store.reorderTabs(newOrder);

    // After reverse: [file-tab, sound, cut]
    // reorderTabs splits: staticTabsOrder=['sound','cut'], fileTabs=[file-tab]
    expect(store.staticTabsOrder).toEqual(['sound', 'cut']);
    expect(store.fileTabs).toHaveLength(1);
    expect(store.fileTabs[0].filePath).toBe('a.mp4');
  });

  it('setTabsState restores persisted state', () => {
    const store = useProjectTabsStore();
    const fileTab = {
      id: 'file-tab-1',
      filePath: 'x.mp4',
      fileName: 'x.mp4',
      mediaType: 'video' as const,
      icon: '',
    };

    store.setTabsState({
      fileTabs: [fileTab],
      staticTabsOrder: ['export', 'cut'],
      activeTabId: 'file-tab-1',
    });

    expect(store.fileTabs).toHaveLength(1);
    expect(store.staticTabsOrder).toEqual(['export', 'cut']);
    expect(store.activeTabId).toBe('file-tab-1');
  });

  it('activeTab returns the current active tab object', () => {
    const store = useProjectTabsStore();
    store.registerProjectTab({ id: 'cut', label: 'Cut', component: {} as any });
    store.setActiveTab('cut');

    expect(store.activeTab).not.toBeNull();
    expect(store.activeTab!.id).toBe('cut');
  });
});
