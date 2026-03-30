import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch, type Ref } from 'vue';
import {
  readLocalStorageJson,
  writeLocalStorageJson,
  getPlatformSuffix,
} from './ui/uiLocalStorage';
import { getPanelSizesKey } from '~/composables/ui/usePersistedSplitpanes';
import type { FsEntry } from '~/types/fs';

export type EditorView = 'files' | 'cut' | 'sound' | 'export' | 'fullscreen';

export interface ViewConfig {
  timelineHeight: number;
}

export interface DynamicPanel {
  id: string;
  type:
    | 'fileManager'
    | 'monitor'
    | 'properties'
    | 'text'
    | 'media'
    | 'history'
    | 'effects'
    | 'library'
    | 'markers';
  title?: string;
  // If type is text or media, store file details
  filePath?: string;
  mediaType?: 'video' | 'audio' | 'image' | 'unknown' | null;
}

export interface PanelColumn {
  id: string;
  panels: DynamicPanel[];
}

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';

/**
 * Default Cut layout when no layout is stored yet: landscape — monitor below properties
 * on the right stack; portrait — monitor in the right column.
 */
export function buildDefaultCutPanelsForOrientation(
  orientation: 'landscape' | 'portrait',
): PanelColumn[] {
  if (orientation === 'portrait') {
    return [
      {
        id: 'col-1',
        panels: [
          { id: 'fileManager', type: 'fileManager' },
          { id: 'properties', type: 'properties' },
        ],
      },
      { id: 'col-2', panels: [{ id: 'monitor', type: 'monitor' }] },
    ];
  }
  return [
    { id: 'col-1', panels: [{ id: 'fileManager', type: 'fileManager' }] },
    {
      id: 'col-2',
      panels: [
        { id: 'properties', type: 'properties' },
        { id: 'monitor', type: 'monitor' },
      ],
    },
  ];
}

export interface CreateEditorViewModuleOptions {
  getProjectOrientation: () => 'landscape' | 'portrait';
}

const viewConfigs: Record<EditorView, ViewConfig> = {
  files: { timelineHeight: 30 },
  cut: { timelineHeight: 40 },
  sound: { timelineHeight: 60 },
  export: { timelineHeight: 30 },
  fullscreen: { timelineHeight: 0 },
};

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 9);
}

function sanitizePanel(panel: unknown): DynamicPanel | null {
  if (!panel || typeof panel !== 'object') return null;

  const candidate = panel as Partial<DynamicPanel>;

  if (typeof candidate.id !== 'string' || !candidate.id) return null;
  if (typeof candidate.type !== 'string' || !candidate.type) return null;

  return candidate as DynamicPanel;
}

function sanitizePanelColumns(columns: unknown, fallback: PanelColumn[]): PanelColumn[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    return fallback.map((col) => ({ id: col.id, panels: [...col.panels] }));
  }

  const sanitized = columns
    .map((column) => {
      if (!column || typeof column !== 'object') return null;

      const candidate = column as Partial<PanelColumn> & { panels?: unknown[] };
      const panels = Array.isArray(candidate.panels)
        ? candidate.panels
            .map((panel) => sanitizePanel(panel))
            .filter((panel): panel is DynamicPanel => panel !== null)
        : [];

      if (panels.length === 0) return null;

      return {
        id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `col-${generateId()}`,
        panels,
      } satisfies PanelColumn;
    })
    .filter((column): column is PanelColumn => column !== null);

  if (sanitized.length > 0) return sanitized;

  return fallback.map((col) => ({ id: col.id, panels: [...col.panels] }));
}

export function createEditorViewModule(
  projectIdRef: Ref<string | null>,
  options?: CreateEditorViewModuleOptions,
) {
  const getProjectOrientation =
    options?.getProjectOrientation ?? (() => 'landscape' as 'landscape' | 'portrait');

  function getDefaultCutLayout(): PanelColumn[] {
    return buildDefaultCutPanelsForOrientation(getProjectOrientation()).map((col) => ({
      id: col.id,
      panels: col.panels.map((p) => ({ ...p })),
    }));
  }

  const layoutPlatformSuffix = computed(() => getPlatformSuffix());
  const currentView = ref<EditorView>('cut');
  const isInitialized = ref(false);
  let isInternalLoading = false;

  const cutPanelsKey = computed(
    () =>
      `fastcat:layout:panels:${projectIdRef.value ?? 'no-project'}:cut${layoutPlatformSuffix.value}`,
  );
  const cutPanels = ref<PanelColumn[]>(getDefaultCutLayout());

  // Dynamic panels for sound view
  const defaultSoundPanels: PanelColumn[] = [
    { id: 'col-1', panels: [{ id: 'monitor', type: 'monitor' }] },
  ];

  const soundPanelsKey = computed(
    () =>
      `fastcat:layout:panels:${projectIdRef.value ?? 'no-project'}:sound${layoutPlatformSuffix.value}`,
  );
  const soundPanels = ref<PanelColumn[]>([
    ...defaultSoundPanels.map((col) => ({ id: col.id, panels: [...col.panels] })),
  ]);

  // Load cut panels from local storage (re-apply orientation default when nothing stored)
  watch(
    () => [projectIdRef.value, cutPanelsKey.value, getProjectOrientation()] as const,
    ([projectId, key, orientation]) => {
      // Don't initialize if we don't have a specific project yet
      if (!projectId) return;

      isInternalLoading = true;
      try {
        const fallback = buildDefaultCutPanelsForOrientation(orientation);
        const stored = readLocalStorageJson<any[] | null>(key, null);
        
        if (stored && Array.isArray(stored) && stored.length > 0) {
          if (!Array.isArray(stored[0]) && !stored[0].panels) {
            cutPanels.value = sanitizePanelColumns(
              stored.map((p) => ({ id: `col-${generateId()}`, panels: [p] })),
              fallback,
            );
          } else if (Array.isArray(stored[0])) {
            cutPanels.value = sanitizePanelColumns(
              stored.map((col) => ({ id: `col-${generateId()}`, panels: col })),
              fallback,
            );
          } else {
            cutPanels.value = sanitizePanelColumns(stored, fallback);
          }
        } else {
          // If already initialized by a previous load, don't overwrite with defaults
          // unless it's a completely new project layout request
          if (!isInitialized.value) {
              cutPanels.value = sanitizePanelColumns(fallback, fallback);
          }
        }
        isInitialized.value = true;
      } finally {
        setTimeout(() => {
          isInternalLoading = false;
        }, 50);
      }
    },
    { immediate: true },
  );

  // Load sound panels from local storage
  watch(
    () => [projectIdRef.value, soundPanelsKey.value] as const,
    ([projectId, key]) => {
      if (!projectId) return;

      isInternalLoading = true;
      try {
        const stored = readLocalStorageJson<any[] | null>(key, null);
        if (stored && Array.isArray(stored) && stored.length > 0) {
          soundPanels.value = sanitizePanelColumns(stored, defaultSoundPanels);
        } else {
          // If already initialized by a previous load, don't overwrite with defaults
          if (!isInitialized.value) {
            soundPanels.value = sanitizePanelColumns(defaultSoundPanels, defaultSoundPanels);
          }
        }
      } finally {
        setTimeout(() => {
          isInternalLoading = false;
        }, 50);
      }
    },
    { immediate: true },
  );

  // Save cut panels to local storage
  watch(
    cutPanels,
    (panels) => {
      if (isInternalLoading || !isInitialized.value || !projectIdRef.value) return;
      writeLocalStorageJson(
        cutPanelsKey.value,
        sanitizePanelColumns(panels, getDefaultCutLayout()),
      );
    },
    { deep: true },
  );

  // Save sound panels to local storage
  watch(
    soundPanels,
    (panels) => {
      if (isInternalLoading || !isInitialized.value || !projectIdRef.value) return;
      writeLocalStorageJson(soundPanelsKey.value, sanitizePanelColumns(panels, defaultSoundPanels));
    },
    { deep: true },
  );

  function getActivePanelsState(view?: 'cut' | 'sound') {
    const targetView = view ?? (currentView.value === 'sound' ? 'sound' : 'cut');
    return targetView === 'sound' ? soundPanels : cutPanels;
  }

  function getActiveDefaultPanels(view?: 'cut' | 'sound') {
    const targetView = view ?? (currentView.value === 'sound' ? 'sound' : 'cut');
    return targetView === 'sound' ? defaultSoundPanels : getDefaultCutLayout();
  }

  function insertPanelAt(
    newPanel: DynamicPanel,
    targetPanelId?: string,
    position?: PanelPosition,
    view?: 'cut' | 'sound',
  ) {
    const panelsRef = getActivePanelsState(view);
    const defaults = getActiveDefaultPanels(view);

    if (!targetPanelId || !position) {
      const middleIndex = Math.floor(panelsRef.value.length / 2);
      panelsRef.value.splice(middleIndex, 0, { id: `col-${generateId()}`, panels: [newPanel] });
      panelsRef.value = sanitizePanelColumns(panelsRef.value, defaults);
      return;
    }

    const cols = panelsRef.value.map((col) => ({ id: col.id, panels: [...col.panels] }));

    let toColIdx = -1;
    let toRowIdx = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      const ri = cols[ci]!.panels.findIndex((p) => p.id === targetPanelId);
      if (ri !== -1) {
        toColIdx = ci;
        toRowIdx = ri;
        break;
      }
    }

    if (toColIdx === -1) {
      cols.push({ id: `col-${generateId()}`, panels: [newPanel] });
    } else {
      if (position === 'left') {
        cols.splice(toColIdx, 0, { id: `col-${generateId()}`, panels: [newPanel] });
      } else if (position === 'right') {
        cols.splice(toColIdx + 1, 0, { id: `col-${generateId()}`, panels: [newPanel] });
      } else if (position === 'top') {
        cols[toColIdx]!.panels.splice(toRowIdx, 0, newPanel);
      } else if (position === 'bottom') {
        cols[toColIdx]!.panels.splice(toRowIdx + 1, 0, newPanel);
      }
    }

    panelsRef.value = sanitizePanelColumns(cols, defaults);
  }

  function addTextPanel(
    filePath: string,
    title: string,
    targetPanelId?: string,
    position?: PanelPosition,
    view?: 'cut' | 'sound',
  ) {
    const newPanel: DynamicPanel = {
      id: `text-${generateId()}`,
      type: 'text',
      filePath,
      title,
    };
    insertPanelAt(newPanel, targetPanelId, position, view);
  }

  function addMediaPanel(
    fsEntry: FsEntry,
    mediaType: 'video' | 'audio' | 'image' | 'unknown' | null,
    title: string,
    targetPanelId?: string,
    position?: PanelPosition,
    view?: 'cut' | 'sound',
  ) {
    const newPanel: DynamicPanel = {
      id: `media-${generateId()}`,
      type: 'media',
      filePath: fsEntry.path ?? fsEntry.name,
      mediaType,
      title,
    };
    insertPanelAt(newPanel, targetPanelId, position, view);
  }

  function removePanel(id: string, view?: 'cut' | 'sound') {
    const panelsRef = getActivePanelsState(view);
    const defaults = getActiveDefaultPanels(view);

    const newPanels: PanelColumn[] = [];
    for (const col of panelsRef.value) {
      const newColPanels = col.panels.filter((p) => p.id !== id);
      if (newColPanels.length > 0) {
        newPanels.push({ id: col.id, panels: newColPanels });
      }
    }
    panelsRef.value = sanitizePanelColumns(newPanels, defaults);
  }

  function movePanel(
    panelId: string,
    targetPanelId: string,
    position: PanelPosition,
    view?: 'cut' | 'sound',
  ) {
    if (panelId === targetPanelId) return;

    const panelsRef = getActivePanelsState(view);
    const defaults = getActiveDefaultPanels(view);

    const cols = panelsRef.value.map((col) => ({ id: col.id, panels: [...col.panels] }));

    // Find source
    let fromColIdx = -1;
    let fromRowIdx = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      const ri = cols[ci]!.panels.findIndex((p) => p.id === panelId);
      if (ri !== -1) {
        fromColIdx = ci;
        fromRowIdx = ri;
        break;
      }
    }
    if (fromColIdx === -1) return;

    // Find target
    let toColIdx = -1;
    let toRowIdx = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      const ri = cols[ci]!.panels.findIndex((p) => p.id === targetPanelId);
      if (ri !== -1) {
        toColIdx = ci;
        toRowIdx = ri;
        break;
      }
    }
    if (toColIdx === -1) return;

    // No-op: same position for row moves
    if (
      fromColIdx === toColIdx &&
      fromRowIdx === toRowIdx &&
      (position === 'top' || position === 'bottom')
    )
      return;

    // Remove source panel
    const [movedPanel] = cols[fromColIdx]!.panels.splice(fromRowIdx, 1);
    if (!movedPanel) return;

    // Re-find target after removal (target may have shifted if same column and source was before target)
    const adjustedToColIdx = toColIdx;
    let adjustedToRowIdx = toRowIdx;
    if (fromColIdx === toColIdx && fromRowIdx < toRowIdx) {
      adjustedToRowIdx -= 1;
    }

    // Insert at new position
    if (position === 'left') {
      cols.splice(adjustedToColIdx, 0, { id: `col-${generateId()}`, panels: [movedPanel] });
    } else if (position === 'right') {
      cols.splice(adjustedToColIdx + 1, 0, { id: `col-${generateId()}`, panels: [movedPanel] });
    } else if (position === 'top') {
      cols[adjustedToColIdx]!.panels.splice(adjustedToRowIdx, 0, movedPanel);
    } else if (position === 'bottom') {
      cols[adjustedToColIdx]!.panels.splice(adjustedToRowIdx + 1, 0, movedPanel);
    }

    panelsRef.value = sanitizePanelColumns(
      cols.filter((col) => col.panels.length > 0),
      defaults,
    );
  }

  const timelineHeightKey = computed(() =>
    getPanelSizesKey(`timeline-height-${currentView.value}`, projectIdRef.value),
  );

  const timelineHeight = ref(viewConfigs[currentView.value].timelineHeight);

  // Sync with local storage
  watch(
    timelineHeightKey,
    () => {
      const stored = readLocalStorageJson<number | null>(timelineHeightKey.value, null);
      if (stored && stored > 0 && stored < 100) {
        timelineHeight.value = stored;
      } else {
        timelineHeight.value = viewConfigs[currentView.value].timelineHeight;
      }
    },
    { immediate: true },
  );

  watch(timelineHeight, (newVal) => {
    if (isInternalLoading) return;
    writeLocalStorageJson(timelineHeightKey.value, newVal);
  });

  function resetTimelineHeight() {
    timelineHeight.value = viewConfigs[currentView.value].timelineHeight;
  }

  const lastViewBeforeFullscreen = ref<EditorView | null>(null);

  function setView(view: EditorView) {
    currentView.value = view;
  }

  function goToFiles() {
    currentView.value = 'files';
  }

  function goToCut() {
    currentView.value = 'cut';
  }

  function goToSound() {
    currentView.value = 'sound';
  }

  function goToExport() {
    currentView.value = 'export';
  }

  function goToFullscreen() {
    if (currentView.value !== 'fullscreen') {
      lastViewBeforeFullscreen.value = currentView.value;
    }
    currentView.value = 'fullscreen';
  }

  return {
    currentView,
    timelineHeight,
    cutPanels,
    soundPanels,
    insertPanelAt,
    addTextPanel,
    addMediaPanel,
    removePanel,
    movePanel,
    setView,
    goToFiles,
    goToCut,
    goToSound,
    goToExport,
    goToFullscreen,
    resetTimelineHeight,
    lastViewBeforeFullscreen,
  };
}

 // No standalone defineStore here to avoid double-instances.
 // Layout state is managed within the ProjectStore which calls createEditorViewModule.
