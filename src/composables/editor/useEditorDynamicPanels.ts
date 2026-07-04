import { createDevLogger } from '~/utils/dev-logger';
import { computed, ref, watch, type Ref } from 'vue';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { readLocalStorageJson, getPlatformSuffix } from '~/stores/ui/uiLocalStorage';
import type { DynamicPanel } from '~/stores/editor-view.store';
import { genUuid } from '~/utils/ids';
import { useTauriPanelPointerDrag } from '~/composables/editor/useTauriPanelPointerDrag';
const log = createDevLogger('useEditorDynamicPanels');

interface UseEditorDynamicPanelsOptions {
  currentProjectId: Ref<string | null>;
}

interface PanelDropInput {
  event: DragEvent;
  targetPanelId: string;
  view?: 'cut' | 'sound';
}

interface VerticalSplitResizeInput {
  event: { panes?: Array<{ size: number }> } | Array<{ size: number }>;
  colId: string;
  view?: 'cut' | 'sound';
}

interface GetVerticalSizeInput {
  colId: string;
  rowIndex: number;
  totalRows: number;
  view?: 'cut' | 'sound';
}

interface ClosePanelOptions {
  restoreFocus?: boolean;
  view?: 'cut' | 'sound';
}

const panelTypeToTabId: Record<string, string> = {
  history: 'history',
  effects: 'effects',
  fileManager: 'files',
  library: 'library',
  markers: 'markers',
  backups: 'backups',
};

export function useEditorDynamicPanels(options: UseEditorDynamicPanelsOptions) {
  const projectStore = useProjectStore();
  const focusStore = useFocusStore();
  const workspaceStore = useWorkspaceStore();
  const { currentProjectId } = options;

  const draggingPanelId = ref<string | null>(null);
  const dragOverPanelId = ref<string | null>(null);
  const dropPosition = ref<'left' | 'right' | 'top' | 'bottom' | null>(null);

  const verticalSplitSizesKey = computed(
    () =>
      `fastcat-cut-vertical-splits-${currentProjectId.value ?? 'no-project'}${getPlatformSuffix()}`,
  );
  const verticalSplitSizes = ref<Record<string, number[]>>(
    projectStore.projectSettings.ui.layout.verticalSplitSizes[verticalSplitSizesKey.value] ??
      readLocalStorageJson<Record<string, number[]>>(verticalSplitSizesKey.value, {}),
  );

  const soundVerticalSplitSizesKey = computed(
    () =>
      `fastcat-sound-vertical-splits-${currentProjectId.value ?? 'no-project'}${getPlatformSuffix()}`,
  );
  const soundVerticalSplitSizes = ref<Record<string, number[]>>(
    projectStore.projectSettings.ui.layout.verticalSplitSizes[soundVerticalSplitSizesKey.value] ??
      readLocalStorageJson<Record<string, number[]>>(soundVerticalSplitSizesKey.value, {}),
  );

  const verticalSplitSizesSnapshot = computed(() =>
    JSON.stringify(projectStore.projectSettings.ui.layout.verticalSplitSizes),
  );

  watch([() => verticalSplitSizesKey.value, verticalSplitSizesSnapshot], (key) => {
    const targetKey = Array.isArray(key) ? key[0] : key;
    verticalSplitSizes.value =
      projectStore.projectSettings.ui.layout.verticalSplitSizes[targetKey] ??
      readLocalStorageJson<Record<string, number[]>>(targetKey, {});
  });

  watch([() => soundVerticalSplitSizesKey.value, verticalSplitSizesSnapshot], (key) => {
    const targetKey = Array.isArray(key) ? key[0] : key;
    soundVerticalSplitSizes.value =
      projectStore.projectSettings.ui.layout.verticalSplitSizes[targetKey] ??
      readLocalStorageJson<Record<string, number[]>>(targetKey, {});
  });

  const cutPanelsLayoutKey = computed(() =>
    JSON.stringify(
      projectStore.cutPanels.map((col) => ({
        id: col.id,
        rows: col.panels.map((p) => p.id),
      })),
    ),
  );

  const soundPanelsLayoutKey = computed(() =>
    JSON.stringify(
      projectStore.soundPanels.map((col) => ({
        id: col.id,
        rows: col.panels.map((p) => p.id),
      })),
    ),
  );

  function getDynamicPanelFocusId(panelId: string) {
    const panel = getPanelById(panelId);
    if (!panel) return `dynamic:unknown:${panelId}` as const;
    if (panel.type === 'fileManager') {
      return `dynamic:file-manager:${panelId}` as const;
    }
    return `dynamic:${panel.type}:${panelId}` as const;
  }

  function focusDynamicPanel(panelId: string) {
    focusStore.setPanelFocus(getDynamicPanelFocusId(panelId));
  }

  function getActiveDetachedPanel() {
    const focusId = focusStore.effectiveFocus;
    if (!String(focusId).startsWith('dynamic:')) return null;
    const rest = String(focusId).slice('dynamic:'.length);
    const sep = rest.indexOf(':');
    const panelId = sep === -1 ? rest : rest.slice(sep + 1);

    return getPanelById(panelId);
  }

  function getPanelById(panelId: string) {
    return (
      [...projectStore.cutPanels, ...projectStore.soundPanels]
        .flatMap((column) => column.panels)
        .find((panel) => panel.id === panelId) ?? null
    );
  }

  function getPanelView(panelId: string): 'cut' | 'sound' | null {
    const isInCut = projectStore.cutPanels.some((column) =>
      column.panels.some((panel) => panel.id === panelId),
    );
    if (isInCut) return 'cut';

    const isInSound = projectStore.soundPanels.some((column) =>
      column.panels.some((panel) => panel.id === panelId),
    );
    if (isInSound) return 'sound';

    return null;
  }

  function resetDragState() {
    draggingPanelId.value = null;
    dragOverPanelId.value = null;
    dropPosition.value = null;
  }

  function onDragStart(event: DragEvent, panelId: string) {
    if (!workspaceStore.inDevelopmentFeaturesEnabled) return;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', panelId);

      const panel = [...projectStore.cutPanels, ...projectStore.soundPanels]
        .flatMap((column) => column.panels)
        .find((item) => item.id === panelId);

      if (panel && (panel.type === 'media' || panel.type === 'text') && panel.filePath) {
        const fileName = panel.title ?? panel.filePath.split('/').pop() ?? panel.filePath;
        event.dataTransfer.setData(
          'panel-drag',
          JSON.stringify({ panelId, filePath: panel.filePath, fileName }),
        );
      }
    }

    draggingPanelId.value = panelId;
  }

  function onDragOver(event: DragEvent, panelId: string) {
    if (!workspaceStore.inDevelopmentFeaturesEnabled) return;
    event.preventDefault();

    const isDraggingPanel = Boolean(draggingPanelId.value);
    const isDraggingTab =
      event.dataTransfer?.types.includes('static-tab-drag') ||
      event.dataTransfer?.types.includes('file-tab-drag');

    if (!isDraggingPanel && !isDraggingTab) {
      return;
    }

    if (draggingPanelId.value === panelId) {
      dragOverPanelId.value = null;
      dropPosition.value = null;
      return;
    }

    dragOverPanelId.value = panelId;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const distLeft = x;
    const distRight = rect.width - x;
    const distTop = y;
    const distBottom = rect.height - y;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    const threshold = Math.min(rect.width * 0.15, rect.height * 0.15, 60);

    if (minDist > threshold) {
      dropPosition.value = null;
    } else {
      if (minDist === distLeft) dropPosition.value = 'left';
      else if (minDist === distRight) dropPosition.value = 'right';
      else if (minDist === distTop) dropPosition.value = 'top';
      else dropPosition.value = 'bottom';
    }
  }

  function onDragLeave(event: DragEvent, panelId: string) {
    const target = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;

    if (!target.contains(relatedTarget) && dragOverPanelId.value === panelId) {
      dragOverPanelId.value = null;
      dropPosition.value = null;
    }
  }

  function closePanelAndRestoreTab(panel: DynamicPanel, options?: ClosePanelOptions) {
    const tabId = panelTypeToTabId[panel.type];
    if (tabId) {
      const tabsStore = useProjectTabsStore();
      tabsStore.showStaticTab(tabId);
    }

    projectStore.removePanel(panel.id, options?.view);

    if (options?.restoreFocus) {
      focusStore.restoreLastCutMainPanel();
    }
  }

  function movePanelToView(panel: DynamicPanel, targetView: 'cut' | 'sound') {
    const sourceView = getPanelView(panel.id);
    if (!sourceView || sourceView === targetView) {
      return;
    }

    projectStore.removePanel(panel.id, sourceView);
    projectStore.insertPanelAt({ ...panel }, undefined, undefined, targetView);

    if (projectStore.currentView !== targetView) {
      projectStore.setView(targetView);
    }

    focusDynamicPanel(panel.id);
  }

  function onDrop(input: PanelDropInput) {
    if (!workspaceStore.inDevelopmentFeaturesEnabled) return;
    const { event, targetPanelId, view = 'cut' } = input;
    event.preventDefault();

    const staticTabRaw = event.dataTransfer?.getData('static-tab-drag');
    if (staticTabRaw && dropPosition.value) {
      try {
        const payload = JSON.parse(staticTabRaw) as { tabId: string; label: string };
        const panelTypeMap: Record<string, DynamicPanel['type']> = {
          files: 'fileManager',
          history: 'history',
          effects: 'effects',
          library: 'library',
          markers: 'markers',
          backups: 'backups',
        };
        const panelType = panelTypeMap[payload.tabId] ?? 'fileManager';

        projectStore.insertPanelAt(
          {
            id: `static-${payload.tabId}-${genUuid()}`,
            type: panelType,
            title: payload.label,
          },
          targetPanelId,
          dropPosition.value,
          view,
        );
        const tabsStore = useProjectTabsStore();
        tabsStore.hideStaticTab(payload.tabId);
      } catch (err) {
        log.warn('Failed to parse static-tab-drag payload', err);
      }

      resetDragState();
      return;
    }

    const fileTabRaw = event.dataTransfer?.getData('file-tab-drag');
    if (fileTabRaw && dropPosition.value) {
      try {
        const payload = JSON.parse(fileTabRaw) as {
          tabId: string;
          filePath: string;
          fileName: string;
          mediaType: string;
        };
        const mediaType = (payload.mediaType || 'unknown') as
          | 'video'
          | 'audio'
          | 'image'
          | 'unknown';

        projectStore.insertPanelAt(
          {
            id: `file-panel-${genUuid()}`,
            type: 'media',
            filePath: payload.filePath,
            mediaType,
            title: payload.fileName,
          },
          targetPanelId,
          dropPosition.value,
          view,
        );
      } catch (err) {
        log.warn('Failed to parse file-tab-drag payload', err);
      }

      resetDragState();
      return;
    }

    if (!draggingPanelId.value || !dropPosition.value) {
      resetDragState();
      return;
    }

    projectStore.movePanel(draggingPanelId.value, targetPanelId, dropPosition.value, view);
    resetDragState();
  }

  function onDragEnd() {
    resetDragState();
  }

  function onVerticalSplitResize(input: VerticalSplitResizeInput) {
    const { event, colId, view = 'cut' } = input;
    const panes = Array.isArray(event) ? event : event?.panes;
    if (!Array.isArray(panes)) {
      return;
    }

    const newSizes = panes.map((pane) => pane.size);
    if (view === 'cut') {
      verticalSplitSizes.value[colId] = newSizes;
      projectStore.projectSettings.ui.layout.verticalSplitSizes[verticalSplitSizesKey.value] = {
        ...verticalSplitSizes.value,
      };
      return;
    }

    soundVerticalSplitSizes.value[colId] = newSizes;
    projectStore.projectSettings.ui.layout.verticalSplitSizes[soundVerticalSplitSizesKey.value] = {
      ...soundVerticalSplitSizes.value,
    };
  }

  function getVerticalSize(input: GetVerticalSizeInput): number | undefined {
    const { colId, rowIndex, totalRows, view = 'cut' } = input;
    const saved =
      view === 'cut' ? verticalSplitSizes.value[colId] : soundVerticalSplitSizes.value[colId];

    if (!saved || saved.length !== totalRows) {
      return undefined;
    }

    return saved[rowIndex];
  }

  function resetVerticalSizes(colId: string, view: 'cut' | 'sound' = 'cut') {
    if (view === 'cut') {
      Reflect.deleteProperty(verticalSplitSizes.value, colId);
      projectStore.projectSettings.ui.layout.verticalSplitSizes[verticalSplitSizesKey.value] = {
        ...verticalSplitSizes.value,
      };
    } else {
      Reflect.deleteProperty(soundVerticalSplitSizes.value, colId);
      projectStore.projectSettings.ui.layout.verticalSplitSizes[soundVerticalSplitSizesKey.value] =
        {
          ...soundVerticalSplitSizes.value,
        };
    }
  }

  const { startDrag: startTauriPanelDrag } = useTauriPanelPointerDrag({
    onDragStart: (panelId) => {
      draggingPanelId.value = panelId;
    },
    onDragOver: (panelId, position) => {
      dragOverPanelId.value = panelId;
      dropPosition.value = position;
    },
    onDrop: (targetPanelId, position) => {
      const view = getPanelView(targetPanelId);
      if (view && draggingPanelId.value) {
        projectStore.movePanel(draggingPanelId.value, targetPanelId, position, view);
      }
      resetDragState();
    },
    onDragEnd: () => {
      resetDragState();
    },
  });

  function onPanelPointerDown(event: PointerEvent, panelId: string) {
    if (!workspaceStore.inDevelopmentFeaturesEnabled) return;
    startTauriPanelDrag(event, panelId);
  }

  return {
    draggingPanelId,
    dragOverPanelId,
    dropPosition,
    getActiveDetachedPanel,
    getDynamicPanelFocusId,
    getPanelView,
    getVerticalSize,
    focusDynamicPanel,
    closePanelAndRestoreTab,
    movePanelToView,
    onDragEnd,
    onDragLeave,
    onDragOver,
    onDragStart,
    onDrop,
    onVerticalSplitResize,
    resetVerticalSizes,
    onPanelPointerDown,
    cutPanelsLayoutKey,
    soundPanelsLayoutKey,
  };
}
