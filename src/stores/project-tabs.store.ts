import { ref, computed, watch } from 'vue';
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';
import { getMediaTypeFromFilename, getIconForMediaType } from '~/utils/media-types';

import { defineStore } from 'pinia';

export interface ProjectTab {
  id: string;
  label: string;
  icon?: string;
  component: ReturnType<typeof defineComponent>;
}

export interface ProjectFileTab {
  id: string;
  /** File path relative to project root */
  filePath: string;
  fileName: string;
  mediaType: 'video' | 'audio' | 'image' | 'text' | 'unknown' | null;
  icon: string;
}

export type AnyProjectTab = ProjectTab | ProjectFileTab;

export function isFileTab(tab: AnyProjectTab): tab is ProjectFileTab {
  return 'filePath' in tab;
}

export const useProjectTabsStore = defineStore('projectTabs', () => {
  /** Order of static tab IDs (persisted in project.ui.json) */
  const staticTabsOrder = ref<string[]>([]);

  /** Static tabs that are currently detached as panels (hidden from tab bar) */
  const hiddenStaticTabs = ref<Set<string>>(new Set());

  /** File tabs added by drag-drop (persisted in project.ui.json) */
  const fileTabs = ref<ProjectFileTab[]>([]);

  /** Shared active tab ID across all consumers */
  const activeTabId = ref<string | null>(null);

  const registeredTabs = ref<ProjectTab[]>([]);

  /** Sets the tabs state (called from projectSettings store when project is loaded) */
  function setTabsState(params: {
    fileTabs?: ProjectFileTab[];
    staticTabsOrder?: string[];
    activeTabId?: string | null;
  }) {
    if (params.fileTabs) fileTabs.value = params.fileTabs;
    if (params.staticTabsOrder) staticTabsOrder.value = params.staticTabsOrder;
    if (params.activeTabId !== undefined) activeTabId.value = params.activeTabId;
  }

  function registerProjectTab(tab: ProjectTab) {
    if (!registeredTabs.value.find((t) => t.id === tab.id)) {
      registeredTabs.value.push(tab);
    }
  }

  function unregisterProjectTab(tabId: string) {
    const index = registeredTabs.value.findIndex((t) => t.id === tabId);
    if (index !== -1) {
      registeredTabs.value.splice(index, 1);
    }
  }

  /**
   * All tabs in display order: static tabs (sorted by user) + file tabs.
   * Static tabs are sorted according to staticTabsOrder; new ones appended.
   */
  const tabs = computed<AnyProjectTab[]>(() => {
    const statics = registeredTabs.value.filter((t) => !hiddenStaticTabs.value.has(t.id));
    const order = staticTabsOrder.value || [];

    const sortedStatics = [...statics].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    return [...sortedStatics, ...(fileTabs.value || [])];
  });

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null);

  function setActiveTab(tabId: string) {
    if (tabs.value.find((t) => t.id === tabId)) {
      activeTabId.value = tabId;
    }
  }

  /**
   * Reorders all tabs (called after VueDraggable sort).
   * Static tabs go to staticTabsOrder; file tabs update fileTabs order.
   */
  function reorderTabs(newOrder: AnyProjectTab[]) {
    const newStaticOrder = newOrder.filter((t) => !isFileTab(t)).map((t) => t.id);
    staticTabsOrder.value = newStaticOrder;

    const newFileTabs = newOrder.filter(isFileTab);
    fileTabs.value = newFileTabs;
  }

  /**
   * Adds a file as a tab (from drag-drop from FileManager or from dropping a panel).
   * Returns the new tab id or existing one if already added.
   */
  function addFileTab(params: { filePath: string; fileName: string }): string {
    const { filePath, fileName } = params;

    const existing = fileTabs.value.find((t) => t.filePath === filePath);
    if (existing) {
      activeTabId.value = existing.id;
      return existing.id;
    }

    const mediaType = getMediaTypeFromFilename(fileName);
    const mappedType =
      mediaType === 'timeline' || mediaType === 'unknown'
        ? 'unknown'
        : (mediaType as ProjectFileTab['mediaType']);

    const icon = getIconForMediaType(mediaType);

    const tab: ProjectFileTab = {
      id: `file-tab-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 7)}`,
      filePath,
      fileName,
      mediaType: mappedType,
      icon,
    };

    fileTabs.value = [...fileTabs.value, tab];
    activeTabId.value = tab.id;
    return tab.id;
  }

  function removeFileTab(tabId: string) {
    const currentTabs = tabs.value;
    const removedIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    fileTabs.value = fileTabs.value.filter((t) => t.id !== tabId);
    if (activeTabId.value !== tabId) return;

    const remaining = currentTabs.filter((tab) => tab.id !== tabId);
    if (remaining.length === 0) {
      activeTabId.value = null;
      return;
    }

    const nextActiveIndex = Math.min(removedIndex, remaining.length - 1);
    activeTabId.value = remaining[nextActiveIndex]?.id ?? null;
  }

  function removeFileTabByPath(filePath: string) {
    const tab = fileTabs.value.find((t) => t.filePath === filePath);
    if (!tab) return;
    removeFileTab(tab.id);
  }

  function removeOtherFileTabs(tabId: string) {
    const retainedTab = fileTabs.value.find((tab) => tab.id === tabId);
    if (!retainedTab) return;

    fileTabs.value = [retainedTab];
    activeTabId.value = tabId;
  }

  function removeAllFileTabs() {
    fileTabs.value = [];

    const fallbackStaticTab = tabs.value.find((tab) => !isFileTab(tab));
    activeTabId.value = fallbackStaticTab?.id ?? null;
  }

  function initDefaultTab() {
    if (!activeTabId.value && tabs.value.length > 0) {
      const firstTab = tabs.value[0];
      if (firstTab) {
        activeTabId.value = firstTab.id;
      }
    }
  }

  /** Hide a static tab from the tab bar (detached as a panel) */
  function hideStaticTab(tabId: string) {
    hiddenStaticTabs.value.add(tabId);
  }

  /** Show a static tab in the tab bar (panel was closed) */
  function showStaticTab(tabId: string) {
    hiddenStaticTabs.value.delete(tabId);
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    registerProjectTab,
    unregisterProjectTab,
    setActiveTab,
    initDefaultTab,
    reorderTabs,
    addFileTab,
    removeFileTab,
    removeFileTabByPath,
    removeOtherFileTabs,
    removeAllFileTabs,
    hideStaticTab,
    staticTabsOrder,
    fileTabs,
    setTabsState,
  };
});
