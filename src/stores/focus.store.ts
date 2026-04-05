import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type MainPanelFocus = 'monitor' | 'timeline';
export type TempPanelFocus = 'none' | 'left' | 'right';
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

const MAIN_PANEL_IDS: MainPanelFocus[] = ['monitor', 'timeline'];
const LEGACY_TEMP_PANEL_MAP: Record<Exclude<TempPanelFocus, 'none'>, PanelFocusId> = {
  left: 'left',
  right: 'right',
};

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

  return isPropertiesPanelFocus(panelId) || isFileManagerPanelFocus(panelId);
}

export function isFileManagerPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  return isFileManagerSidebarFocus(panelId) || isFileManagerMainFocus(panelId);
}

export function isFileManagerSidebarFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  const id = String(panelId);
  return (
    id === 'left' ||
    id === 'files-sidebar' ||
    (id.startsWith('dynamic:file-manager:') && id.endsWith(':sidebar')) ||
    (id.startsWith('dynamic:fileManager:') && id.endsWith(':sidebar'))
  );
}

export function isFileManagerMainFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  const id = String(panelId);
  return (
    id === 'project' ||
    id === 'right' ||
    id === 'filesBrowser' ||
    id === 'files-main' ||
    (id.startsWith('dynamic:file-manager:') && id.endsWith(':main')) ||
    (id.startsWith('dynamic:fileManager:') && id.endsWith(':main')) ||
    (id.startsWith('dynamic:fileManager:') && !id.endsWith(':sidebar'))
  );
}

export function isPlaybackPanelFocus(panelId: string | null | undefined): boolean {
  return !!panelId;
}

export function isTimelineHotkeyPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  return (
    panelId === 'timeline' ||
    panelId === 'audioMixer' ||
    String(panelId).startsWith('dynamic:fileManager:')
  );
}

function toLegacyTempFocus(panelId: string | null | undefined): TempPanelFocus {
  if (panelId === 'left') return 'left';
  if (panelId === 'right') return 'right';
  return 'none';
}

export const useFocusStore = defineStore('focus', () => {
  const activeTimelinePath = ref<string | null>(null);

  const mainFocusByTimeline = ref<Record<string, MainPanelFocus>>({});
  const activePanelId = ref<PanelFocusId>('timeline');
  const lastCutMainPanelId = ref<MainPanelFocus>('timeline');
  const lastNonMainPanelId = ref<Exclude<PanelFocusId, MainPanelFocus> | null>(null);

  const mainFocus = computed<MainPanelFocus>(() => {
    if (isMainPanelFocus(activePanelId.value)) {
      return activePanelId.value;
    }
    return lastCutMainPanelId.value;
  });

  const tempFocus = computed<TempPanelFocus>(() => toLegacyTempFocus(activePanelId.value));
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

    if (isMainPanelFocus(panelId)) {
      lastCutMainPanelId.value = panelId;
      syncMainFocusToTimeline(panelId);
      return;
    }

    lastNonMainPanelId.value = panelId;
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

  function setTempFocus(next: Exclude<TempPanelFocus, 'none'>) {
    setPanelFocus(LEGACY_TEMP_PANEL_MAP[next]);
  }

  function clearTempFocus() {
    if (tempFocus.value === 'none') return;
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

  function isPanelFocused(panel: AnyPanelFocus) {
    return effectiveFocus.value === panel;
  }

  const canUseTimelineHotkeys = computed(() => isTimelineHotkeyPanelFocus(effectiveFocus.value));
  const canUsePlaybackHotkeys = computed(() => isPlaybackPanelFocus(effectiveFocus.value));

  const canUsePreviewHotkeys = computed(() => isPreviewPanelFocus(effectiveFocus.value));

  const isPropertiesFocus = computed(() => isPropertiesPanelFocus(effectiveFocus.value));

  return {
    activePanelId,
    mainFocus,
    tempFocus,
    effectiveFocus,
    lastCutMainPanelId,
    lastNonMainPanelId,

    canUseTimelineHotkeys,
    canUsePlaybackHotkeys,
    canUsePreviewHotkeys,
    isPropertiesFocus,

    isPanelFocused,

    setActiveTimelinePath,
    setPanelFocus,
    setMainFocus,
    setTempFocus,
    clearTempFocus,
    restoreLastNonMainPanel,
    restoreLastCutMainPanel,

    handleFocusHotkey,
  };
});
