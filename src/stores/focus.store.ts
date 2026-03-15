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
  return panelId === 'properties' || String(panelId) === 'dynamic:properties';
}

export function isPreviewPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  if (panelId === 'monitor' || String(panelId).startsWith('dynamic:monitor')) return false;

  return (
    panelId === 'project' ||
    panelId === 'left' ||
    panelId === 'right' ||
    isPropertiesPanelFocus(panelId) ||
    isDynamicPanelFocus(panelId)
  );
}

export function isPlaybackPanelFocus(panelId: string | null | undefined): boolean {
  if (!panelId) return false;
  if (isPropertiesPanelFocus(panelId)) return false;

  return (
    panelId === 'monitor' ||
    panelId === 'left' ||
    panelId === 'right' ||
    panelId === 'timeline' ||
    isDynamicPanelFocus(panelId)
  );
}

export function isTimelineHotkeyPanelFocus(panelId: string | null | undefined): boolean {
  return panelId === 'timeline' || panelId === 'audioMixer';
}

function toLegacyTempFocus(panelId: string | null | undefined): TempPanelFocus {
  if (panelId === 'left') return 'left';
  if (panelId === 'right') return 'right';
  return 'none';
}

export const useFocusStore = defineStore('focus', () => {
  const activeTimelinePath = ref<string | null>(null);

  const mainFocusByTimeline = ref<Record<string, MainPanelFocus>>({});
  const activePanelId = ref<PanelFocusId>('monitor');
  const lastCutMainPanelId = ref<MainPanelFocus>('monitor');
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
    const nextMainFocus = saved ?? 'monitor';
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
