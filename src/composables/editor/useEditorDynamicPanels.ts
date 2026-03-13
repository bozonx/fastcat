import { computed, ref, watch, type Ref } from 'vue';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { hideStaticTab, showStaticTab } from '~/composables/project/useProjectTabs';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';
import type { DynamicPanel } from '~/stores/editorView.store';
import { isOpenableProjectFileName } from '~/utils/media-types';

interface UseEditorDynamicPanelsOptions {
  currentProjectId: Ref<string | null>;
}

interface ClosePanelOptions {
  restoreFocus?: boolean;
  view?: 'cut' | 'sound';
}

const panelTypeToTabId: Record<string, string> = {
  history: 'history',
  effects: 'effects',
  fileManager: 'files',
};

function resolveMediaTypeByExtension(ext: string): 'video' | 'audio' | 'image' | 'unknown' {
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
  return 'unknown';
}

function isTextExtension(ext: string) {
  return ['txt', 'md', 'json', 'yaml', 'yml'].includes(ext);
}

export function useEditorDynamicPanels(options: UseEditorDynamicPanelsOptions) {
  const projectStore = useProjectStore();
  const focusStore = useFocusStore();
  const { currentProjectId } = options;
  const { findEntryByPath, vfs } = useFileManager();

  const draggingPanelId = ref<string | null>(null);
  const dragOverPanelId = ref<string | null>(null);
  const dropPosition = ref<'left' | 'right' | 'top' | 'bottom' | null>(null);

  const cutPanelsLayoutKey = computed(() =>
    JSON.stringify(projectStore.cutPanels.map((c) => ({ id: c.id, rows: c.panels.map((p) => p.id) }))),
  );

  const soundPanelsLayoutKey = computed(() =>
    JSON.stringify(projectStore.soundPanels.map((c) => ({ id: c.id, rows: c.panels.map((p) => p.id) }))),
  );

  const verticalSplitSizesKey = computed(
    () => `gran-cut-vertical-splits-${currentProjectId.value ?? 'no-project'}`,
  );
  const verticalSplitSizes = ref<Record<string, number[]>>(
    readLocalStorageJson<Record<string, number[]>>(verticalSplitSizesKey.value, {}),
  );

  const soundVerticalSplitSizesKey = computed(
    () => `gran-sound-vertical-splits-${currentProjectId.value ?? 'no-project'}`,
  );
  const soundVerticalSplitSizes = ref<Record<string, number[]>>(
    readLocalStorageJson<Record<string, number[]>>(soundVerticalSplitSizesKey.value, {}),
  );

  watch(
    () => verticalSplitSizesKey.value,
    (key) => {
      verticalSplitSizes.value = readLocalStorageJson<Record<string, number[]>>(key, {});
    },
  );

  watch(
    () => soundVerticalSplitSizesKey.value,
    (key) => {
      soundVerticalSplitSizes.value = readLocalStorageJson<Record<string, number[]>>(key, {});
    },
  );

  function getDynamicPanelFocusId(panelId: string) {
    return `dynamic:${panelId}` as const;
  }

  function focusDynamicPanel(panelId: string) {
    focusStore.setPanelFocus(getDynamicPanelFocusId(panelId));
  }

  function getActiveDetachedPanel() {
    const focusId = focusStore.effectiveFocus;
    if (!String(focusId).startsWith('dynamic:')) return null;
    const panelId = String(focusId).slice('dynamic:'.length);

    return (
      [...projectStore.cutPanels, ...projectStore.soundPanels]
        .flatMap((column) => column.panels)
        .find((panel) => panel.id === panelId) ?? null
    );
  }

  function resetDragState() {
    draggingPanelId.value = null;
    dragOverPanelId.value = null;
    dropPosition.value = null;
  }

  function onDragStart(event: DragEvent, panelId: string) {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';

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
    event.preventDefault();

    const isDraggingFile =
      event.dataTransfer?.types.includes('application/json') ||
      event.dataTransfer?.types.includes('application/gran-file-manager-move');
    const isDraggingPanel = Boolean(draggingPanelId.value);
    const isDraggingTab =
      event.dataTransfer?.types.includes('static-tab-drag') ||
      event.dataTransfer?.types.includes('file-tab-drag');

    if (!isDraggingFile && !isDraggingPanel && !isDraggingTab) {
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

    if (minDist === distLeft) dropPosition.value = 'left';
    else if (minDist === distRight) dropPosition.value = 'right';
    else if (minDist === distTop) dropPosition.value = 'top';
    else dropPosition.value = 'bottom';
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
      showStaticTab(tabId);
    }

    projectStore.removePanel(panel.id, options?.view);

    if (options?.restoreFocus) {
      focusStore.restoreLastCutMainPanel();
    }
  }

  function onDrop(event: DragEvent, targetPanelId: string, view: 'cut' | 'sound' = 'cut') {
    event.preventDefault();

    const staticTabRaw = event.dataTransfer?.getData('static-tab-drag');
    if (staticTabRaw && dropPosition.value) {
      try {
        const payload = JSON.parse(staticTabRaw) as { tabId: string; label: string };
        const panelTypeMap: Record<string, DynamicPanel['type']> = {
          files: 'fileManager',
          history: 'history',
          effects: 'effects',
        };
        const panelType = panelTypeMap[payload.tabId] ?? 'fileManager';

        projectStore.insertPanelAt(
          { id: `static-${payload.tabId}-${Date.now()}`, type: panelType, title: payload.label },
          targetPanelId,
          dropPosition.value,
          view,
        );
        hideStaticTab(payload.tabId);
      } catch {
        // ignore
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
            id: `file-panel-${Date.now()}`,
            type: 'media',
            filePath: payload.filePath,
            mediaType,
            title: payload.fileName,
          },
          targetPanelId,
          dropPosition.value,
          view,
        );
      } catch {
        // ignore
      }

      resetDragState();
      return;
    }

    const fileDragData =
      event.dataTransfer?.getData('application/json') ||
      event.dataTransfer?.getData('application/gran-file-manager-move');

    if (fileDragData) {
      try {
        const payload = JSON.parse(fileDragData);
        if (payload.kind === 'file' && dropPosition.value) {
          const panelPosition = dropPosition.value;
          if (!isOpenableProjectFileName(String(payload.name ?? ''))) {
            resetDragState();
            return;
          }

          findEntryByPath(payload.path);

          const ext = payload.name?.split('.').pop()?.toLowerCase() ?? '';
          const mediaType = resolveMediaTypeByExtension(ext);

          if (isTextExtension(ext)) {
            void (async () => {
              let content = `File: ${payload.name}`;
              try {
                const blob = await vfs.readFile(payload.path);
                content = await blob.text();
              } catch {
                // ignore
              }

              projectStore.addTextPanel(
                payload.path,
                content,
                payload.name,
                targetPanelId,
                panelPosition,
                view,
              );
            })();
          } else {
            projectStore.addMediaPanel(
              {
                kind: 'file',
                path: payload.path,
                name: payload.name,
                parentPath: payload.path.split('/').slice(0, -1).join('/') || undefined,
              },
              mediaType,
              payload.name,
              targetPanelId,
              panelPosition,
              view,
            );
          }

          resetDragState();
          return;
        }
      } catch {
        // ignore
      }
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

  function onVerticalSplitResize(
    event: { panes?: Array<{ size: number }> } | Array<{ size: number }>,
    colId: string,
    view: 'cut' | 'sound' = 'cut',
  ) {
    const panes = Array.isArray(event) ? event : event?.panes;
    if (!Array.isArray(panes)) {
      return;
    }

    const newSizes = panes.map((pane) => pane.size);
    if (view === 'cut') {
      verticalSplitSizes.value[colId] = newSizes;
      writeLocalStorageJson(verticalSplitSizesKey.value, verticalSplitSizes.value);
      return;
    }

    soundVerticalSplitSizes.value[colId] = newSizes;
    writeLocalStorageJson(soundVerticalSplitSizesKey.value, soundVerticalSplitSizes.value);
  }

  function getVerticalSize(
    colId: string,
    rowIndex: number,
    totalRows: number,
    view: 'cut' | 'sound' = 'cut',
  ): number | undefined {
    const saved =
      view === 'cut' ? verticalSplitSizes.value[colId] : soundVerticalSplitSizes.value[colId];

    if (!saved || saved.length !== totalRows) {
      return undefined;
    }

    return saved[rowIndex];
  }

  return {
    cutPanelsLayoutKey,
    soundPanelsLayoutKey,
    draggingPanelId,
    dragOverPanelId,
    dropPosition,
    getActiveDetachedPanel,
    getDynamicPanelFocusId,
    getVerticalSize,
    focusDynamicPanel,
    closePanelAndRestoreTab,
    onDragEnd,
    onDragLeave,
    onDragOver,
    onDragStart,
    onDrop,
    onVerticalSplitResize,
  };
}
