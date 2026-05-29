import { ref, computed } from 'vue';
import { getMediaTypeFromFilename, getIconForMediaType } from '~/utils/media-types';
import { genUuid } from '~/utils/ids';

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
  /** Order of static tab IDs (persisted in project.ui.json) — kept for backward compat. */
  const staticTabsOrder = ref<string[]>([]);

  /** Unified display order of all tab IDs (static + file). */
  const tabOrder = ref<string[]>([]);

  /** Static tabs that are currently detached as panels (hidden from tab bar). */
  const hiddenStaticTabs = ref<string[]>([]);

  function getSafeHiddenStaticTabs(): string[] {
    return hiddenStaticTabs.value ?? [];
  }

  /** File tabs added by drag-drop (persisted in project.ui.json) */
  const fileTabs = ref<ProjectFileTab[]>([]);

  /** Shared active tab ID across all consumers */
  const activeTabId = ref<string | null>(null);

  const registeredTabs = ref<ProjectTab[]>([]);

  /** Sets the tabs state (called from projectSettings store when project is loaded) */
  function setTabsState(params: {
    fileTabs?: ProjectFileTab[];
    staticTabsOrder?: string[];
    tabOrder?: string[];
    hiddenStaticTabs?: string[];
    activeTabId?: string | null;
  }) {
    if (params.fileTabs) fileTabs.value = params.fileTabs;
    if (params.staticTabsOrder) staticTabsOrder.value = params.staticTabsOrder;
    if (params.tabOrder) tabOrder.value = params.tabOrder;
    if (params.hiddenStaticTabs) hiddenStaticTabs.value = params.hiddenStaticTabs;
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
   * All tabs in display order: built from `tabOrder`, falling back to
   * `staticTabsOrder + fileTabs` when `tabOrder` is empty.
   * Hidden static tabs are filtered out.
   */
  const tabs = computed<AnyProjectTab[]>(() => {
    const staticMap = new Map((registeredTabs.value ?? []).map((t) => [t.id, t]));
    const fileMap = new Map((fileTabs.value ?? []).map((t) => [t.id, t]));
    const hidden = new Set(hiddenStaticTabs.value ?? []);
    const order =
      (tabOrder.value?.length ?? 0) > 0
        ? (tabOrder.value ?? [])
        : [...(staticTabsOrder.value ?? []), ...(fileTabs.value ?? []).map((f) => f.id)];

    const result: AnyProjectTab[] = [];
    const seen = new Set<string>();

    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (hidden.has(id)) continue;
      const tab = staticMap.get(id) ?? fileMap.get(id);
      if (tab) result.push(tab);
    }

    // Append newly registered static tabs that aren't in the order yet
    for (const tab of registeredTabs.value) {
      if (!hidden.has(tab.id) && !seen.has(tab.id)) {
        result.push(tab);
      }
    }

    // Append file tabs that aren't in the order yet
    for (const tab of fileTabs.value) {
      if (!seen.has(tab.id)) {
        result.push(tab);
      }
    }

    return result;
  });

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null);

  function setActiveTab(tabId: string) {
    if (tabs.value.find((t) => t.id === tabId)) {
      activeTabId.value = tabId;
    }
  }

  /**
   * Reorders all tabs (called after VueDraggable sort).
   * Updates the unified `tabOrder` and keeps backward-compat fields in sync.
   */
  function reorderTabs(newOrder: AnyProjectTab[]) {
    const newTabOrder = newOrder.map((t) => t.id);
    tabOrder.value = newTabOrder;

    staticTabsOrder.value = newOrder.filter((t) => !isFileTab(t)).map((t) => t.id);
    fileTabs.value = newOrder.filter(isFileTab);
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
      id: `file-tab-${genUuid()}`,
      filePath,
      fileName,
      mediaType: mappedType,
      icon,
    };

    fileTabs.value = [...fileTabs.value, tab];

    // Insert after the currently active tab, or at the end
    const currentOrder =
      tabOrder.value.length > 0
        ? tabOrder.value
        : [...staticTabsOrder.value, ...fileTabs.value.map((f) => f.id)];
    const activeIdx = currentOrder.indexOf(activeTabId.value ?? '');
    if (activeIdx !== -1) {
      tabOrder.value = [
        ...currentOrder.slice(0, activeIdx + 1),
        tab.id,
        ...currentOrder.slice(activeIdx + 1),
      ];
    } else {
      tabOrder.value = [...currentOrder, tab.id];
    }

    activeTabId.value = tab.id;
    return tab.id;
  }

  function removeFileTab(tabId: string) {
    const currentTabs = tabs.value;
    const removedIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    fileTabs.value = fileTabs.value.filter((t) => t.id !== tabId);
    tabOrder.value = tabOrder.value.filter((id) => id !== tabId);
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

    const retainedIds = new Set<string>([tabId]);
    fileTabs.value = [retainedTab];
    tabOrder.value = tabOrder.value.filter((id) => !isFileTabId(id) || retainedIds.has(id));
    activeTabId.value = tabId;
  }

  function removeAllFileTabs() {
    fileTabs.value = [];
    tabOrder.value = tabOrder.value.filter((id) => !isFileTabId(id));

    const fallbackStaticTab = tabs.value.find((tab) => !isFileTab(tab));
    activeTabId.value = fallbackStaticTab?.id ?? null;
  }

  function isFileTabId(id: string): boolean {
    return fileTabs.value.some((t) => t.id === id);
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
    const current = getSafeHiddenStaticTabs();
    if (!current.includes(tabId)) {
      hiddenStaticTabs.value = [...current, tabId];
    }
  }

  /** Show a static tab in the tab bar (panel was closed) */
  function showStaticTab(tabId: string) {
    hiddenStaticTabs.value = getSafeHiddenStaticTabs().filter((id) => id !== tabId);
  }

  /**
   * Sync hiddenStaticTabs against the actual layout panels.
   * Call after loading project settings to ensure tabs aren't left hidden
   * when their panels no longer exist.
   */
  function syncHiddenStaticTabsWithLayout(panels: Array<{ panels: Array<{ type: string }> }>) {
    const panelTypes = new Set<string>();
    for (const col of panels) {
      for (const panel of col.panels) {
        panelTypes.add(panel.type);
      }
    }

    const tabIdToPanelType: Record<string, string> = {
      files: 'fileManager',
      history: 'history',
      effects: 'effects',
      library: 'library',
      markers: 'markers',
      backups: 'backups',
    };

    hiddenStaticTabs.value = getSafeHiddenStaticTabs().filter((tabId) => {
      const panelType = tabIdToPanelType[tabId];
      return panelType && panelTypes.has(panelType);
    });
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
    showStaticTab,
    syncHiddenStaticTabsWithLayout,
    staticTabsOrder,
    tabOrder,
    hiddenStaticTabs,
    fileTabs,
    setTabsState,
  };
});
