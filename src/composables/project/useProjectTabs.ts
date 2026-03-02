import { ref, computed, readonly } from 'vue';

export interface ProjectTab {
  id: string;
  label: string;
  icon?: string;
  component: ReturnType<typeof defineComponent>;
}

const registeredTabs = ref<ProjectTab[]>([]);

export function registerProjectTab(tab: ProjectTab) {
  if (!registeredTabs.value.find((t) => t.id === tab.id)) {
    registeredTabs.value.push(tab);
  }
}

export function unregisterProjectTab(tabId: string) {
  const index = registeredTabs.value.findIndex((t) => t.id === tabId);
  if (index !== -1) {
    registeredTabs.value.splice(index, 1);
  }
}

export function useProjectTabs() {
  const activeTabId = ref<string | null>(null);

  const tabs = computed(() => registeredTabs.value);

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null);

  function setActiveTab(tabId: string) {
    if (tabs.value.find((t) => t.id === tabId)) {
      activeTabId.value = tabId;
    }
  }

  function initDefaultTab() {
    if (!activeTabId.value && tabs.value.length > 0) {
      const firstTab = tabs.value[0];
      if (firstTab) {
        activeTabId.value = firstTab.id;
      }
    }
  }

  return {
    tabs: readonly(tabs),
    activeTabId: readonly(activeTabId),
    activeTab: readonly(activeTab),
    setActiveTab,
    initDefaultTab,
  };
}
