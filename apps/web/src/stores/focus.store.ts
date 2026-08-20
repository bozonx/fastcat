import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useSelectionStore } from './selection.store';

export type MainPanelFocus = 'monitor' | 'timeline';
export type PanelFocusId =
  | MainPanelFocus
  | 'left'
  | 'right'
  | 'project'
  | 'filesBrowser'
  | 'properties'
  | 'audioMixer'
  | 'exportForm'
  | 'files-sidebar'
  | 'files-main'
  | `dynamic:${string}`;
export type AnyPanelFocus = PanelFocusId;

function isMainPanelFocus(panelId: string | null | undefined): panelId is MainPanelFocus {
  return panelId === 'monitor' || panelId === 'timeline';
}

export function isDynamicPanelFocus(
  panelId: string | null | undefined,
): panelId is `dynamic:${string}` {
  return String(panelId).startsWith('dynamic:');
}

export function isPropertiesPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  return panelId === 'properties' || String(panelId).startsWith('dynamic:properties:');
}

export function isPreviewPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  if (panelId === 'monitor' || String(panelId).startsWith('dynamic:monitor:')) return false;

  return (
    panelId === 'project' ||
    panelId === 'left' ||
    panelId === 'right' ||
    panelId === 'filesBrowser' ||
    isPropertiesPanelFocus(panelId) ||
    isFileManagerPanelFocus(panelId)
  );
}

export function isFileManagerPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  return isFileManagerSidebarFocus(panelId) || isFileManagerMainFocus(panelId);
}

export function isFileManagerSidebarFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  const id = String(panelId);
  return (
    id === 'files-sidebar' ||
    (id.startsWith('dynamic:file-manager:') && id.endsWith(':sidebar')) ||
    (id.startsWith('dynamic:fileManager:') && id.endsWith(':sidebar'))
  );
}

export function isFileManagerMainFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  const id = String(panelId);
  return (
    id === 'files-main' ||
    (id.startsWith('dynamic:file-manager:') && id.endsWith(':main')) ||
    (id.startsWith('dynamic:file-manager:') && !id.endsWith(':sidebar')) ||
    (id.startsWith('dynamic:fileManager:') && id.endsWith(':main')) ||
    (id.startsWith('dynamic:fileManager:') && !id.endsWith(':sidebar'))
  );
}

export function isPlaybackPanelFocus(panelId: string | null | undefined): boolean {
  return !!panelId;
}

export function isTimelineHotkeyPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  return panelId === 'timeline' || panelId === 'audioMixer';
}

export function isMonitorPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  return panelId === 'monitor' || String(panelId).startsWith('dynamic:monitor:');
}

export type FileManagerSurface = 'tree' | 'list';

const FILES_VIEW_SIDEBAR_FOCUS_ID = 'dynamic:file-manager:sidebar';
const FILES_VIEW_MAIN_FOCUS_ID = 'dynamic:file-manager:main';

export const useFocusStore = defineStore('focus', () => {
  const activeTimelinePath = ref<string | null>(null);

  const mainFocusByTimeline = ref<Record<string, MainPanelFocus>>({});
  const activePanelId = ref<PanelFocusId>('timeline');
  const lastCutMainPanelId = ref<MainPanelFocus>('timeline');
  const lastNonMainPanelId = ref<Exclude<PanelFocusId, MainPanelFocus> | null>(null);

  // Within a file-manager instance the folder tree and the file list share the
  // same panel focus id, so this tracks which of the two surfaces was focused
  // last. Used to route surface-specific hotkeys (e.g. select-all).
  const fileManagerSurface = ref<FileManagerSurface | null>(null);

  const mainFocus = computed<MainPanelFocus>(() => {
    if (isMainPanelFocus(activePanelId.value)) {
      return activePanelId.value;
    }
    return lastCutMainPanelId.value;
  });

  const effectiveFocus = computed<AnyPanelFocus>(() => activePanelId.value);

  function syncMainFocusToTimeline(nextMainFocus: MainPanelFocus) {
    const path = activeTimelinePath.value;
    if (!path) return;
    mainFocusByTimeline.value = {
      ...mainFocusByTimeline.value,
      [path]: nextMainFocus,
    };
  }

  function setPanelFocus(panelId: PanelFocusId) {
    activePanelId.value = panelId;

    // Reset the tree/list surface whenever focus leaves the file manager.
    if (!isFileManagerPanelFocus(panelId)) {
      fileManagerSurface.value = null;
    }

    if (isMainPanelFocus(panelId)) {
      lastCutMainPanelId.value = panelId;
      syncMainFocusToTimeline(panelId);
      return;
    }

    lastNonMainPanelId.value = panelId;
  }

  function setFileManagerPanelFocus(panelId: PanelFocusId, surface: FileManagerSurface) {
    fileManagerSurface.value = surface;
    setPanelFocus(panelId);
  }

  function setActiveTimelinePath(nextPath: string | null) {
    activeTimelinePath.value = nextPath;

    if (!nextPath) {
      activePanelId.value = lastCutMainPanelId.value;
      return;
    }

    const saved = mainFocusByTimeline.value[nextPath];
    const nextMainFocus = saved ?? 'timeline';
    lastCutMainPanelId.value = nextMainFocus;

    if (isMainPanelFocus(activePanelId.value)) {
      activePanelId.value = nextMainFocus;
    }
  }

  function setMainFocus(next: MainPanelFocus) {
    setPanelFocus(next);
  }

  function toggleMainFocus() {
    setMainFocus(mainFocus.value === 'monitor' ? 'timeline' : 'monitor');
  }

  function setTempFocus(next: 'files-sidebar' | 'files-main') {
    setPanelFocus(next);
  }

  function clearTempFocus() {
    if (activePanelId.value !== 'files-sidebar' && activePanelId.value !== 'files-main') return;
    activePanelId.value = lastCutMainPanelId.value;
  }

  function restoreLastNonMainPanel() {
    if (!lastNonMainPanelId.value) return false;
    activePanelId.value = lastNonMainPanelId.value;
    return true;
  }

  function restoreLastCutMainPanel() {
    activePanelId.value = lastCutMainPanelId.value;
  }

  function handleFocusHotkey() {
    if (isMainPanelFocus(activePanelId.value)) {
      toggleMainFocus();
      return;
    }

    restoreLastCutMainPanel();
  }

  function handleFilesViewFocusHotkey() {
    if (activePanelId.value === FILES_VIEW_MAIN_FOCUS_ID) {
      setPanelFocus(FILES_VIEW_SIDEBAR_FOCUS_ID);
      return;
    }

    setPanelFocus(FILES_VIEW_MAIN_FOCUS_ID);
  }

  function isPanelFocused(panel: AnyPanelFocus) {
    return effectiveFocus.value === panel;
  }

  const canUseTimelineHotkeys = computed(() => {
    const focus = effectiveFocus.value;
    if (isTimelineHotkeyPanelFocus(focus)) return true;

    if (isPropertiesPanelFocus(focus)) {
      const selectionStore = useSelectionStore();
      return selectionStore.selectedEntity?.source === 'timeline';
    }

    return false;
  });
  const canUsePlaybackHotkeys = computed(() => isPlaybackPanelFocus(effectiveFocus.value));
  const canUseMonitorHotkeys = computed(() => isMonitorPanelFocus(effectiveFocus.value));

  const canUsePreviewHotkeys = computed(() => isPreviewPanelFocus(effectiveFocus.value));

  const canUseFileManagerHotkeys = computed(() => {
    if (isFileManagerPanelFocus(effectiveFocus.value)) return true;

    if (isPropertiesPanelFocus(effectiveFocus.value)) {
      const selectionStore = useSelectionStore();
      return selectionStore.selectedEntity?.source === 'fileManager';
    }

    return false;
  });

  const isPropertiesFocus = computed(() => isPropertiesPanelFocus(effectiveFocus.value));

  return {
    activeTimelinePath,
    mainFocusByTimeline,
    activePanelId,
    mainFocus,
    effectiveFocus,
    lastCutMainPanelId,
    lastNonMainPanelId,
    fileManagerSurface,

    canUseTimelineHotkeys,
    canUsePlaybackHotkeys,
    canUseMonitorHotkeys,
    canUsePreviewHotkeys,
    canUseFileManagerHotkeys,
    isPropertiesFocus,

    isPanelFocused,

    setActiveTimelinePath,
    setPanelFocus,
    setFileManagerPanelFocus,
    setMainFocus,
    setTempFocus,
    clearTempFocus,
    restoreLastNonMainPanel,
    restoreLastCutMainPanel,

    handleFocusHotkey,
    handleFilesViewFocusHotkey,
  };
});
