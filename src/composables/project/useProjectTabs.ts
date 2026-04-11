import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FILE_MANAGER_MOVE_DRAG_TYPE } from '~/composables/useDraggedFile';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import {
  isFileTab,
  type AnyProjectTab,
  type ProjectFileTab,
  type ProjectTab,
  useProjectTabsStore,
} from '~/stores/project-tabs.store';
import { isOpenableProjectFileName } from '~/utils/media-types';

const TAB_ID_TO_PANEL_TYPE: Record<
  string,
  'fileManager' | 'history' | 'effects' | 'library' | 'markers'
> = {
  files: 'fileManager',
  history: 'history',
  effects: 'effects',
  library: 'library',
  markers: 'markers',
};

interface UseProjectTabsOptions {
  enableUiEffects?: boolean;
  onStaticTabDragStart?: (event: DragEvent, tabId: string) => void;
}

interface FileMovePayload {
  path: string;
  name: string;
  kind: string;
}

interface JsonFilePayload {
  path?: string;
  name?: string;
  kind?: string;
}

interface FileTabDragPayload {
  filePath: string;
  fileName: string;
}

interface PanelDragPayload {
  panelId: string;
  filePath?: string;
  fileName?: string;
}

export function useProjectTabs(options: UseProjectTabsOptions = {}) {
  const { enableUiEffects = true, onStaticTabDragStart: handleStaticTabDragStart } = options;

  const { t } = useI18n();
  const focusStore = useFocusStore();
  const projectStore = useProjectStore();
  const tabsStore = useProjectTabsStore();
  const {
    addFileTab,
    removeAllFileTabs,
    removeFileTab,
    removeOtherFileTabs,
    reorderTabs,
    setActiveTab,
  } = tabsStore;

  const staticTabs = computed(() => {
    const tabs = tabsStore.tabs;
    if (!tabs) return [];

    return tabs.filter((tab: AnyProjectTab) => !isFileTab(tab)) as ProjectTab[];
  });

  const fileTabsModel = computed({
    get: () => {
      const tabs = tabsStore.tabs;
      if (!tabs) return [];

      return tabs.filter((tab: AnyProjectTab) => isFileTab(tab)) as ProjectFileTab[];
    },
    set: (value) => reorderTabs([...staticTabs.value, ...value]),
  });

  const activeFileTab = computed(() => {
    const tabs = tabsStore.tabs;
    if (!tabs) return null;

    const activeTab = tabs.find((tab: AnyProjectTab) => tab.id === tabsStore.activeTabId);
    return activeTab && isFileTab(activeTab) ? activeTab : null;
  });

  const activeStaticTab = computed<ProjectTab | null>(() => {
    const tabs = tabsStore.tabs;
    if (!tabs) return null;

    const activeTab = tabs.find((tab: AnyProjectTab) => tab.id === tabsStore.activeTabId);
    return activeTab && !isFileTab(activeTab) ? (activeTab as ProjectTab) : null;
  });

  const activeStaticComponent = computed(() => activeStaticTab.value?.component ?? null);
  const isDropTarget = ref(false);
  const tabContainerRef = ref<HTMLElement | null>(null);
  const tabBarRef = ref<HTMLElement | null>(null);

  const projectTabContextMenuItems = computed(() => {
    if (!activeFileTab.value) return [];

    const activeTabId = activeFileTab.value.id;

    return [
      [
        {
          label: t('common.close'),
          icon: 'i-heroicons-x-mark',
          onSelect: () => removeFileTab(activeTabId),
        },
        {
          label: t('videoEditor.projectTabs.closeOthers'),
          icon: 'i-heroicons-minus-circle',
          onSelect: () => removeOtherFileTabs(activeTabId),
        },
        {
          label: t('videoEditor.projectTabs.closeAll'),
          icon: 'i-heroicons-x-circle',
          onSelect: () => removeAllFileTabs(),
        },
      ],
    ];
  });

  function activateProjectFocus() {
    focusStore.setPanelFocus('project');
  }

  function activateProjectTab(tabId: string) {
    activateProjectFocus();
    setActiveTab(tabId);
  }

  function isMiddleClick(event: MouseEvent) {
    return event.button === 1;
  }

  function onStaticTabMouseDown(event: MouseEvent, tabId: string) {
    if (!isMiddleClick(event) || tabId === 'files') return;
    event.preventDefault();
  }

  function onStaticTabAuxClick(event: MouseEvent, tabId: string) {
    if (!isMiddleClick(event) || tabId === 'files') return;
    event.preventDefault();
  }

  function onFileTabMouseDown(event: MouseEvent) {
    if (!isMiddleClick(event)) return;
    event.preventDefault();
  }

  function onFileTabAuxClick(event: MouseEvent, tabId: string) {
    if (!isMiddleClick(event)) return;
    event.preventDefault();
    removeFileTab(tabId);
  }

  async function openDroppedFile(params: { filePath: string; fileName: string }) {
    const tabId = addFileTab(params);
    setActiveTab(tabId);
  }

  function onStaticTabDragStart(event: DragEvent, tab: AnyProjectTab) {
    if (isFileTab(tab) || !event.dataTransfer) return;

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'static-tab-drag',
      JSON.stringify({ tabId: tab.id, label: (tab as ProjectTab).label }),
    );

    handleStaticTabDragStart?.(event, tab.id);
  }

  function onFileTabDragStart(event: DragEvent, tab: ProjectFileTab) {
    if (!event.dataTransfer) return;

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'file-tab-drag',
      JSON.stringify({
        tabId: tab.id,
        filePath: tab.filePath,
        fileName: tab.fileName,
        mediaType: tab.mediaType,
      }),
    );
  }

  function onTabBarDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types ?? [];
    if (
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes('application/json') ||
      types.includes('panel-drag') ||
      types.includes('file-tab-drag') ||
      types.includes('static-tab-drag')
    ) {
      event.preventDefault();
      isDropTarget.value = true;
    }
  }

  function onTabsWheel(event: WheelEvent) {
    const container = tabContainerRef.value;
    if (!container) return;

    const horizontalDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (horizontalDelta === 0) return;

    event.preventDefault();
    container.scrollLeft += horizontalDelta;
  }

  function onTabBarDragLeave(event: DragEvent) {
    const currentTarget = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget as Node | null;
    if (!currentTarget?.contains(related)) {
      isDropTarget.value = false;
    }
  }

  async function onTabBarDrop(event: DragEvent) {
    isDropTarget.value = false;
    event.preventDefault();
    event.stopPropagation();

    const movePayloadRaw =
      event.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      event.dataTransfer?.getData('application/fastcat-file-manager-move');

    if (movePayloadRaw) {
      try {
        const parsed = JSON.parse(movePayloadRaw);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const payload of items) {
          if (payload.kind === 'file' && payload.path && isOpenableProjectFileName(payload.name)) {
            await openDroppedFile({ filePath: payload.path, fileName: payload.name });
          }
        }
      } catch {}
      return;
    }

    const jsonPayloadRaw = event.dataTransfer?.getData('application/json');
    if (jsonPayloadRaw) {
      try {
        const payload = JSON.parse(jsonPayloadRaw) as JsonFilePayload;
        if (
          payload.kind === 'file' &&
          payload.path &&
          payload.name &&
          isOpenableProjectFileName(payload.name)
        ) {
          await openDroppedFile({ filePath: payload.path, fileName: payload.name });
          return;
        }
      } catch {}
    }

    const fileTabRaw = event.dataTransfer?.getData('file-tab-drag');
    if (fileTabRaw) {
      try {
        const payload = JSON.parse(fileTabRaw) as FileTabDragPayload;
        if (payload.filePath && payload.fileName) {
          await openDroppedFile({ filePath: payload.filePath, fileName: payload.fileName });
        }
      } catch {}
      return;
    }

    const panelPayloadRaw = event.dataTransfer?.getData('panel-drag');
    if (panelPayloadRaw) {
      try {
        const payload = JSON.parse(panelPayloadRaw) as PanelDragPayload;
        if (payload.filePath && payload.fileName && isOpenableProjectFileName(payload.fileName)) {
          await openDroppedFile({ filePath: payload.filePath, fileName: payload.fileName });
          projectStore.removePanel(payload.panelId);
        }
      } catch {}
    }
  }

  if (enableUiEffects) {
    watch(
      () => tabsStore.activeTabId,
      async (newId) => {
        if (!newId) return;

        await nextTick();
        await nextTick();

        const activeElement = document.querySelector(
          `[data-tab-id="${newId}"]`,
        ) as HTMLElement | null;
        activeElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      },
    );

    onMounted(() => {
      tabBarRef.value?.addEventListener('wheel', onTabsWheel, { passive: false });
    });

    onBeforeUnmount(() => {
      tabBarRef.value?.removeEventListener('wheel', onTabsWheel);
    });
  }

  function detachStaticTab(tabId: string) {
    if (tabId === 'files') return;

    const panelType = TAB_ID_TO_PANEL_TYPE[tabId];
    if (!panelType) return;

    const tab = staticTabs.value.find((t) => t.id === tabId);
    if (!tab) return;

    const panelId = `static-${tabId}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 7)}`;

    projectStore.insertPanelAt(
      {
        id: panelId,
        type: panelType,
        title: tab.label,
      },
      undefined,
      undefined,
      'cut',
    );

    tabsStore.hideStaticTab(tabId);

    if (projectStore.currentView !== 'cut') {
      projectStore.setView('cut');
    }
  }

  function getStaticTabContextMenuItems(tabId: string) {
    const isFilesTab = tabId === 'files';

    return [
      [
        {
          label: t('common.detach'),
          icon: 'i-heroicons-arrow-turn-down-right',
          disabled: isFilesTab,
          kbds: isFilesTab ? [] : undefined,
          onSelect: () => {
            if (!isFilesTab) {
              detachStaticTab(tabId);
            }
          },
        },
      ],
    ];
  }

  return {
    activateProjectFocus,
    activateProjectTab,
    activeFileTab,
    activeStaticComponent,
    detachStaticTab,
    fileTabsModel,
    getStaticTabContextMenuItems,
    isDropTarget,
    onFileTabAuxClick,
    onFileTabDragStart,
    onFileTabMouseDown,
    onStaticTabAuxClick,
    onStaticTabDragStart,
    onStaticTabMouseDown,
    onTabBarDragLeave,
    onTabBarDragOver,
    onTabBarDrop,
    projectTabContextMenuItems,
    staticTabs,
    tabBarRef,
    tabContainerRef,
    tabsStore,
  };
}
