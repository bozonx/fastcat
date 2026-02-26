import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type MainPanelFocus = 'monitor' | 'timeline';
export type TempPanelFocus = 'none' | 'left' | 'right';
export type AnyPanelFocus = MainPanelFocus | Exclude<TempPanelFocus, 'none'>;

export const useFocusStore = defineStore('focus', () => {
  const activeTimelinePath = ref<string | null>(null);

  const mainFocusByTimeline = ref<Record<string, MainPanelFocus>>({});

  const mainFocus = ref<MainPanelFocus>('monitor');
  const lastMainFocusBeforeTemp = ref<MainPanelFocus>('monitor');
  const tempFocus = ref<TempPanelFocus>('none');

  const effectiveFocus = computed<AnyPanelFocus>(() => {
    if (tempFocus.value === 'left') return 'left';
    if (tempFocus.value === 'right') return 'right';
    return mainFocus.value;
  });

  function syncMainFocusToTimeline() {
    const path = activeTimelinePath.value;
    if (!path) return;
    mainFocusByTimeline.value = {
      ...mainFocusByTimeline.value,
      [path]: mainFocus.value,
    };
  }

  function setActiveTimelinePath(nextPath: string | null) {
    activeTimelinePath.value = nextPath;

    if (!nextPath) {
      tempFocus.value = 'none';
      return;
    }

    const saved = mainFocusByTimeline.value[nextPath];
    mainFocus.value = saved ?? 'monitor';
    lastMainFocusBeforeTemp.value = mainFocus.value;

    tempFocus.value = 'none';
  }

  function setMainFocus(next: MainPanelFocus) {
    mainFocus.value = next;
    lastMainFocusBeforeTemp.value = next;
    syncMainFocusToTimeline();

    if (tempFocus.value !== 'none') {
      tempFocus.value = 'none';
    }
  }

  function toggleMainFocus() {
    setMainFocus(mainFocus.value === 'monitor' ? 'timeline' : 'monitor');
  }

  function setTempFocus(next: Exclude<TempPanelFocus, 'none'>) {
    if (tempFocus.value === next) return;

    lastMainFocusBeforeTemp.value = mainFocus.value;
    tempFocus.value = next;
  }

  function clearTempFocus() {
    if (tempFocus.value === 'none') return;
    tempFocus.value = 'none';
  }

  function handleFocusHotkey() {
    if (tempFocus.value !== 'none') {
      clearTempFocus();
      return;
    }

    toggleMainFocus();
  }

  function isPanelFocused(panel: AnyPanelFocus) {
    return effectiveFocus.value === panel;
  }

  const canUseTimelineHotkeys = computed(() => effectiveFocus.value === 'timeline');
  const canUsePlaybackHotkeys = computed(() => effectiveFocus.value === 'monitor');

  return {
    mainFocus,
    tempFocus,
    effectiveFocus,

    canUseTimelineHotkeys,
    canUsePlaybackHotkeys,

    isPanelFocused,

    setActiveTimelinePath,
    setMainFocus,
    setTempFocus,
    clearTempFocus,

    handleFocusHotkey,
  };
});
