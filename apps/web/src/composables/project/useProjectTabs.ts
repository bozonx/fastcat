import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { querySelector } from '~/utils/browser-api';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';
import type { DndDragContext, DndPayload } from '~/composables/dnd/dndTypes';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import {
  isFileTab,
  type AnyProjectTab,
  type ProjectTab,
  useProjectTabsStore,
} from '~/stores/project-tabs.store';
import { isOpenableProjectFileName } from '~/utils/media-types';
import { genUuid } from '~/utils/ids';

const TAB_ID_TO_PANEL_TYPE: Record<
  string,
  'fileManager' | 'history' | 'effects' | 'library' | 'markers' | 'backups'
> = {
  files: 'fileManager',
  history: 'history',
  effects: 'effects',
  library: 'library',
  markers: 'markers',
  backups: 'backups',
};

interface UseProjectTabsOptions {
  enableUiEffects?: boolean;
}

interface JsonFilePayload {
  path?: string;
  name?: string;
  kind?: string;
}

interface FileTabDndData {
  kind: 'file-tab';
  tabId: string;
  filePath: string;
  fileName: string;
  mediaType?: string | null;
}

interface StaticTabDndData {
  kind: 'static-tab';
  tabId: string;
  label: string;
}

interface PanelDndData {
  panelId: string;
  filePath?: string;
  fileName?: string;
}

interface PanelFileDndData extends PanelDndData {
  filePath: string;
  fileName: string;
}

type ProjectTabDndData = FileTabDndData | StaticTabDndData;

export function useProjectTabs(options: UseProjectTabsOptions = {}) {
  const { enableUiEffects = true } = options;

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

  const allTabsModel = computed({
    get: () => tabsStore.tabs,
    set: (value) => reorderTabs(value),
  });

  const staticTabs = computed(() => {
    const tabs = tabsStore.tabs;
    if (!tabs) return [];

    return tabs.filter((tab: AnyProjectTab) => !isFileTab(tab)) as ProjectTab[];
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

  function onTabMouseDown(event: MouseEvent, tab: AnyProjectTab) {
    if (!isMiddleClick(event)) return;
    if (isFileTab(tab)) {
      event.preventDefault();
    } else if (tab.id !== 'files') {
      event.preventDefault();
    }
  }

  function onTabAuxClick(event: MouseEvent, tab: AnyProjectTab) {
    if (!isMiddleClick(event)) return;
    event.preventDefault();
    if (isFileTab(tab)) {
      removeFileTab(tab.id);
    } else if (tab.id !== 'files') {
      detachStaticTab(tab.id);
    }
  }

  function getProjectTabPayload(tab: AnyProjectTab): DndPayload<ProjectTabDndData> | null {
    if (isFileTab(tab)) {
      return {
        source: 'project-tab',
        data: {
          kind: 'file-tab',
          tabId: tab.id,
          filePath: tab.filePath,
          fileName: tab.fileName,
          mediaType: tab.mediaType,
        },
        preview: { label: tab.fileName },
      };
    }

    if (tab.id === 'files') return null;
    return {
      source: 'project-tab',
      data: { kind: 'static-tab', tabId: tab.id, label: (tab as ProjectTab).label },
      preview: { label: (tab as ProjectTab).label },
    };
  }

  function onTabPointerDown(event: PointerEvent, tab: AnyProjectTab) {
    const payload = getProjectTabPayload(tab);
    if (!payload) return;

    armPointerDnd(event, { payload });
  }

  async function openDroppedFile(params: { filePath: string; fileName: string }) {
    const tabId = addFileTab(params);
    setActiveTab(tabId);
  }

  function getOpenableFileManagerItems(payload: DndPayload): JsonFilePayload[] {
    if (payload.source !== 'file-manager') return [];

    const data = payload.data as { items?: JsonFilePayload[]; primaryEntry?: JsonFilePayload };
    const items = data.items ?? (data.primaryEntry ? [data.primaryEntry] : []);
    return items.filter(
      (item) =>
        item.kind === 'file' &&
        typeof item.path === 'string' &&
        typeof item.name === 'string' &&
        isOpenableProjectFileName(item.name),
    );
  }

  function getProjectTabFilePayload(payload: DndPayload): FileTabDndData | null {
    if (payload.source !== 'project-tab') return null;
    const data = payload.data as Partial<ProjectTabDndData>;
    if (
      data.kind === 'file-tab' &&
      typeof data.filePath === 'string' &&
      typeof data.fileName === 'string'
    ) {
      return data as FileTabDndData;
    }
    return null;
  }

  function getPanelFilePayload(payload: DndPayload): PanelFileDndData | null {
    if (payload.source !== 'panel') return null;
    const data = payload.data as PanelDndData;
    if (typeof data.filePath === 'string' && typeof data.fileName === 'string') {
      return data as PanelFileDndData;
    }
    return null;
  }

  const { zoneAttrs: tabBarDndZoneAttrs } = useDndDropZone(
    {
      canAccept: (payload) =>
        getOpenableFileManagerItems(payload).length > 0 ||
        getProjectTabFilePayload(payload) !== null ||
        getPanelFilePayload(payload) !== null,
      onEnter: onTabBarDndOver,
      onOver: onTabBarDndOver,
      onLeave: onTabBarDndLeave,
      onDrop: onTabBarDndDrop,
    },
    'project-tabs',
  );

  function onTabBarDndOver(ctx: DndDragContext) {
    isDropTarget.value = true;
    ctx.setOperation('open-tab');
  }

  function onTabBarDndLeave() {
    isDropTarget.value = false;
  }

  async function onTabBarDndDrop(ctx: DndDragContext) {
    isDropTarget.value = false;
    for (const item of getOpenableFileManagerItems(ctx.payload)) {
      await openDroppedFile({ filePath: item.path!, fileName: item.name! });
    }

    const fileTab = getProjectTabFilePayload(ctx.payload);
    if (fileTab) {
      await openDroppedFile({ filePath: fileTab.filePath, fileName: fileTab.fileName });
    }

    const panel = getPanelFilePayload(ctx.payload);
    if (panel && isOpenableProjectFileName(panel.fileName)) {
      await openDroppedFile({ filePath: panel.filePath, fileName: panel.fileName });
      projectStore.removePanel(panel.panelId);
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

  if (enableUiEffects) {
    watch(
      () => tabsStore.activeTabId,
      async (newId) => {
        if (!newId) return;

        await nextTick();
        await nextTick();

        const activeElement = querySelector<HTMLElement>(`[data-tab-id="${newId}"]`);
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

    const panelId = `static-${tabId}-${genUuid()}`;

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

  function getFileTabContextMenuItems(tabId: string) {
    return [
      [
        {
          label: t('common.close'),
          icon: 'i-heroicons-x-mark',
          onSelect: () => removeFileTab(tabId),
        },
        {
          label: t('videoEditor.projectTabs.closeOthers'),
          icon: 'i-heroicons-minus-circle',
          onSelect: () => removeOtherFileTabs(tabId),
        },
        {
          label: t('videoEditor.projectTabs.closeAll'),
          icon: 'i-heroicons-x-circle',
          onSelect: () => removeAllFileTabs(),
        },
      ],
    ];
  }

  return {
    activateProjectFocus,
    activateProjectTab,
    activeFileTab,
    activeStaticComponent,
    allTabsModel,
    detachStaticTab,
    getFileTabContextMenuItems,
    getStaticTabContextMenuItems,
    isDropTarget,
    onTabAuxClick,
    onTabMouseDown,
    onTabPointerDown,
    projectTabContextMenuItems,
    staticTabs,
    tabBarRef,
    tabBarDndZoneAttrs,
    tabContainerRef,
    tabsStore,
  };
}
