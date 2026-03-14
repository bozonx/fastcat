import { computed, onMounted, onUnmounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import { hotkeyFromKeyboardEvent, isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import {
  canExecuteHotkeyCommand,
  createHotkeyLookup,
  getFocusAwareHotkeyOrder,
  getMatchedHotkeyCommands,
  shouldBlurAfterHotkey,
  shouldHandleRepeatForMatchedCommands,
} from '~/utils/hotkeys/runtime';

import { useGeneralHotkeys } from './hotkeys/useGeneralHotkeys';
import { useTimelineHotkeys } from './hotkeys/useTimelineHotkeys';
import { usePlaybackHotkeys } from './hotkeys/usePlaybackHotkeys';

export function useEditorHotkeys() {
  const workspaceStore = useWorkspaceStore();
  const focusStore = useFocusStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const uiStore = useUiStore();

  const volumeHoldRunner = createHotkeyHoldRunner();
  const zoomHoldRunner = createHotkeyHoldRunner();

  const suppressedKeyupCodes = new Set<string>();

  const generalHandlers = useGeneralHotkeys(zoomHoldRunner, volumeHoldRunner);
  const timelineHandlers = useTimelineHotkeys();
  const playbackHandlers = usePlaybackHotkeys();

  const registry: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    ...generalHandlers,
    ...timelineHandlers,
    ...playbackHandlers,
  };

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));

  function hasBlockingModalState() {
    // Rely on DOM presence of open dialogs or headless UI modals to block hotkeys
    // This removes tight coupling to specific stores for UI state
    if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]')) return true;
    if (projectStore.currentView === 'fullscreen') return true;
    return false;
  }

  function canHandleFocusTab() {
    if (hasBlockingModalState()) return false;
    return projectStore.currentView === 'cut' || projectStore.currentView === 'sound';
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;

    const combo = hotkeyFromKeyboardEvent(e, workspaceStore.userSettings);
    if (!combo) return;

    const matched = getMatchedHotkeyCommands({ combo, lookup: hotkeyLookup.value });
    if (matched.length === 0) return;

    if (e.repeat && !shouldHandleRepeatForMatchedCommands(matched)) return;

    if (matched.includes('general.deselect')) {
      if (timelineStore.isTrimModeActive) {
        timelineStore.isTrimModeActive = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    const allowsFullscreenExit = matched.includes('general.fullscreen');

    if (hasBlockingModalState() && e.key !== 'Escape' && !allowsFullscreenExit) return;

    if (matched.includes('general.focus') && canHandleFocusTab()) {
      e.preventDefault();
      focusStore.handleFocusHotkey();
      return;
    }

    const isEditableEventTarget = isEditableTarget(e.target);
    const isEditableActiveElement = isEditableTarget(document.activeElement);

    const focusAwareOrder = getFocusAwareHotkeyOrder({
      matched,
      canUseTimelineHotkeys: focusStore.canUseTimelineHotkeys,
      canUsePlaybackHotkeys: focusStore.canUsePlaybackHotkeys,
    });

    for (const cmdId of focusAwareOrder) {
      if (
        !canExecuteHotkeyCommand({
          cmdId,
          hasBlockingModalState: hasBlockingModalState() && e.key !== 'Escape',
          isEditableEventTarget,
          isEditableActiveElement,
        })
      ) {
        continue;
      }

      const handler = registry[cmdId];
      if (handler) {
        const executed = handler(e);
        if (executed) {
          if (
            shouldBlurAfterHotkey({
              cmdId,
              activeElement: document.activeElement,
              isEditableTarget,
            })
          ) {
            (document.activeElement as HTMLElement).blur();
          }
          e.preventDefault();
          e.stopPropagation();
          (e as any).stopImmediatePropagation?.();
          suppressedKeyupCodes.add(e.code);
          return;
        }
      }
    }
  }

  function onGlobalKeyup(e: KeyboardEvent) {
    if (suppressedKeyupCodes.has(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
      suppressedKeyupCodes.delete(e.code);
    }

    volumeHoldRunner.handleKeyup(e.code);
    zoomHoldRunner.handleKeyup(e.code);
  }

  function onGlobalBlur() {
    suppressedKeyupCodes.clear();
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
  }

  // To prevent stuck keys if window loses focus while a key is pressed,
  // we also listen to 'visibilitychange' which sometimes catches what 'blur' misses
  function onVisibilityChange() {
    if (document.hidden) {
      suppressedKeyupCodes.clear();
      volumeHoldRunner.clearTimers();
      zoomHoldRunner.clearTimers();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('keyup', onGlobalKeyup);
    window.addEventListener('blur', onGlobalBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onGlobalKeydown);
    window.removeEventListener('keyup', onGlobalKeyup);
    window.removeEventListener('blur', onGlobalBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
  });
}
