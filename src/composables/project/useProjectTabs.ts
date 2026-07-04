import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { querySelector } from '~/utils/browser-api';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
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
  onStaticTabDragStart?: (event: DragEvent, tabId: string) => void;
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

  function onTabDragStart(event: DragEvent, tab: AnyProjectTab) {
    if (!event.dataTransfer) return;

    if (isFileTab(tab)) {
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
    } else {
      if (tab.id === 'files') return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(
        'static-tab-drag',
        JSON.stringify({ tabId: tab.id, label: (tab as ProjectTab).label }),
      );
      handleStaticTabDragStart?.(event, tab.id);
    }
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

  const { zoneAttrs: tabBarDndZoneAttrs } = useDndDropZone(
    {
      canAccept: (payload) => getOpenableFileManagerItems(payload).length > 0,
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
    const items = getOpenableFileManagerItems(ctx.payload);
    for (const item of items) {
      await openDroppedFile({ filePath: item.path!, fileName: item.name! });
    }
  }

  function onTabBarDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types ?? [];
    if (
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

    const fileTabRaw = event.dataTransfer?.getData('file-tab-drag');
    if (fileTabRaw) {
      try {
        const payload = JSON.parse(fileTabRaw) as FileTabDragPayload;
        if (payload.filePath && payload.fileName) {
          await openDroppedFile({ filePath: payload.filePath, fileName: payload.fileName });
        }
      } catch {
        /* no-op */
      }
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
      } catch {
        /* no-op */
      }
    }
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
    onTabDragStart,
    onTabMouseDown,
    onTabBarDragLeave,
    onTabBarDragOver,
    onTabBarDrop,
    projectTabContextMenuItems,
    staticTabs,
    tabBarRef,
    tabBarDndZoneAttrs,
    tabContainerRef,
    tabsStore,
  };
}
