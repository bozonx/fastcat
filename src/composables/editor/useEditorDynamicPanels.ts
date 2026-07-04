import { computed, ref, watch, type Ref } from 'vue';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { readLocalStorageJson, getPlatformSuffix } from '~/stores/ui/uiLocalStorage';
import type { DynamicPanel } from '~/stores/editor-view.store';
import type { FsEntry } from '~/types/fs';
import { genUuid } from '~/utils/ids';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';
import type { DndDragContext, DndPayload } from '~/composables/dnd/dndTypes';

interface UseEditorDynamicPanelsOptions {
  currentProjectId: Ref<string | null>;
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

type PanelDropPosition = 'left' | 'right' | 'top' | 'bottom';
type EditorViewKind = 'cut' | 'sound';

interface PanelDndData {
  panelId: string;
  panelType: DynamicPanel['type'];
  filePath?: string;
  fileName?: string;
  mediaType?: DynamicPanel['mediaType'];
  title?: string;
}

interface ProjectFileTabDndData {
  kind: 'file-tab';
  tabId: string;
  filePath: string;
  fileName: string;
  mediaType?: DynamicPanel['mediaType'] | string;
}

interface ProjectStaticTabDndData {
  kind: 'static-tab';
  tabId: string;
  label: string;
}

type ProjectTabDndData = ProjectFileTabDndData | ProjectStaticTabDndData;

const panelTypeToTabId: Record<string, string> = {
  history: 'history',
  effects: 'effects',
  fileManager: 'files',
  library: 'library',
  markers: 'markers',
  backups: 'backups',
};

function getPanelDropPosition(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): PanelDropPosition | null {
  const distLeft = clientX - rect.left;
  const distRight = rect.right - clientX;
  const distTop = clientY - rect.top;
  const distBottom = rect.bottom - clientY;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  const threshold = Math.min(rect.width * 0.15, rect.height * 0.15, 60);

  if (minDist > threshold) return null;
  if (minDist === distLeft) return 'left';
  if (minDist === distRight) return 'right';
  if (minDist === distTop) return 'top';
  return 'bottom';
}

function normalizeMediaType(value: unknown): DynamicPanel['mediaType'] {
  return value === 'video' || value === 'audio' || value === 'image' || value === 'unknown'
    ? value
    : 'unknown';
}

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

  function getPanelDropTarget(ctx: DndDragContext): {
    panelId: string;
    view: EditorViewKind;
    panelEl: HTMLElement;
    position: PanelDropPosition | null;
  } | null {
    const panelEl = ctx.targetEl?.closest?.('[data-panel-id]') as HTMLElement | null;
    const panelId = panelEl?.dataset.panelId ?? '';
    const view = panelEl?.dataset.panelView;
    if (!panelEl || !panelId || (view !== 'cut' && view !== 'sound')) return null;

    return {
      panelId,
      view,
      panelEl,
      position: getPanelDropPosition(
        panelEl.getBoundingClientRect(),
        ctx.pointer.clientX,
        ctx.pointer.clientY,
      ),
    };
  }

  function getFileManagerItems(payload: DndPayload): FsEntry[] {
    if (payload.source !== 'file-manager') return [];
    const data = payload.data as { items?: FsEntry[]; primaryEntry?: FsEntry };
    const items = data.items ?? (data.primaryEntry ? [data.primaryEntry] : []);
    return items.filter(
      (item) =>
        item.kind === 'file' &&
        typeof item.name === 'string' &&
        isOpenableProjectFileName(item.name),
    );
  }

  function getProjectTabPayload(payload: DndPayload): ProjectTabDndData | null {
    if (payload.source !== 'project-tab') return null;
    const data = payload.data as Partial<ProjectTabDndData>;
    if (data.kind === 'static-tab' && typeof data.tabId === 'string') {
      return data as ProjectStaticTabDndData;
    }
    if (
      data.kind === 'file-tab' &&
      typeof data.filePath === 'string' &&
      typeof data.fileName === 'string'
    ) {
      return data as ProjectFileTabDndData;
    }
    return null;
  }

  function getPanelPayload(payload: DndPayload): PanelDndData | null {
    if (payload.source !== 'panel') return null;
    const data = payload.data as PanelDndData;
    return typeof data.panelId === 'string' ? data : null;
  }

  function canAcceptPanelDrop(payload: DndPayload): boolean {
    if (!workspaceStore.inDevelopmentFeaturesEnabled) return false;
    if (getPanelPayload(payload)) return true;
    if (getProjectTabPayload(payload)) return true;
    return getFileManagerItems(payload).length > 0;
  }

  function onPanelDndOver(ctx: DndDragContext) {
    const target = getPanelDropTarget(ctx);
    const panelPayload = getPanelPayload(ctx.payload);

    if (!target || (panelPayload && panelPayload.panelId === target.panelId)) {
      dragOverPanelId.value = null;
      dropPosition.value = null;
      ctx.setOperation('cancel');
      return;
    }

    dragOverPanelId.value = target.panelId;
    dropPosition.value = target.position;

    if (!target.position) {
      ctx.setOperation('cancel');
      return;
    }

    ctx.setOperation(panelPayload ? 'move' : 'open-panel');
  }

  function onPanelDndLeave() {
    dragOverPanelId.value = null;
    dropPosition.value = null;
  }

  function insertStaticTabPanel(
    payload: ProjectStaticTabDndData,
    target: { panelId: string; position: PanelDropPosition; view: EditorViewKind },
  ) {
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
      target.panelId,
      target.position,
      target.view,
    );
    useProjectTabsStore().hideStaticTab(payload.tabId);
  }

  function insertProjectFilePanel(
    payload: ProjectFileTabDndData,
    target: { panelId: string; position: PanelDropPosition; view: EditorViewKind },
  ) {
    projectStore.insertPanelAt(
      {
        id: `file-panel-${genUuid()}`,
        type: 'media',
        filePath: payload.filePath,
        mediaType: normalizeMediaType(payload.mediaType),
        title: payload.fileName,
      },
      target.panelId,
      target.position,
      target.view,
    );
  }

  function openFileManagerItemAsPanel(
    item: FsEntry,
    target: { panelId: string; position: PanelDropPosition; view: EditorViewKind },
  ) {
    const type = getMediaTypeFromFilename(item.name);
    if (type === 'text') {
      projectStore.addTextPanel(
        item.path || '',
        item.name,
        target.panelId,
        target.position,
        target.view,
      );
    } else if (type === 'video' || type === 'audio' || type === 'image') {
      projectStore.addMediaPanel(
        item,
        type,
        item.name,
        target.panelId,
        target.position,
        target.view,
      );
    }
  }

  async function onPanelDndDrop(ctx: DndDragContext) {
    const target = getPanelDropTarget(ctx);
    if (!target?.position) {
      resetDragState();
      return;
    }

    const dropTarget = {
      panelId: target.panelId,
      position: target.position,
      view: target.view,
    };

    const projectTabPayload = getProjectTabPayload(ctx.payload);
    if (projectTabPayload?.kind === 'static-tab') {
      insertStaticTabPanel(projectTabPayload, dropTarget);
      resetDragState();
      return;
    }

    if (projectTabPayload?.kind === 'file-tab') {
      insertProjectFilePanel(projectTabPayload, dropTarget);
      resetDragState();
      return;
    }

    const panelPayload = getPanelPayload(ctx.payload);
    if (panelPayload && panelPayload.panelId !== target.panelId) {
      projectStore.movePanel(panelPayload.panelId, target.panelId, target.position, target.view);
      resetDragState();
      return;
    }

    for (const item of getFileManagerItems(ctx.payload)) {
      openFileManagerItemAsPanel(item, dropTarget);
    }

    resetDragState();
  }

  const { zoneAttrs: panelDndZoneAttrs } = useDndDropZone(
    {
      canAccept: canAcceptPanelDrop,
      onEnter: onPanelDndOver,
      onOver: onPanelDndOver,
      onLeave: onPanelDndLeave,
      onDrop: onPanelDndDrop,
    },
    'dynamic-panel',
  );

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

  function onPanelPointerDown(event: PointerEvent, panelId: string) {
    if (!workspaceStore.inDevelopmentFeaturesEnabled) return;
    const panel = getPanelById(panelId);
    if (!panel) return;

    const fileName =
      panel.filePath && (panel.title ?? panel.filePath.split('/').pop() ?? panel.filePath);

    armPointerDnd(event, {
      payload: {
        source: 'panel',
        data: {
          panelId,
          panelType: panel.type,
          filePath: panel.filePath,
          fileName: fileName || undefined,
          mediaType: panel.mediaType,
          title: panel.title,
        } satisfies PanelDndData,
        preview: { label: panel.title ?? fileName ?? panel.type },
      },
      onStart: () => {
        draggingPanelId.value = panelId;
      },
      onEnd: () => {
        resetDragState();
      },
    });
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
    onVerticalSplitResize,
    resetVerticalSizes,
    onPanelPointerDown,
    panelDndZoneAttrs,
    cutPanelsLayoutKey,
    soundPanelsLayoutKey,
  };
}
