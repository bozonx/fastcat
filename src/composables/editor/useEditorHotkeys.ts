import { onMounted, onUnmounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { getActiveElement } from '~/utils/browser-api';
import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { hotkeyFromKeyboardEvent, isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import type { HotkeyCommandId, HotkeyCombo } from '~/utils/hotkeys/defaultHotkeys';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import {
  canExecuteHotkeyCommand,
  getHotkeyCommandGroup,
  getFocusAwareHotkeyOrder,
  getMatchedHotkeyCommands,
  shouldBlurAfterHotkey,
  shouldHandleRepeatForMatchedCommands,
} from '~/utils/hotkeys/runtime';

import { useGeneralHotkeys } from './hotkeys/useGeneralHotkeys';
import { useTimelineHotkeys } from './hotkeys/useTimelineHotkeys';
import { usePlaybackHotkeys } from './hotkeys/usePlaybackHotkeys';

export function hasBlockingModalState(): boolean {
  return !!document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]');
}

export function useEditorHotkeys() {
  const workspaceStore = useWorkspaceStore();
  const focusStore = useFocusStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();

  const volumeHoldRunner = createHotkeyHoldRunner();
  const zoomHoldRunner = createHotkeyHoldRunner();
  const navigationHoldRunner = createHotkeyHoldRunner();
  const playbackStepHoldRunner = createHotkeyHoldRunner();

  const suppressedKeyupCodes = new Set<string>();

  const generalHandlers = useGeneralHotkeys(zoomHoldRunner, volumeHoldRunner, navigationHoldRunner);
  const timelineHandlers = useTimelineHotkeys(navigationHoldRunner);
  const { effectiveHotkeys, hotkeyLookup, defaultHotkeyLookup } = useEffectiveHotkeys();
  const playbackHandlers = usePlaybackHotkeys(playbackStepHoldRunner, effectiveHotkeys);

  // Combine handlers that overlap (copy, cut, paste)
  const registry: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    ...generalHandlers,
    ...timelineHandlers,
    ...playbackHandlers,
  };

  // Explicitly resolve overlapping handlers
  const overlappingKeys: HotkeyCommandId[] = ['general.copy', 'general.cut', 'general.paste'];
  for (const key of overlappingKeys) {
    if (generalHandlers[key] && timelineHandlers[key]) {
      registry[key] = (e: KeyboardEvent) => {
        // Timeline has priority if focus allows timeline hotkeys
        if (focusStore.canUseTimelineHotkeys && timelineHandlers[key]!(e)) return true;
        return generalHandlers[key]!(e);
      };
    }
  }

  function isFullscreen() {
    return projectStore.currentView === 'fullscreen';
  }

  function canHandleFocusTab() {
    if (hasBlockingModalState()) return false;
    return (
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'sound'
    );
  }

  function handleFocusCommand() {
    if (projectStore.currentView === 'files') {
      focusStore.handleFilesViewFocusHotkey();
      return;
    }

    focusStore.handleFocusHotkey();
  }

  function dispatchMatchedCommands(
    matched: HotkeyCommandId[],
    matchedCombo: HotkeyCombo | null,
    e: Event,
  ): boolean {
    const allowsFullscreenExit = matched.includes('general.fullscreen');
    const isPlaybackCmd = matched.some((cmdId) => cmdId.startsWith('playback.'));
    const isZoomCmd = matched.some((cmdId) => cmdId.includes('zoom'));
    const modalOpen = hasBlockingModalState();
    const fullscreen = isFullscreen();

    if (modalOpen && !allowsFullscreenExit && !isZoomCmd) return false;
    if (fullscreen && !allowsFullscreenExit && !isPlaybackCmd && !isZoomCmd) return false;

    if (matched.includes('general.focus') && canHandleFocusTab()) {
      if (isEditableTarget((e as KeyboardEvent).target)) return false;

      e.preventDefault();
      handleFocusCommand();
      return true;
    }

    const isEditableEventTarget = isEditableTarget((e as KeyboardEvent).target);
    const isEditableActiveElement = isEditableTarget(getActiveElement());
    const keyboardEvent = e as KeyboardEvent;
    const isArrowKey = keyboardEvent.key.startsWith('Arrow');
    const isFileManagerHotkeyFocus =
      focusStore.canUseFileManagerHotkeys || focusStore.effectiveFocus === 'filesBrowser';
    const matchedForFocus =
      isFileManagerHotkeyFocus && isArrowKey
        ? matched.filter((cmdId) => getHotkeyCommandGroup(cmdId) === 'fileManager')
        : matched;

    if (matchedForFocus.length === 0) {
      return false;
    }

    const focusAwareOrder = getFocusAwareHotkeyOrder({
      matched: matchedForFocus,
      canUseFileManagerHotkeys: focusStore.canUseFileManagerHotkeys,
      canUseTimelineHotkeys: focusStore.canUseTimelineHotkeys,
      canUseMonitorHotkeys: focusStore.canUseMonitorHotkeys,
    });

    for (const cmdId of focusAwareOrder) {
      const isPlayback = cmdId.startsWith('playback.');
      const isZoom = cmdId.includes('zoom');
      if (
        !canExecuteHotkeyCommand({
          cmdId,
          hasBlockingModalState: modalOpen || (fullscreen && !isPlayback && !isZoom),
          isEditableEventTarget,
          isEditableActiveElement,
          pressedCombo: matchedCombo,
        })
      ) {
        continue;
      }

      const handler = registry[cmdId];
      if (handler) {
        const executed = handler(e as KeyboardEvent);
        if (executed) {
          if (
            shouldBlurAfterHotkey({
              cmdId,
              activeElement: getActiveElement(),
            })
          ) {
            (getActiveElement() as HTMLElement | null)?.blur();
          }
          e.preventDefault();
          e.stopPropagation();
          (e as Event).stopImmediatePropagation?.();
          return true;
        }
      }
    }
    return false;
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;

    const literalCombo = hotkeyFromKeyboardEvent(e);
    const layeredCombo = hotkeyFromKeyboardEvent(e, workspaceStore.userSettings);

    if (!literalCombo && !layeredCombo) return;

    let matched = getMatchedHotkeyCommands({ combo: literalCombo, lookup: hotkeyLookup.value });
    let matchedCombo: HotkeyCombo | null = literalCombo;

    if (matched.length === 0 && layeredCombo && layeredCombo !== literalCombo) {
      matched = getMatchedHotkeyCommands({
        combo: layeredCombo,
        lookup: defaultHotkeyLookup.value,
      });
      matchedCombo = layeredCombo;
    }

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

    if (dispatchMatchedCommands(matched, matchedCombo, e)) {
      suppressedKeyupCodes.add(e.code);
    }
  }

  function onGlobalKeyup(e: KeyboardEvent) {
    if (suppressedKeyupCodes.has(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      (e as Event).stopImmediatePropagation?.();
      suppressedKeyupCodes.delete(e.code);
    }

    volumeHoldRunner.handleKeyup(e.code);
    zoomHoldRunner.handleKeyup(e.code);
    navigationHoldRunner.handleKeyup(e.code);
    playbackStepHoldRunner.handleKeyup(e.code);
  }

  function onGlobalPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLButtonElement ||
      (target instanceof HTMLInputElement &&
        ['button', 'submit', 'reset'].includes((target.type || '').toLowerCase()))
    ) {
      target.blur();
    }
  }

  function onGlobalBlur() {
    suppressedKeyupCodes.clear();
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
    navigationHoldRunner.clearTimers();
    playbackStepHoldRunner.clearTimers();
  }

  // To prevent stuck keys if window loses focus while a key is pressed,
  // we also listen to 'visibilitychange' which sometimes catches what 'blur' misses
  function onVisibilityChange() {
    if (document.hidden) {
      suppressedKeyupCodes.clear();
      volumeHoldRunner.clearTimers();
      zoomHoldRunner.clearTimers();
      navigationHoldRunner.clearTimers();
      playbackStepHoldRunner.clearTimers();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('keyup', onGlobalKeyup);
    window.addEventListener('blur', onGlobalBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pointerdown', onGlobalPointerDown, true);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onGlobalKeydown);
    window.removeEventListener('keyup', onGlobalKeyup);
    window.removeEventListener('blur', onGlobalBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pointerdown', onGlobalPointerDown, true);
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
    navigationHoldRunner.clearTimers();
    playbackStepHoldRunner.clearTimers();
  });
}
